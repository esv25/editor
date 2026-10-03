//! Terminals: a shell, or a program started from the editor (run/debug), in a
//! pseudo console (ConPTY on Windows). Output is streamed to the frontend over
//! a channel; keystrokes come back with `terminal_write`.

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

struct Terminal {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

/// Open terminals by id. Each has its own locks, so a slow write to one
/// terminal never blocks the others.
#[derive(Default)]
pub struct Terminals {
    next_id: AtomicU32,
    open: Mutex<HashMap<u32, Arc<Terminal>>>,
}

impl Terminals {
    fn get(&self, id: u32) -> Option<Arc<Terminal>> {
        self.open.lock().unwrap().get(&id).cloned()
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TerminalEvent {
    Output { data: String },
    Exit { code: Option<u32> },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Spawned {
    id: u32,
    pid: Option<u32>,
}

/// Decode what's complete in `pending`; a character split across two reads
/// stays behind until the rest of it arrives.
fn take_utf8(pending: &mut Vec<u8>) -> String {
    let complete = match std::str::from_utf8(pending) {
        Ok(_) => pending.len(),
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        Err(_) => pending.len(), // Invalid bytes: decode lossily.
    };
    let rest = pending.split_off(complete);
    let text = String::from_utf8_lossy(pending).into_owned();
    *pending = rest;
    text
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn terminal_spawn(
    app: AppHandle,
    terminals: State<'_, Terminals>,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, Option<String>>>,
    cols: u16,
    rows: u16,
    on_event: Channel<TerminalEvent>,
) -> Result<Spawned, String> {
    let size = PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 };
    let pair = native_pty_system().openpty(size).map_err(|e| format!("Kunne ikke lage terminal: {e}"))?;

    let mut command = CommandBuilder::new(&program);
    command.args(&args);
    if let Some(dir) = cwd.filter(|d| Path::new(d).is_dir()) {
        command.cwd(dir);
    }
    for (key, value) in env.unwrap_or_default() {
        match value {
            Some(value) => command.env(key, value),
            None => command.env_remove(key),
        }
    }
    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| format!("Fant ikke eller kunne ikke starte «{program}»: {e}"))?;
    // The pseudo console closes when the last handle goes; only the master should hold it.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let pid = child.process_id();
    let terminal = Arc::new(Terminal {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        killer: Mutex::new(child.clone_killer()),
    });
    let id = terminals.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    terminals.open.lock().unwrap().insert(id, terminal);

    let output = on_event.clone();
    let reader_thread = thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        let mut pending = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let data = take_utf8(&mut pending);
                    if !data.is_empty() && output.send(TerminalEvent::Output { data }).is_err() {
                        break;
                    }
                }
            }
        }
    });

    thread::spawn(move || {
        let code = child.wait().ok().map(|status| status.exit_code());
        // ConPTY renders output on its own schedule; give the last of it time to
        // arrive, then close the console so the reader sees the end of the stream.
        thread::sleep(Duration::from_millis(150));
        let closed = app.state::<Terminals>().open.lock().unwrap().remove(&id);
        drop(closed);
        let _ = reader_thread.join();
        let _ = on_event.send(TerminalEvent::Exit { code });
    });

    Ok(Spawned { id, pid })
}

#[tauri::command]
pub fn terminal_write(terminals: State<'_, Terminals>, id: u32, data: String) -> Result<(), String> {
    let Some(terminal) = terminals.get(id) else { return Ok(()) };
    let mut writer = terminal.writer.lock().unwrap();
    writer.write_all(data.as_bytes()).and_then(|_| writer.flush()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_resize(terminals: State<'_, Terminals>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let Some(terminal) = terminals.get(id) else { return Ok(()) };
    let size = PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 };
    let result = terminal.master.lock().unwrap().resize(size);
    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_kill(terminals: State<'_, Terminals>, id: u32) {
    if let Some(terminal) = terminals.get(id) {
        let _ = terminal.killer.lock().unwrap().kill();
    }
}

/// Stop every terminal; used when the page (re)loads so nothing is left orphaned.
pub fn kill_all(terminals: &Terminals) {
    let all: Vec<_> = terminals.open.lock().unwrap().values().cloned().collect();
    for terminal in all {
        let _ = terminal.killer.lock().unwrap().kill();
    }
}

#[cfg(test)]
mod tests {
    use super::take_utf8;

    #[test]
    fn keeps_split_characters_for_the_next_read() {
        let bytes = "blåbær".as_bytes();
        let mut pending = bytes[..3].to_vec(); // "bl" + first byte of "å"
        assert_eq!(take_utf8(&mut pending), "bl");
        assert_eq!(pending.len(), 1);
        pending.extend_from_slice(&bytes[3..]);
        assert_eq!(take_utf8(&mut pending), "åbær");
        assert!(pending.is_empty());
    }
}
