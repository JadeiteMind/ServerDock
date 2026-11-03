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
    let output = timeout(Duration::from_secs(40), command.output()).await
        .map_err(|_| "Workbench 请求超时".to_string())?
        .map_err(|error| format!("无法启动 Workbench CLI：{error}"))?;
    let value: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| format!("Workbench 未返回有效 JSON（退出码 {:?}）", output.status.code()))?;
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
