/**
 * Picks the storage backend for the current platform:
 * Tauri (desktop) → File System Access API (Chrome/Edge) → download fallback.
 */
import { isTauri } from '../platform';
import { downloadStorage } from './download';
import { fsAccessStorage } from './fsAccess';
import { tauriStorage } from './tauri';
import type { StorageBackend } from './types';

export const storage: StorageBackend = isTauri
  ? tauriStorage
  : 'showOpenFilePicker' in window
    ? fsAccessStorage
    : downloadStorage;

export * from './types';
export { drafts } from './drafts';
