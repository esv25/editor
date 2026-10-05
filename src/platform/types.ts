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

export interface PtyOptions {
  /** Program to start (on PATH or a full path). */
  program: string;
  args: string[];
  cwd?: string;
  /** Extra environment variables; null removes one. */
  env?: Record<string, string | null>;
  cols: number;
  rows: number;
}

/** A program running in a pseudo terminal. */
export interface Pty {
  readonly pid: number | null;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

/** A debug adapter process (Debug Adapter Protocol over stdin/stdout). */
export interface AdapterProcess {
  /** Send one JSON message (framing is added by the host). */
  send(message: string): Promise<void>;
  kill(): void;
}

/** Starting processes for terminals and debugging (desktop only). */
export interface ProcessHost {
  spawnPty(
    options: PtyOptions,
    handlers: { onData(data: string): void; onExit(code: number | null): void },
  ): Promise<Pty>;
  startAdapter(
    options: { program: string; args: string[]; cwd?: string },
    handlers: { onMessage(json: string): void; onStderr(text: string): void; onExit(code: number | null): void },
  ): Promise<AdapterProcess>;
  /** A free local TCP port. */
  freePort(): Promise<number>;
  /** WebSocket URL of a Node process started with --inspect-brk=127.0.0.1:<port>. */
  inspectorUrl(port: number, timeoutMs: number): Promise<string>;
  /** Stop everything left over from an earlier page load. */
  reset(): Promise<void>;
}

export interface AvailableUpdate {
  version: string;
  notes?: string;
  /** Download, install and restart. `onProgress` gets 0–1, or null if the size is unknown. */
  install(onProgress?: (fraction: number | null) => void): Promise<void>;
  /** Let go of it without installing. */
  dispose?(): void;
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
  /** Open a file in its default program, e.g. a .docx in Word (desktop only). */
  openPath?(path: string): Promise<void>;
  /** Print the window's page straight to a PDF file, without a dialog (desktop only; see src/export/print.ts). */
  printToPdf?(path: string): Promise<void>;
  /** The installed app's version (desktop only). */
  appVersion?(): Promise<string>;
  /** Look for a newer published version (desktop only). */
  checkForUpdate?(): Promise<AvailableUpdate | null>;
  /** Run a program on a code snippet (desktop only). */
  runProgram?(request: RunRequest): Promise<RunResult>;
  /**
   * Page that shows an HTML preview sent to it with postMessage (desktop).
   * The app's CSP forbids inline scripts, and a srcdoc frame would inherit
   * it; this page has its own, looser CSP. Without it, previews use srcdoc.
   */
  readonly htmlPreviewUrl?: string;
  /**
   * Open another page of the app (e.g. "diagram.html") with query `params`: a
   * new window on the desktop (or focus the one already open for `key`), a new
   * tab in the browser.
   */
  openWindow(page: string, params: Record<string, string>, options: { title: string; key: string }): Promise<void>;
  /** Tell the app's other windows something happened (e.g. "file-saved"). */
  notify(event: string, payload: unknown): void;
  /** Hear what other windows tell (see `notify`). */
  listen(event: string, handler: (payload: unknown) => void): void;
  /** Run `flush` (e.g. a last save) before the window closes; the desktop waits for it. */
  beforeClose(flush: () => Promise<void>): void;
  /** Terminals and debuggers (desktop only). */
  processes?: ProcessHost;
}
