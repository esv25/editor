import { getVersion } from '@tauri-apps/api/app';
import { Channel, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import type { AvailableUpdate, Platform, ProcessHost, RunRequest, RunResult } from './types';

type TerminalEvent = { kind: 'output'; data: string } | { kind: 'exit'; code: number | null };
type AdapterEvent = { kind: 'message'; body: string } | { kind: 'stderr'; text: string } | { kind: 'exit'; code: number | null };

const processes: ProcessHost = {
  async spawnPty(options, handlers) {
    const channel = new Channel<TerminalEvent>();
    channel.onmessage = (event) => {
      if (event.kind === 'output') handlers.onData(event.data);
      else handlers.onExit(event.code);
    };
    const { id, pid } = await invoke<{ id: number; pid: number | null }>('terminal_spawn', { ...options, onEvent: channel });
    return {
      pid,
      write: (data) => void invoke('terminal_write', { id, data }).catch(() => {}),
      resize: (cols, rows) => void invoke('terminal_resize', { id, cols, rows }).catch(() => {}),
      kill: () => void invoke('terminal_kill', { id }),
    };
  },

  async startAdapter(options, handlers) {
    const channel = new Channel<AdapterEvent>();
    channel.onmessage = (event) => {
      if (event.kind === 'message') handlers.onMessage(event.body);
      else if (event.kind === 'stderr') handlers.onStderr(event.text);
      else handlers.onExit(event.code);
    };
    const id = await invoke<number>('adapter_start', { ...options, onEvent: channel });
    return {
      send: (body) => invoke('adapter_send', { id, body }),
      kill: () => void invoke('adapter_kill', { id }),
    };
  },

  freePort: () => invoke<number>('free_port'),
  inspectorUrl: (port, timeoutMs) => invoke<string>('inspector_url', { port, timeoutMs }),
  reset: () => invoke('processes_reset'),
};

export const tauriPlatform: Platform = {
  isDesktop: true,

  setWindowTitle(title) {
    document.title = title;
    void getCurrentWindow().setTitle(title);
  },

  confirm(message) {
    return ask(message, { title: 'Editor', kind: 'warning', okLabel: 'Ja', cancelLabel: 'Nei' });
  },

  onCloseRequested(hasUnsavedWork) {
    void getCurrentWindow().onCloseRequested(async (event) => {
      if (hasUnsavedWork() && !(await this.confirm('Dokumentet har ulagrede endringer. Lukke likevel?'))) {
        event.preventDefault();
      }
    });
  },

  startupFile() {
    return invoke<string | null>('startup_file');
  },

  onOpenFile(handler) {
    void listen<string>('open-file', (event) => handler(event.payload));
  },

  revealPath(path: string) {
    return revealItemInDir(path);
  },

  appVersion() {
    return getVersion();
  },

  async checkForUpdate(): Promise<AvailableUpdate | null> {
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body,
      async install(onProgress) {
        let total = 0;
        let done = 0;
        await update.downloadAndInstall((event) => {
          if (event.event === 'Started') total = event.data.contentLength ?? 0;
          else if (event.event === 'Progress') {
            done += event.data.chunkLength;
            onProgress?.(total ? done / total : null);
          }
        });
        // On Windows the installer closes the app itself; elsewhere restart it.
        await relaunch();
      },
    };
  },

  runProgram(request: RunRequest) {
    return invoke<RunResult>('run_program', { ...request });
  },

  processes,
};
