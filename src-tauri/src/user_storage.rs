use crate::{collector, models::Server};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, process::Stdio, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::{SystemTime, UNIX_EPOCH}};
use tokio::{io::AsyncReadExt, sync::Semaphore, time::{timeout, Duration}};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageTarget { pub uid: u32, pub username: String, pub path: String }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageUser { pub uid: u32, pub username: String }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageEntry {
    pub uid: u32, pub username: String, pub path: String,
    pub canonical_path: Option<String>, pub status: String,
    pub bytes: Option<u64>, pub previous_bytes: Option<u64>, pub checked_at: Option<i64>, pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageScan {
    pub running: bool, pub queued: bool, pub started_at: i64,
    pub finished_at: Option<i64>, pub entries: Vec<StorageEntry>,
}

struct Job { scan: StorageScan, cancel: Arc<AtomicBool> }
#[derive(Clone)]
pub struct UserStorageManager { jobs: Arc<Mutex<HashMap<String, Job>>>, permits: Arc<Semaphore> }
impl Default for UserStorageManager {
    fn default() -> Self { Self { jobs: Arc::new(Mutex::new(HashMap::new())), permits: Arc::new(Semaphore::new(2)) } }
}
fn now() -> i64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64 }
fn quote(value: &str) -> String { format!("'{}'", value.replace('\'', "'\"'\"'")) }
fn valid_path(path: &str) -> bool { path.starts_with('/') && path.len() <= 4096 && !path.chars().any(char::is_control) && path.trim_end_matches('/') != "" }
fn valid_user(name: &str) -> bool { !name.is_empty() && name.len() <= 256 && !name.chars().any(|c| c.is_control() || c == '/' || c == '\\') }

pub async fn discover(server: &Server, password: Option<&str>, users: &[StorageUser], mounts: &[String]) -> Result<Vec<StorageTarget>, String> {
    if users.len() > 128 || mounts.len() > 128 { return Err("一次最多发现 128 个用户和挂载点".into()); }
    let roots = mounts.iter().filter(|path| valid_path(path)).map(|path| quote(path)).collect::<Vec<_>>().join(" ");
    let mut script = format!(r#"export LANG=C LC_ALL=C; set -- {} /mnt/data* /data*;
emit_candidates() {{ for root in "$@"; do [ -d "$root" ] || continue; candidate="$root/$name"; [ -d "$candidate" ] || continue; resolved=$(realpath -e -- "$candidate" 2>/dev/null) || continue; [ "$resolved" != / ] || continue; printf '%s\0%s\0%s\0' "$uid" "$name" "$resolved"; done; }};
"#, roots);
    for user in users {
        if !valid_user(&user.username) { continue; }
        script.push_str(&format!("name={}; uid={}; emit_candidates \"$@\"; ", quote(&user.username), user.uid));
    }
    // Data owners can have no currently running process. Include local regular
    // accounts when their named directory actually exists on a data root.
    script.push_str(r#"uid_min=$(awk '$1 == "UID_MIN" {print $2; exit}' /etc/login.defs 2>/dev/null); uid_min=${uid_min:-1000};
if [ -r /etc/passwd ]; then while IFS=: read -r name unused uid rest; do case "$uid" in ''|*[!0-9]*) continue ;; esac; [ "$uid" -ge "$uid_min" ] || continue; emit_candidates "$@"; done < /etc/passwd; fi"#);
    if script.len() > 65536 { return Err("发现目录参数过多，请缩小用户范围或手动添加目录".into()); }
    let (mut command, host) = collector::configured_ssh_command(server, password)?;
    command.arg(host).arg(script).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let output = timeout(Duration::from_secs(20), command.output()).await.map_err(|_| "发现用户数据目录超时".to_string())?.map_err(|e| e.to_string())?;
    if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).trim().to_string()); }
    let text = String::from_utf8_lossy(&output.stdout);
    let fields: Vec<_> = text.split('\0').collect();
    let mut targets = Vec::new(); let mut seen = std::collections::HashSet::new();
    for row in fields.chunks(3) {
        if row.len() != 3 { continue; }
        let Ok(uid) = row[0].parse() else { continue };
        if valid_path(row[2]) && seen.insert((uid, row[2].to_string())) { targets.push(StorageTarget { uid, username: row[1].into(), path: row[2].into() }); }
    }
    Ok(targets)
}

fn normalized_targets(targets: Vec<StorageTarget>) -> Result<Vec<StorageTarget>, String> {
    if targets.is_empty() || targets.len() > 64 { return Err("请选择 1–64 个用户目录进行统计".into()); }
    let mut result = Vec::new(); let mut seen = std::collections::HashSet::new();
    for mut target in targets {
        target.path = target.path.trim().trim_end_matches('/').to_string();
        if !valid_path(&target.path) || !valid_user(&target.username) { return Err("目录须为非根目录的绝对路径，且不能包含控制字符".into()); }
        if seen.insert((target.uid, target.path.clone())) { result.push(target); }
    }
    result.sort_by_key(|target| (target.uid, target.path.len()));
    Ok(result)
}

