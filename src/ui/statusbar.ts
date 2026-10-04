/**
 * Window title and the status bar (save status, word count / code info).
 */
import type { EditorDocument } from '../app/document';
import { activeFeatures, problemCounts } from '../code/assist';
import { describeIndent } from '../code/indentation';
import { describeCommand } from '../commands/registry';
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

/** Errors and warnings in a code file (click: the list of problems). */
export function renderProblems(doc: EditorDocument): void {
  const el = document.getElementById('status-problems')!;
  const help = activeFeatures(getSettings().codeHelp);
  el.hidden = doc.kind !== 'code' || !(help.has('syntaxErrors') || help.has('names'));
  if (el.hidden) return;
  const { errors, warnings, infos } = problemCounts(doc.state);
  const parts: HTMLElement[] = [];
  const part = (cls: string, text: string) => {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    parts.push(span);
  };
  if (errors) part('sp-error', `● ${errors} feil`);
  if (warnings) part('sp-warning', `▲ ${warnings} ${warnings === 1 ? 'advarsel' : 'advarsler'}`);
  if (infos) part('sp-info', `${infos} råd`);
  if (!parts.length) part('sp-ok', '✓ Ingen feil');
  el.replaceChildren(...parts.flatMap((p, i) => (i ? [document.createTextNode('  '), p] : [p])));
  el.title = describeCommand('code.problems');
}

/** Words and characters for notes; language, lines and cursor position for code. */
export function renderCount(doc: EditorDocument): void {
  const { state } = doc;
  const el = document.getElementById('status-count')!;
  if (doc.kind === 'code') {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const lang = languageChoices.find((c) => c.id === doc.lang)?.label ?? (doc.lang || 'Ren tekst');
    el.textContent = `${lang} · linje ${line.number}, kol ${head - line.from + 1} · ${describeIndent(state, head)} · ${state.doc.lines} linjer`;
    return;
  }
  const text = state.doc.toString();
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
  el.textContent = `${words.toLocaleString('nb-NO')} ord · ${text.length.toLocaleString('nb-NO')} tegn`;
}
