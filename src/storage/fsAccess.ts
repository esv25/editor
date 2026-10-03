/**
 * Storage backend using the File System Access API (Chrome, Edge).
 * Files are opened and saved in place, so autosave works.
 */
import { codeFileExtensions } from '../code/fileTypes';
import { NeedsPermissionError, type FileRef, type OpenedFile, type StorageBackend } from './types';

interface HandleRef extends FileRef {
  handle: FileSystemFileHandle;
}

const pickerTypes: FilePickerAcceptType[] = [
  {
    description: 'Markdown og kode',
    accept: {
      'text/markdown': ['.md', '.markdown'],
      'text/plain': ['.txt', ...codeFileExtensions.map((ext) => `.${ext}` as const)],
    },
  },
];

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

async function hasWriteAccess(handle: FileSystemFileHandle, ask: boolean): Promise<boolean> {
  const opts = { mode: 'readwrite' } as const;
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (!ask) return false;
  try {
    return (await handle.requestPermission(opts)) === 'granted';
  } catch {
    // requestPermission throws without a user gesture (e.g. from autosave).
    return false;
  }
}

async function write(handle: FileSystemFileHandle, content: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

export const fsAccessStorage: StorageBackend = {
  canSaveInPlace: true,

  async open(): Promise<OpenedFile | null> {
    try {
      const [handle] = await window.showOpenFilePicker({ types: pickerTypes, multiple: false });
      const content = await (await handle.getFile()).text();
      // Ask for write access right away, while we still have the user's click.
      void hasWriteAccess(handle, true);
      const file: HandleRef = { name: handle.name, handle };
      return { file, content };
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  },

  async save(file: FileRef, content: string): Promise<void> {
    const { handle } = file as HandleRef;
    if (!(await hasWriteAccess(handle, true))) throw new NeedsPermissionError();
    await write(handle, content);
  },

  async saveAs(content: string, suggestedName: string): Promise<FileRef | null> {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName, types: pickerTypes });
      await write(handle, content);
      const file: HandleRef = { name: handle.name, handle };
      return file;
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  },
};