impl UserStorageManager {
    pub fn get(&self, id: &str) -> Result<Option<StorageScan>, String> { Ok(self.jobs.lock().map_err(|e| e.to_string())?.get(id).map(|job| job.scan.clone())) }
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        if let Some(job) = self.jobs.lock().map_err(|e| e.to_string())?.get(id) { job.cancel.store(true, Ordering::Release); }
        Ok(())
    }
    fn update(&self, id: &str, update: impl FnOnce(&mut StorageScan)) {
        if let Ok(mut jobs) = self.jobs.lock() { if let Some(job) = jobs.get_mut(id) { update(&mut job.scan); } }
    }
    pub fn start(&self, server: Server, password: Option<String>, targets: Vec<StorageTarget>) -> Result<StorageScan, String> {
        let targets = normalized_targets(targets)?;
        let cancel = Arc::new(AtomicBool::new(false));
        let mut jobs = self.jobs.lock().map_err(|e| e.to_string())?;
        if jobs.get(&server.id).is_some_and(|job| job.scan.running) { return Err("该服务器的目录统计仍在进行，可先取消或等待完成".into()); }
        let old = jobs.get(&server.id).map(|job| job.scan.entries.clone()).unwrap_or_default();
        let entries = targets.iter().map(|target| {
            let cached = old.iter().find(|entry| entry.uid == target.uid && entry.path == target.path);
            StorageEntry { uid: target.uid, username: target.username.clone(), path: target.path.clone(), canonical_path: cached.and_then(|entry| entry.canonical_path.clone()), status: "pending".into(), bytes: cached.and_then(|entry| entry.bytes), previous_bytes: cached.and_then(|entry| entry.previous_bytes), checked_at: cached.and_then(|entry| entry.checked_at), error: None }
        }).collect();
        let scan = StorageScan { running: true, queued: true, started_at: now(), finished_at: None, entries };
        jobs.insert(server.id.clone(), Job { scan: scan.clone(), cancel: cancel.clone() });
        drop(jobs);
        let manager = self.clone();
        tauri::async_runtime::spawn(async move {
            let permit = loop {
                if cancel.load(Ordering::Acquire) { break None; }
                tokio::select! {
                    permit = manager.permits.acquire() => { break permit.ok(); }
                    _ = tokio::time::sleep(Duration::from_millis(250)) => {}
                }
            };
            if let Some(_permit) = permit {
                manager.update(&server.id, |scan| scan.queued = false);
                let mut parents: HashMap<u32, Vec<String>> = HashMap::new();
                for (index, target) in targets.iter().enumerate() {
                    if cancel.load(Ordering::Acquire) { break; }
                    manager.update(&server.id, |scan| scan.entries[index].status = "scanning".into());
                    let outcome = scan_path(&server, password.as_deref(), target, parents.get(&target.uid).map(Vec::as_slice).unwrap_or(&[]), &cancel).await;
                    if let Ok((ref canonical, Some(_))) = outcome { parents.entry(target.uid).or_default().push(canonical.clone()); }
                    manager.update(&server.id, |scan| {
                        let entry = &mut scan.entries[index];
                        match outcome {
                            Ok((canonical, bytes)) => {
                                entry.previous_bytes = if bytes.is_some() && entry.canonical_path.as_deref() == Some(canonical.as_str()) { entry.bytes } else { None };
                                entry.canonical_path = Some(canonical); entry.status = if bytes.is_some() { "success" } else { "overlap" }.into(); entry.bytes = bytes; entry.checked_at = Some(now()); entry.error = None; }
                            Err((status, error)) => { entry.status = status; entry.error = Some(error); }
                        }
                    });
                }
            }
            manager.update(&server.id, |scan| {
                for entry in &mut scan.entries { if entry.status == "pending" || entry.status == "scanning" { entry.status = "cancelled".into(); entry.error = Some("统计已取消，已有成功结果保留".into()); } }
                scan.running = false; scan.queued = false; scan.finished_at = Some(now());
            });
        });
        Ok(scan)
    }
}

