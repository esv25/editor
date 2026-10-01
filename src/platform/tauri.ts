import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import type { AvailableUpdate, Platform, RunRequest, RunResult } from './types';

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
};
