//! Runs a code snippet with an external program (python, node, …) and
//! collects its output. The frontend decides which program to use.

use serde::Serialize;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Cap on captured output per stream, so a runaway loop can't eat all memory.
const MAX_OUTPUT: usize = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    timed_out: bool,
    duration_ms: u64,
}

fn read_capped(mut reader: impl Read) -> String {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if buf.len() < MAX_OUTPUT {
                    buf.extend_from_slice(&chunk[..n.min(MAX_OUTPUT - buf.len())]);
                }
            }
        }
    }
    let mut text = String::from_utf8_lossy(&buf).into_owned();
    if buf.len() >= MAX_OUTPUT {
        text.push_str("\n… (utdata avkortet)");
    }
    text
}

fn run_blocking(
    program: String,
    args: Vec<String>,
    code: String,
    extension: String,
    cwd: Option<String>,
    timeout_ms: u64,
) -> Result<RunResult, String> {
    // Write the snippet to a fresh temp dir; "{file}" in args is replaced by its path.
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir: PathBuf = std::env::temp_dir().join("editor-run").join(stamp.to_string());
    std::fs::create_dir_all(&dir).map_err(|e| format!("Kunne ikke lage midlertidig mappe: {e}"))?;
    let file = dir.join(format!("main.{extension}"));
    std::fs::write(&file, code).map_err(|e| format!("Kunne ikke skrive midlertidig fil: {e}"))?;
    let file_str = file.to_string_lossy().into_owned();

    let mut command = Command::new(&program);
    command
        .args(args.iter().map(|a| a.replace("{file}", &file_str)))
        .current_dir(cwd.map(PathBuf::from).filter(|p| p.is_dir()).unwrap_or_else(|| dir.clone()))
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let started = Instant::now();
    let mut child = command
        .spawn()
        .map_err(|e| format!("Fant ikke eller kunne ikke starte «{program}»: {e}"))?;
    let stdout = child.stdout.take().map(|s| thread::spawn(move || read_capped(s)));
    let stderr = child.stderr.take().map(|s| thread::spawn(move || read_capped(s)));

    let timeout = Duration::from_millis(timeout_ms);
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() >= timeout => {
                timed_out = true;
                let _ = child.kill();
                break child.wait().ok();
            }
            Ok(None) => thread::sleep(Duration::from_millis(15)),
            Err(e) => return Err(format!("Feil under kjøring: {e}")),
        }
    };

    let join = |h: Option<thread::JoinHandle<String>>| h.and_then(|h| h.join().ok()).unwrap_or_default();
    let result = RunResult {
        stdout: join(stdout),
        stderr: join(stderr),
        exit_code: status.and_then(|s| s.code()),
        timed_out,
        duration_ms: started.elapsed().as_millis() as u64,
    };
    let _ = std::fs::remove_dir_all(&dir);
    Ok(result)
}

#[tauri::command]
pub async fn run_program(
    program: String,
    args: Vec<String>,
    code: String,
    extension: String,
    cwd: Option<String>,
    timeout_ms: u64,
) -> Result<RunResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_blocking(program, args, code, extension, cwd, timeout_ms))
        .await
        .map_err(|e| e.to_string())?
}