fn scan_script(path: &str, parents: &[String]) -> String {
    let mut script = format!(r#"export LANG=C LC_ALL=C; path={}; canonical=$(realpath -e -- "$path" 2>/dev/null) || {{ echo 'directory missing or inaccessible' >&2; exit 44; }}; [ -d "$canonical" ] && [ "$canonical" != / ] || exit 44; printf '__SD_PATH__%s\n' "$canonical"; "#, quote(path));
    for parent in parents { script.push_str(&format!(r#"parent={}; case "$canonical/" in "$parent/"*) printf '__SD_OVERLAP__\n'; exit 0 ;; esac; "#, quote(parent))); }
    // Deadline and low scheduling priority also bound work after an SSH drop.
    script.push_str(r#"if command -v ionice >/dev/null 2>&1 && ionice -c 3 true 2>/dev/null; then exec timeout -k 2 60 ionice -c 3 nice -n 19 du -sx -B1 -- "$canonical"; else exec timeout -k 2 60 nice -n 19 du -sx -B1 -- "$canonical"; fi"#);
    script
}

async fn scan_path(server: &Server, password: Option<&str>, target: &StorageTarget, parents: &[String], cancel: &AtomicBool) -> Result<(String, Option<u64>), (String, String)> {
    let (mut command, host) = collector::configured_ssh_command(server, password).map_err(|error| ("failed".into(), error))?;
    command.arg(host).arg(scan_script(&target.path, parents)).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| ("failed".into(), error.to_string()))?;
    let mut stdout = child.stdout.take().ok_or_else(|| ("failed".into(), "无法读取统计输出".into()))?;
    let mut stderr = child.stderr.take().ok_or_else(|| ("failed".into(), "无法读取统计错误".into()))?;
    let work = timeout(Duration::from_secs(75), async {
        async fn bounded_read(reader: &mut (impl tokio::io::AsyncRead + Unpin)) -> std::io::Result<Vec<u8>> {
            let mut result = Vec::new();
            (&mut *reader).take(64 * 1024).read_to_end(&mut result).await?;
            tokio::io::copy(reader, &mut tokio::io::sink()).await?;
            Ok(result)
        }
        let (stdout, stderr, status) = tokio::try_join!(bounded_read(&mut stdout), bounded_read(&mut stderr), child.wait())?;
        Ok::<_, std::io::Error>(std::process::Output { status, stdout, stderr })
    });
    tokio::pin!(work);
    let output = loop {
        tokio::select! {
            result = &mut work => { break result.map_err(|_| ("timeout".into(), "目录统计超时；未把未完成结果当作零占用".into()))?.map_err(|error| ("failed".into(), error.to_string()))?; }
            _ = tokio::time::sleep(Duration::from_millis(250)) => { if cancel.load(Ordering::Acquire) { return Err(("cancelled".into(), "目录统计已取消".into())); } }
        }
    };
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        let status = if matches!(output.status.code(), Some(124 | 137)) { "timeout" } else if stderr.contains("Permission denied") { "permissionDenied" } else if output.status.code() == Some(44) { "missing" } else { "failed" };
        return Err((status.into(), if stderr.is_empty() { "无法完成目录统计".into() } else { stderr.chars().take(1200).collect() }));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let canonical = stdout.lines().find_map(|line| line.strip_prefix("__SD_PATH__")).filter(|path| valid_path(path)).ok_or_else(|| ("failed".into(), "无法识别目录路径".into()))?.to_string();
    if stdout.lines().any(|line| line == "__SD_OVERLAP__") { return Ok((canonical, None)); }
    let bytes = stdout.lines().filter(|line| !line.starts_with("__SD_")).find_map(|line| line.split_whitespace().next()?.parse::<u64>().ok()).ok_or_else(|| ("failed".into(), "无法识别 du 统计结果".into()))?;
    Ok((canonical, Some(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_and_deduplicates_targets_without_accepting_root() {
        let target = StorageTarget { uid: 1000, username: "alice".into(), path: "/mnt/data/alice/".into() };
        assert_eq!(normalized_targets(vec![target.clone(), target]).unwrap().len(), 1);
        assert!(normalized_targets(vec![StorageTarget { uid: 1, username: "alice".into(), path: "/".into() }]).is_err());
    }
    #[test]
    fn measures_quoted_paths_and_skips_overlapping_children() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("alice's data"); std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("sample"), vec![7_u8; 8192]).unwrap();
        let path = path.to_string_lossy().replace('\\', "/");
        let result = std::process::Command::new("sh").args(["-c", &scan_script(&path, &[])]).output().unwrap();
        assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
        assert!(String::from_utf8_lossy(&result.stdout).lines().any(|line| line.split_whitespace().next().and_then(|value| value.parse::<u64>().ok()).is_some_and(|value| value >= 8192)));
        let parent = if cfg!(windows) { std::process::Command::new("sh").args(["-c", &format!("realpath -e -- {}", quote(&path))]).output().unwrap().stdout } else { path.clone().into_bytes() };
        let parent = String::from_utf8_lossy(&parent).trim().to_string();
        let skipped = std::process::Command::new("sh").args(["-c", &scan_script(&path, &[parent])]).output().unwrap();
        assert!(skipped.status.success());
        assert!(String::from_utf8_lossy(&skipped.stdout).contains("__SD_OVERLAP__"));
    }
}
