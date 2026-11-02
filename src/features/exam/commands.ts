/** Text-changing commands for exam practice (testable without a DOM). */
import type { ChangeSpec, EditorState, StateCommand } from '@codemirror/state';
import { parseListLine, selectedLines } from '../util/markdown';
import { findNotes, findRatings, MAX_RATING, noteText, ratingInsertAt, ratingText, rowCells } from './model';

/** Set (or step by `delta`) the rating on the given line; adds one (from 1) if it has none. */
export function ratingChange(state: EditorState, lineNo: number, next: (value: number) => number): ChangeSpec | null {
  const line = state.doc.line(lineNo);
  const token = findRatings(line.text)[0];
  // Table rows only change an existing rating (the cell the rating sits in is the table's business).
  if (!parseListLine(line.text) && !(token && rowCells(line.text))) return null;
  const value = Math.max(1, Math.min(MAX_RATING, next(token?.value ?? 1)));
  if (token) return { from: line.from + token.from, to: line.from + token.to, insert: ratingText(value) };
  const at = ratingInsertAt(line.text);
  return { from: line.from + at, insert: (at > 0 && line.text[at - 1] !== ' ' ? ' ' : '') + ratingText(value) };
}

function stepRating(delta: number): StateCommand {
  return ({ state, dispatch }) => {
    const changes = selectedLines(state)
      .map((l) => ratingChange(state, l.number, (v) => (findRatings(l.text).length ? v + delta : 1)))
      .filter((c): c is ChangeSpec => c !== null);
    if (!changes.length) return false;
    dispatch(state.update({ changes, userEvent: 'input.examRating' }));
    return true;
  };
}

/** Raise/lower understanding on the selected list items (the first press adds a rating). */
export const ratingUp = stepRating(1);
export const ratingDown = stepRating(-1);

/** Replace the note starting at `from` (a document position) with `text`; empty text removes it. */
export function noteChange(state: EditorState, from: number, text: string): ChangeSpec | null {
  const line = state.doc.lineAt(from);
  const note = findNotes(line.text).find((n) => line.from + n.from === from);
  if (!note) return null;
  if (text.trim()) return { from, to: line.from + note.to, insert: noteText(text) };
  const before = from > line.from && line.text[note.from - 1] === ' ' ? 1 : 0;
  return { from: from - before, to: line.from + note.to, insert: '' };
}

/** Add an empty-ish note at the end of a list line; returns where it starts. */
export function addNoteChange(state: EditorState, lineNo: number, text = 'Forklaring'): { change: ChangeSpec; at: number } | null {
  const line = state.doc.line(lineNo);
  if (!parseListLine(line.text)) return null;
  const end = line.from + line.text.trimEnd().length;
  const sep = line.text.trimEnd().endsWith(' ') || end === line.from ? '' : ' ';
  return { change: { from: end, to: line.to, insert: sep + noteText(text) }, at: end + sep.length };
}

/** Insert a link to `dest` on a list line, before its notes. */
export function addLinkChange(state: EditorState, lineNo: number, label: string, dest: string): ChangeSpec {
  const line = state.doc.line(lineNo);
  const note = findNotes(line.text)[0];
  const at = note ? note.from : line.text.trimEnd().length;
  const link = `[${label.replace(/([[\]])/g, '\\$1')}](${/[\s()]/.test(dest) ? `<${dest}>` : dest})`;
  const pad = at > 0 && line.text[at - 1] !== ' ' ? ' ' : '';
  return { from: line.from + at, insert: pad + link + (note ? ' ' : '') };
}
