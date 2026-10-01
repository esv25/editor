/**
 * Window title and the status bar (save status, word count / code info).
 */
import type { EditorDocument } from '../app/document';
import { languageChoices } from '../features/codeBlockTools/runners';
import { platform } from '../platform';
import { getSettings } from '../settings';
import { storage } from '../storage';

const APP_NAME = 'Editor';

export function renderTitle(doc: EditorDocument): void {
  platform.setWindowTitle(`${doc.dirty ? '● ' : ''}${doc.name} — ${APP_NAME}`);
}

/** Save status of the active document, or a workspace message (errors) if there is one. */
export function renderSaveStatus(doc: EditorDocument, message: string | null): void {
  const el = document.getElementById('status-save')!;
  const s = doc.status;
  el.classList.toggle('error', s.kind === 'error' || message !== null);
  if (message) {
    el.textContent = message;
    return;
  }
  switch (s.kind) {
    case 'clean':
      el.textContent = doc.file ? 'Lagret' : '';
      break;
    case 'dirty':
      if (doc.file) el.textContent = 'Ulagrede endringer';
      else if (storage.createNew && getSettings().autosave.enabled) {
        const folder = doc.targetFolder || doc.folderProvider() || getSettings().autosave.folder;
        el.textContent = `Lagres automatisk i ${folder ? folder.split(/[\\/]/).filter(Boolean).pop() : 'Dokumenter\\Editor'}`;
        el.title = folder ?? '';
      }
      else el.textContent = 'Ikke lagret – Ctrl+S for å lagre til fil';
      break;
    case 'saving':
      el.textContent = 'Lagrer …';
      break;
    case 'saved':
      el.textContent = `Lagret ${s.at.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}`;
      break;
    case 'error':
      el.textContent = s.message;
      break;
  }
}

/** Words and characters for notes; language, lines and cursor position for code. */
export function renderCount(doc: EditorDocument): void {
  const { state } = doc;
  const el = document.getElementById('status-count')!;
  if (doc.kind === 'code') {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const lang = languageChoices.find((c) => c.id === doc.lang)?.label ?? (doc.lang || 'Ren tekst');
    el.textContent = `${lang} · linje ${line.number}, kol ${head - line.from + 1} · ${state.doc.lines} linjer`;
    return;
  }
  const text = state.doc.toString();
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
  el.textContent = `${words.toLocaleString('nb-NO')} ord · ${text.length.toLocaleString('nb-NO')} tegn`;
}
