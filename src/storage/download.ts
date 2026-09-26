/**
 * Fallback backend for browsers without the File System Access API
 * (Firefox, Safari): open via <input type=file>, save by downloading.
 * Can't write in place, so autosave is disabled with this backend.
 */
import type { FileRef, OpenedFile, StorageBackend } from './types';

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt,text/markdown,text/plain';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

function download(content: string, name: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const downloadStorage: StorageBackend = {
  canSaveInPlace: false,

  async open(): Promise<OpenedFile | null> {
    const file = await pickFile();
    if (!file) return null;
    return { file: { name: file.name }, content: await file.text() };
  },

  async save(file: FileRef, content: string): Promise<void> {
    download(content, file.name);
  },

  async saveAs(content: string, suggestedName: string): Promise<FileRef | null> {
    download(content, suggestedName);
    return { name: suggestedName };
  },
};
