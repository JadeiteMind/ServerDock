use serde::{Deserialize, Serialize};
use std::{collections::HashSet, process::Stdio};
use tokio::{process::Command, time::{timeout, Duration}};

#[derive(Deserialize, Serialize)]
pub struct Instance {
    instance_id: String,
    instance_name: String,
    status: String,
    os_type: String,
    #[serde(default)]
    profile: String,
}

#[derive(Deserialize)]
struct Page {
    instances: Vec<Instance>,
    next_token: Option<String>,
}

async fn run(args: &[&str], profile: &str, region: &str) -> Result<serde_json::Value, String> {
    let mut command = Command::new("workbench");
    command.args(args).args(["--region", region, "--output", "json"]);
    if !profile.is_empty() {
        command.args(["--profile", profile]);
    }
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    command.stdin(Stdio::null()).kill_on_drop(true);
    let file_transfer = matches!(args.first(), Some(&"upload") | Some(&"download"));
    let limit = Duration::from_secs(if file_transfer { 900 } else { 40 });
    let output = timeout(limit, command.output()).await
        .map_err(|_| "Workbench 请求超时".to_string())?
        .map_err(|error| format!("无法启动 Workbench CLI：{error}"))?;
    if file_transfer && output.status.success() {
        return Ok(serde_json::Value::Null);
    }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let summary: String = stderr.trim().chars().take(1000).collect();
            if summary.is_empty() {
                format!("Workbench 未返回有效 JSON（退出码 {:?}）", output.status.code())
            } else { summary }
        })?;
    if !output.status.success() {
        return Err(value.get("message").or_else(|| value.get("stderr")).and_then(|message| message.as_str())
            .filter(|message| !message.is_empty()).unwrap_or("Workbench 请求失败，请检查凭证、实例状态和 RAM 权限").to_string());
    }
    Ok(value)
}

#[tauri::command]
pub async fn list_workbench_instances(profile: String, region: String) -> Result<Vec<Instance>, String> {
    if region.trim().is_empty() {
        return Err("请输入 ECS 地域".into());
    }
    let profile = if profile.is_empty() {
        run(&["config", "list"], "", &region).await?
            .get("current").and_then(|value| value.as_str()).filter(|name| !name.is_empty())
            .ok_or("Workbench 未配置活动 Profile")?.to_owned()
    } else { profile };
    let mut instances = Vec::new();
    let mut tokens = HashSet::new();
    let mut token = String::new();
    loop {
        let mut args = vec!["list", "ecs", "--limit", "100"];
        if !token.is_empty() {
            args.extend(["--next-token", token.as_str()]);
        }
        let page: Page = serde_json::from_value(run(&args, &profile, &region).await?)
            .map_err(|error| format!("无法解析 ECS 列表：{error}"))?;
        instances.extend(page.instances.into_iter()
            .filter(|item| item.os_type.eq_ignore_ascii_case("linux"))
            .map(|mut item| { item.profile = profile.clone(); item }));
        let Some(next) = page.next_token.filter(|next| !next.is_empty()) else { break };
        if !tokens.insert(next.clone()) {
            return Err("Workbench 返回了重复的分页标记".into());
        }
        token = next;
    }
    Ok(instances)
}

#[tauri::command]
pub async fn collect_workbench_instance(profile: String, region: String, instance_id: String) -> Result<crate::models::Snapshot, String> {
    let script = format!("RACKTOP_INCLUDE_PROCESSES=1 RACKTOP_INCLUDE_DISKS=1 RACKTOP_REMOTE_HISTORY=0;\n{}",
        include_str!("../assets/serverdock-collector.sh").replace("\r\n", "\n"));
    let result = run(&["exec", "--instance-id", &instance_id, "--timeout", "30", "--command", &script], &profile, &region).await?;
    if result.get("exit_code").and_then(|value| value.as_i64()).is_some_and(|code| code != 0) {
        return Err("Workbench 远程采集脚本执行失败".into());
    }
    let output = result.get("output").and_then(|value| value.as_str()).ok_or("Workbench 未返回采集内容")?;
    crate::collector::parse_snapshot(&instance_id, output)
}

#[tauri::command]
pub async fn workbench_profiles() -> Result<serde_json::Value, String> {
    let config = run(&["config", "list"], "", "cn-hangzhou").await?;
    let names: Vec<&str> = config["profiles"].as_array().into_iter().flatten()
        .filter_map(|profile| profile["name"].as_str()).collect();
    Ok(serde_json::json!({ "current": config["current"], "names": names }))
}

#[tauri::command]
pub fn start_workbench_terminal(
    app: tauri::AppHandle,
    terminals: tauri::State<'_, crate::terminal::TerminalManager>,
    profile: String, region: String, instance_id: String, username: String, columns: u16, rows: u16,
) -> Result<String, String> {
    let mut command = portable_pty::CommandBuilder::new("workbench");
    command.args(["connect", "--instance-id", &instance_id, "--region", &region, "--profile", &profile, "--user-name", &username]);
    terminals.start_command(app, command, columns, rows)
}

#[tauri::command]
pub async fn transfer_workbench_file(
    profile: String, region: String, instance_id: String, username: String,
    upload: bool, local_path: String, remote_path: String,
) -> Result<(), String> {
    let local = std::path::Path::new(&local_path);
    if !local.is_absolute() || !remote_path.starts_with('/') || remote_path.ends_with('/') ||
        remote_path.chars().any(char::is_control) || remote_path.split('/').any(|part| part == "." || part == "..") {
        return Err("请填写本机和远端文件的绝对路径（包含文件名）".into());
    }
    let mut args = if upload {
        let metadata = std::fs::metadata(local).map_err(|error| format!("无法读取本机文件：{error}"))?;
        if !metadata.is_file() || metadata.len() > 1024_u64.pow(3) {
            return Err("请选择不超过 1 GiB 的普通文件".into());
        }
        let quoted = format!("'{}'", remote_path.replace('\'', "'\"'\"'"));
        let check = format!(r#"p={quoted}; parent="${{p%/*}}"; parent="${{parent:-/}}"; if [ -e "$p" ] || [ -L "$p" ]; then echo EXISTS; elif [ -d "$parent" ] && [ -w "$parent" ]; then echo READY; else echo PARENT; fi"#);
        let result = run(&["exec", "--instance-id", &instance_id, "--user-name", &username, "--command", &check], &profile, &region).await?;
        match result["output"].as_str().map(str::trim) {
            Some("READY") => {}
            Some("EXISTS") => return Err("远端目标已存在，请使用新的文件名".into()),
            _ => return Err("远端父目录不存在或不可写".into()),
        }
        vec!["upload", local_path.as_str(), remote_path.as_str()]
    } else {
        match std::fs::symlink_metadata(local) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            _ => return Err("本机目标已存在或无法访问，请使用新的文件名".into()),
        }
        if !local.parent().is_some_and(|parent| parent.is_dir()) {
            return Err("本机目标的父目录不存在".into());
        }
        vec!["download", remote_path.as_str(), local_path.as_str()]
    };
    args.extend(["--instance-id", &instance_id, "--user-name", &username]);
    run(&args, &profile, &region).await?;
    if !upload && !local.is_file() {
        return Err("Workbench 已结束，但指定的本机文件未生成".into());
    }
    Ok(())
}
