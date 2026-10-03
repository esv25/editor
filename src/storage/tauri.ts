/**
 * Storage backend for the Tauri desktop app: native file dialogs and
 * direct file system access via @tauri-apps/plugin-dialog and plugin-fs.
 */
import { open, save } from '@tauri-apps/plugin-dialog';
import { appLocalDataDir, documentDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readDir, readFile, readTextFile, remove, rename, writeTextFile } from '@tauri-apps/plugin-fs';
import { codeFileExtensions } from '../code/fileTypes';
import { backupDay, backupFileName, expiredBackupDays } from './backupRules';
import type { FileRef, FolderEntry, OpenedFile, StorageBackend } from './types';

interface PathRef extends FileRef {
  readonly path: string;
}

const filters = [
  { name: 'Markdown og kode', extensions: ['md', 'markdown', 'txt', ...codeFileExtensions] },
  { name: 'Markdown og tekst', extensions: ['md', 'markdown', 'txt'] },
  { name: 'Alle filer', extensions: ['*'] },
];

const refFor = (path: string): PathRef => ({ name: path.split(/[\\/]/).pop() ?? path, path });

/** Files already backed up this session (compared like Windows paths). */
const backedUp = new Set<string>();
let pruned = false;

const backupRoot = async () => join(await appLocalDataDir(), 'backups');

/**
 * Before a file is overwritten the first time this session, copy what's on
 * disk to backups/<day>/ (see backupRules.ts). A failed backup never stops
 * the save.
 */
async function backupBeforeOverwrite(path: string): Promise<void> {
  const key = path.replace(/\\/g, '/').toLowerCase();
  if (backedUp.has(key)) return;
  backedUp.add(key);
  try {
    if (!(await exists(path))) return;
    const now = new Date();
    const root = await backupRoot();
    const dir = await join(root, backupDay(now));
    await mkdir(dir, { recursive: true });
    await writeTextFile(await join(dir, backupFileName(now, refFor(path).name)), await readTextFile(path));
    if (!pruned) {
      pruned = true;
      const days = (await readDir(root)).filter((e) => e.isDirectory).map((e) => e.name);
      for (const day of expiredBackupDays(days, now)) await remove(await join(root, day), { recursive: true });
    }
  } catch (err) {
    console.warn('Kunne ikke ta sikkerhetskopi av', path, err);
  }
}

export const tauriStorage: StorageBackend = {
  canSaveInPlace: true,

  async open(): Promise<OpenedFile | null> {
    const path = await open({ multiple: false, directory: false, filters });
    return path ? this.openPath!(path) : null;
  },

  async openPath(path: string): Promise<OpenedFile> {
    return { file: refFor(path), content: await readTextFile(path) };
  },

  async defaultFolder(): Promise<string> {
    return join(await documentDir(), 'Editor');
  },

  async createNew(content: string, baseName: string, extension: string, folder?: string): Promise<FileRef> {
    const dir = folder || (await this.defaultFolder!());
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

  async pickFolder(): Promise<string | null> {
    const path = await open({ directory: true, multiple: false, title: 'Velg mappe for gruppen' });
    return typeof path === 'string' ? path : null;
  },

  async listFolder(path: string): Promise<FolderEntry[]> {
    const entries = await readDir(path);
    const collator = new Intl.Collator('nb', { numeric: true, sensitivity: 'base' });
    return (
      await Promise.all(
        entries
          // Hidden files and tool folders are just noise in a notes sidebar.
          .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== '__pycache__')
          .map(async (e) => ({ name: e.name, path: await join(path, e.name), isDirectory: e.isDirectory })),
      )
    ).sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || collator.compare(a.name, b.name));
  },

  async pickFile({ title, filters }): Promise<string | null> {
    const path = await open({ multiple: false, directory: false, title, filters });
    return typeof path === 'string' ? path : null;
  },

  backupFolder: backupRoot,

  readBinary(path: string): Promise<Uint8Array> {
    return readFile(path);
  },

  async save(file: FileRef, content: string): Promise<void> {
    const path = (file as PathRef).path;
    await backupBeforeOverwrite(path);
    await writeTextFile(path, content);
  },

  async saveAs(content: string, suggestedName: string): Promise<FileRef | null> {
    const path = await save({ defaultPath: suggestedName, filters });
    if (!path) return null;
    await backupBeforeOverwrite(path);
    await writeTextFile(path, content);
    return refFor(path);
  },
};
