/**
 * Storage abstraction. The app only talks to a `StorageBackend`, so the
 * browser implementation (File System Access API) can be swapped for a
 * Tauri one later without touching the rest of the app.
 */

/** Opaque reference to a file. Backends extend it with what they need (a handle, a path …). */
export interface FileRef {
  readonly name: string;
  /** Absolute path, when the backend has one (desktop). */
  readonly path?: string;
}

export interface OpenedFile {
  file: FileRef;
  content: string;
}

export interface FileFilter {
  name: string;
  /** Extensions without dot. */
  extensions: string[];
}

export interface FolderEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface StorageBackend {
  /** Whether `save` can write back to the same file (enables autosave). */
  readonly canSaveInPlace: boolean;
  /** Ask the user for a file and read it. Resolves to null if cancelled. */
  open(): Promise<OpenedFile | null>;
  /** Read a file by path, if the backend supports paths (desktop only). */
  openPath?(path: string): Promise<OpenedFile>;
  /**
   * Create a new file `baseName`.`extension` in `folder` (or the default
   * documents folder), without asking. Used to autosave new documents.
   * Only backends that can do this silently implement it (desktop).
   */
  createNew?(content: string, baseName: string, extension: string, folder?: string): Promise<FileRef>;
  /** Where `createNew` puts files when no folder is given (desktop: Documents\Editor). */
  defaultFolder?(): Promise<string>;
  /** Where copies of files are kept before they're overwritten (desktop; see backupRules.ts). */
  backupFolder?(): Promise<string>;
  /** Rename a file within its folder (keeping the extension). Desktop only. */
  rename?(file: FileRef, baseName: string): Promise<FileRef>;
  /** Ask the user for a folder. Resolves to its path, or null if cancelled. Desktop only. */
  pickFolder?(): Promise<string | null>;
  /** List a folder: subfolders first, then files, each sorted by name. Desktop only. */
  listFolder?(path: string): Promise<FolderEntry[]>;
  /** Ask the user for a file of the given types. Resolves to its path, or null if cancelled. Desktop only. */
  pickFile?(options: { title: string; filters: FileFilter[] }): Promise<string | null>;
  /** Read a file's raw bytes by path (e.g. an image). Desktop only. */
  readBinary?(path: string): Promise<Uint8Array>;
  /** Ask where to save a file of the given type. Resolves to its path, or null if cancelled. Desktop only. */
  pickSavePath?(options: { title: string; defaultPath: string; filters: FileFilter[] }): Promise<string | null>;
  /** Write raw bytes to a path (exports: .docx). Desktop only. */
  writeBinary?(path: string, data: Uint8Array): Promise<void>;
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
