import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask } from '@tauri-apps/plugin-dialog';
import type { Platform, RunRequest, RunResult } from './types';

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

  runProgram(request: RunRequest) {
    return invoke<RunResult>('run_program', { ...request });
  },
};
