/**
 * Window title, document title in the top bar, and the status bar
 * (save status + word count).
 */
import type { EditorState } from '@codemirror/state';
import type { DocumentController } from '../app/document';

const APP_NAME = 'Editor';

export function renderTitle(doc: DocumentController): void {
  document.title = `${doc.dirty ? '● ' : ''}${doc.name} — ${APP_NAME}`;
  const el = document.getElementById('doc-title')!;
  el.replaceChildren();
  if (doc.dirty) {
    const dot = document.createElement('span');
    dot.className = 'dirty';
    dot.textContent = '●';
    dot.title = 'Ulagrede endringer';
    el.append(dot);
  }
  el.append(doc.name);
  el.title = doc.file ? doc.name : `${doc.name} (ikke lagret til fil ennå)`;
}

export function renderSaveStatus(doc: DocumentController): void {
  const el = document.getElementById('status-save')!;
  const s = doc.status;
  el.classList.toggle('error', s.kind === 'error');
  switch (s.kind) {
    case 'clean':
      el.textContent = doc.file ? 'Lagret' : '';
      break;
    case 'dirty':
      el.textContent = doc.file ? 'Ulagrede endringer' : 'Ikke lagret – Ctrl+S for å lagre til fil';
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

export function renderCount(state: EditorState): void {
  const text = state.doc.toString();
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
  document.getElementById('status-count')!.textContent =
    `${words.toLocaleString('nb-NO')} ord · ${text.length.toLocaleString('nb-NO')} tegn`;
}
