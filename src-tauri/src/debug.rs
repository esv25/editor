//! Debugging support:
//! - debug adapters: programs speaking the Debug Adapter Protocol on
//!   stdin/stdout (e.g. debugpy). Rust does the message framing; the
//!   frontend sends and receives whole JSON messages.
//! - Node: a free port for `--inspect-brk` and the inspector's WebSocket URL.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

struct Adapter {
    stdin: Mutex<ChildStdin>,
    child: Mutex<Child>,
}

#[derive(Default)]
pub struct Adapters {
    next_id: AtomicU32,
    open: Mutex<HashMap<u32, Arc<Adapter>>>,
}

impl Adapters {
    fn get(&self, id: u32) -> Option<Arc<Adapter>> {
        self.open.lock().unwrap().get(&id).cloned()
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AdapterEvent {
    Message { body: String },
    Stderr { text: String },
    Exit { code: Option<i32> },
}

/// Read one "Content-Length: n\r\n\r\n<n bytes>" message; None at end of stream.
fn read_message(reader: &mut impl BufRead) -> Option<String> {
    loop {
        let mut length = None;
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).ok()? == 0 {
                return None;
            }
            let line = line.trim_end();
            if line.is_empty() {
                break;
            }
            if let Some((name, value)) = line.split_once(':') {
                if name.trim().eq_ignore_ascii_case("content-length") {
                    length = value.trim().parse::<usize>().ok();
                }
            }
        }
        // A header block without a length: skip it and look for the next one.
        let Some(length) = length else { continue };
        let mut body = vec![0u8; length];
        reader.read_exact(&mut body).ok()?;
        return Some(String::from_utf8_lossy(&body).into_owned());
    }
}

#[tauri::command]
pub fn adapter_start(
    app: AppHandle,
    adapters: State<'_, Adapters>,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    on_event: Channel<AdapterEvent>,
) -> Result<u32, String> {
    let mut command = Command::new(&program);
    command
        .args(&args)
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd.filter(|d| Path::new(d).is_dir()) {
        command.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Fant ikke eller kunne ikke starte «{program}»: {e}"))?;
    let stdout = child.stdout.take().ok_or("Ingen stdout fra feilsøkeren")?;
    let stderr = child.stderr.take().ok_or("Ingen stderr fra feilsøkeren")?;
    let stdin = child.stdin.take().ok_or("Ingen stdin til feilsøkeren")?;

    let id = adapters.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let adapter = Arc::new(Adapter { stdin: Mutex::new(stdin), child: Mutex::new(child) });
    adapters.open.lock().unwrap().insert(id, adapter.clone());

    let errors = on_event.clone();
    let stderr_thread = thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        while reader.read_line(&mut line).map(|n| n > 0).unwrap_or(false) {
            let _ = errors.send(AdapterEvent::Stderr { text: std::mem::take(&mut line) });
        }
    });

    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        while let Some(body) = read_message(&mut reader) {
            if on_event.send(AdapterEvent::Message { body }).is_err() {
                break;
            }
        }
        // Output is closed; the process is ending (or has ended).
        let code = loop {
            match adapter.child.lock().unwrap().try_wait() {
                Ok(Some(status)) => break status.code(),
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(_) => break None,
            }
        };
        let _ = stderr_thread.join();
        app.state::<Adapters>().open.lock().unwrap().remove(&id);
        let _ = on_event.send(AdapterEvent::Exit { code });
    });

    Ok(id)
}

#[tauri::command]
pub fn adapter_send(adapters: State<'_, Adapters>, id: u32, body: String) -> Result<(), String> {
    let Some(adapter) = adapters.get(id) else { return Err("Feilsøkeren er avsluttet".into()) };
    let mut stdin = adapter.stdin.lock().unwrap();
    write!(stdin, "Content-Length: {}\r\n\r\n{}", body.len(), body)
        .and_then(|_| stdin.flush())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn adapter_kill(adapters: State<'_, Adapters>, id: u32) {
    if let Some(adapter) = adapters.get(id) {
        let _ = adapter.child.lock().unwrap().kill();
    }
}

pub fn kill_all(adapters: &Adapters) {
    let all: Vec<_> = adapters.open.lock().unwrap().values().cloned().collect();
    for adapter in all {
        let _ = adapter.child.lock().unwrap().kill();
    }
}

/// A TCP port nothing listens on right now (for `node --inspect-brk=127.0.0.1:<port>`).
#[tauri::command]
pub fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

fn fetch_inspector_url(port: u16) -> Option<String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    write!(stream, "GET /json/list HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n").ok()?;
    // Node keeps the connection open, so read until the body is complete rather than to the end.
    let mut response = Vec::new();
    let mut chunk = [0u8; 4096];
    let body = loop {
        let n = stream.read(&mut chunk).ok()?;
        response.extend_from_slice(&chunk[..n]);
        let text = String::from_utf8_lossy(&response).into_owned();
        if let Some((head, body)) = text.split_once("\r\n\r\n") {
            let length = head.lines().find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.trim().eq_ignore_ascii_case("content-length").then(|| value.trim().parse::<usize>().ok())?
            });
            if n == 0 || length.is_some_and(|len| body.len() >= len) {
                break body.to_string();
            }
        }
        if n == 0 {
            return None;
        }
    };
    let targets: Vec<serde_json::Value> = serde_json::from_str(&body).ok()?;
    targets.iter().find_map(|t| t.get("webSocketDebuggerUrl")?.as_str().map(String::from))
}

/// The WebSocket URL of a Node process started with `--inspect-brk=127.0.0.1:<port>`,
/// waiting for it to come up.
#[tauri::command]
pub async fn inspector_url(port: u16, timeout_ms: u64) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        loop {
            if let Some(url) = fetch_inspector_url(port) {
                return Ok(url);
            }
            if started.elapsed() > Duration::from_millis(timeout_ms) {
                return Err("Fikk ikke kontakt med Node sin feilsøker".to_string());
            }
            thread::sleep(Duration::from_millis(100));
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::read_message;
    use std::io::Cursor;

    #[test]
    fn reads_framed_messages() {
        let body = r#"{"text":"blåbær"}"#;
        let data = format!("Content-Length: {}\r\n\r\n{body}Content-Length: 2\r\n\r\n{{}}", body.len());
        let mut reader = Cursor::new(data.into_bytes());
        assert_eq!(read_message(&mut reader).as_deref(), Some(body));
        assert_eq!(read_message(&mut reader).as_deref(), Some("{}"));
        assert_eq!(read_message(&mut reader), None);
    }
}
