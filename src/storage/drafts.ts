/**
 * Crash/reload safety net: unsaved work is mirrored to localStorage and
 * restored on the next start. Cleared as soon as the document is saved.
 */

export interface Draft {
  name: string;
  content: string;
  savedAt: number;
}

const KEY = 'editor.draft.v1';

export const drafts = {
  load(): Draft | null {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as Draft) : null;
    } catch {
      return null;
    }
  },
  save(name: string, content: string): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ name, content, savedAt: Date.now() } satisfies Draft));
    } catch {
      // Quota exceeded or storage unavailable – nothing sensible to do.
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // ignore
    }
  },
};
