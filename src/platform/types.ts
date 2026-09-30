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
  /** Run a program on a code snippet (desktop only). */
  runProgram?(request: RunRequest): Promise<RunResult>;
}
