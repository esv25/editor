/**
 * Things that differ between running in a browser and as the Tauri
 * desktop app (besides file I/O, which lives in src/storage/).
 */
export interface RunRequest {
  /** Program to start, e.g. "python" or a full path. */
  program: string;
  /** Arguments; "{file}" is replaced with the path of a temp file holding `code`. */
  args: string[];
  code: string;
  /** Extension for the temp file, without dot. */
  extension: string;
  /** Working directory (defaults to the temp dir). */
  cwd?: string;
  timeoutMs: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

export interface AvailableUpdate {
  version: string;
  notes?: string;
  /** Download, install and restart. `onProgress` gets 0–1, or null if the size is unknown. */
  install(onProgress?: (fraction: number | null) => void): Promise<void>;
}

export interface Platform {
  readonly isDesktop: boolean;
  setWindowTitle(title: string): void;
  /** Yes/no question to the user. */
  confirm(message: string): Promise<boolean>;
  /**
   * Called when the user tries to close the window/tab. Return true to
   * warn before closing (browser) or to be asked (desktop, via `confirm`).
   */
  onCloseRequested(hasUnsavedWork: () => boolean): void;
  /** Path of the file the app was launched with ("Open with"), if any. */
  startupFile(): Promise<string | null>;
  /** Files opened while running, e.g. "Open with" forwarded from a second launch. */
  onOpenFile?(handler: (path: string) => void): void;
  /** Show a file or folder in the system file manager (desktop only). */
  revealPath?(path: string): Promise<void>;
  /** The installed app's version (desktop only). */
  appVersion?(): Promise<string>;
  /** Look for a newer published version (desktop only). */
  checkForUpdate?(): Promise<AvailableUpdate | null>;
  /** Run a program on a code snippet (desktop only). */
  runProgram?(request: RunRequest): Promise<RunResult>;
}
