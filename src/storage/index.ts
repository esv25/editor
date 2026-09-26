/**
 * Picks the storage backend for the current platform.
 * When packaging with Tauri, add a tauri.ts backend and select it here.
 */
import { downloadStorage } from './download';
import { fsAccessStorage } from './fsAccess';
import type { StorageBackend } from './types';

export const storage: StorageBackend = 'showOpenFilePicker' in window ? fsAccessStorage : downloadStorage;

export * from './types';
export { drafts } from './drafts';
