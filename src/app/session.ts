/**
 * Remembers open groups and tabs between runs (in localStorage).
 * Files on disk are stored by path and re-read on start; content is only
 * stored for documents without a path or with unsaved changes.
 */
import type { DocKind } from '../code/languages';

export interface SessionDoc {
  id: string;
  name: string;
  path?: string;
  kind: DocKind;
  lang?: string;
  /** Present for untitled documents and documents with unsaved changes. */
  content?: string;
  dirty?: boolean;
  cursor?: number;
}

export interface SessionGroup {
  id: string;
  name: string;
  activeDocId: string | null;
  docs: SessionDoc[];
}

export interface Session {
  version: 1;
  activeGroupId: string;
  groups: SessionGroup[];
}

const KEY = 'editor.session.v1';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    const session = raw ? (JSON.parse(raw) as Session) : null;
    return session?.version === 1 && session.groups?.length ? session : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Quota exceeded or storage unavailable – tabs just won't be remembered.
  }
}
