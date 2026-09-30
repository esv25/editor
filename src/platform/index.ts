/**
 * Picks the platform implementation: Tauri desktop app or plain browser.
 */
import { tauriPlatform } from './tauri';
import type { Platform } from './types';
import { webPlatform } from './web';

export const isTauri = '__TAURI_INTERNALS__' in window;

export const platform: Platform = isTauri ? tauriPlatform : webPlatform;

export type { Platform, RunRequest, RunResult } from './types';
