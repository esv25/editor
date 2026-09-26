/**
 * Storage abstraction. The app only talks to a `StorageBackend`, so the
 * browser implementation (File System Access API) can be swapped for a
 * Tauri one later without touching the rest of the app.
 */

/** Opaque reference to a file. Backends extend it with what they need (a handle, a path …). */
export interface FileRef {
  readonly name: string;
}

export interface OpenedFile {
  file: FileRef;
  content: string;
}

export interface StorageBackend {
  /** Whether `save` can write back to the same file (enables autosave). */
  readonly canSaveInPlace: boolean;
  /** Ask the user for a file and read it. Resolves to null if cancelled. */
  open(): Promise<OpenedFile | null>;
  /** Write to an already-known file. */
  save(file: FileRef, content: string): Promise<void>;
  /** Ask the user where to save. Resolves to null if cancelled. */
  saveAs(content: string, suggestedName: string): Promise<FileRef | null>;
}

/** Thrown when the backend needs a user gesture (e.g. a permission prompt) to write. */
export class NeedsPermissionError extends Error {
  constructor() {
    super('Trenger skrivetilgang');
  }
}
