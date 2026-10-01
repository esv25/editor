/**
 * Storage backend for the Tauri desktop app: native file dialogs and
 * direct file system access via @tauri-apps/plugin-dialog and plugin-fs.
 */
import { open, save } from '@tauri-apps/plugin-dialog';
import { documentDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, rename, writeTextFile } from '@tauri-apps/plugin-fs';
import { codeFileExtensions } from '../code/languages';
import type { FileRef, OpenedFile, StorageBackend } from './types';

interface PathRef extends FileRef {
  readonly path: string;
}

const filters = [
  { name: 'Markdown og kode', extensions: ['md', 'markdown', 'txt', ...codeFileExtensions] },
  { name: 'Markdown og tekst', extensions: ['md', 'markdown', 'txt'] },
  { name: 'Alle filer', extensions: ['*'] },
];

const refFor = (path: string): PathRef => ({ name: path.split(/[\\/]/).pop() ?? path, path });

export const tauriStorage: StorageBackend = {
  canSaveInPlace: true,

  async open(): Promise<OpenedFile | null> {
    const path = await open({ multiple: false, directory: false, filters });
    return path ? this.openPath!(path) : null;
  },

  async openPath(path: string): Promise<OpenedFile> {
    return { file: refFor(path), content: await readTextFile(path) };
  },

  async createNew(content: string, baseName: string, extension: string, folder?: string): Promise<FileRef> {
    const dir = folder || (await join(await documentDir(), 'Editor'));
    await mkdir(dir, { recursive: true });
    let path = await join(dir, `${baseName}.${extension}`);
    for (let i = 2; await exists(path); i++) path = await join(dir, `${baseName} (${i}).${extension}`);
    await writeTextFile(path, content);
    return refFor(path);
  },

  async rename(file: FileRef, baseName: string): Promise<FileRef> {
    const oldPath = (file as PathRef).path;
    const dir = oldPath.slice(0, Math.max(oldPath.lastIndexOf('\\'), oldPath.lastIndexOf('/')));
    const ext = /\.[^.\\/]+$/.exec(oldPath)?.[0] ?? '.md';
    let path = await join(dir, baseName + ext);
    // Same name ignoring case is the same file on Windows – just rename it.
    for (let i = 2; path.toLowerCase() !== oldPath.toLowerCase() && (await exists(path)); i++) {
      path = await join(dir, `${baseName} (${i})${ext}`);
    }
    if (path !== oldPath) await rename(oldPath, path);
    return refFor(path);
  },

  async save(file: FileRef, content: string): Promise<void> {
    await writeTextFile((file as PathRef).path, content);
  },

  async saveAs(content: string, suggestedName: string): Promise<FileRef | null> {
    const path = await save({ defaultPath: suggestedName, filters });
    if (!path) return null;
    await writeTextFile(path, content);
    return refFor(path);
  },
};
