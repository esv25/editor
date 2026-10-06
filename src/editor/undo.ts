/**
 * Undo/redo steps like Word: everything typed in one go – line breaks included –
 * is one step ("Skriving"), however long it takes. A new step starts when
 * something else happens: moving the cursor (CodeMirror does that), switching
 * between typing and deleting, or a command, paste, list continuation etc.
 */
import { EditorState, StateField, Transaction, type Extension } from '@codemirror/state';
import { history, redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import type { EditorCommand } from '../commands/registry';

type EditKind = 'type' | 'delete' | 'other';

function editKind(tr: Transaction): EditKind {
  if (tr.isUserEvent('input.type')) return 'type';
  if (tr.isUserEvent('delete')) return 'delete';
  return 'other';
}

/** The kind of the last change to the document, so the next one can compare. */
const lastEdit = StateField.define<EditKind | null>({
  create: () => null,
  update: (value, tr) => (tr.docChanged ? editKind(tr) : value),
});

/** Whether `tr` may be merged into the previous undo step. */
export function joinsPreviousStep(tr: Transaction, isAdjacent: boolean): boolean {
  return isAdjacent && editKind(tr) === tr.startState.field(lastEdit, false);
}

/** Whether `tr` is a plain Enter: only a line break (and indentation) at the cursor. */
function isPlainEnter(tr: Transaction): boolean {
  if (tr.annotation(Transaction.userEvent) !== 'input' || !tr.docChanged) return false;
  let plain = true;
  tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
    if (!/^\n[ \t]*$/.test(inserted.toString())) plain = false;
  });
  return plain;
}

/**
 * CodeMirror's Enter isn't "typing" to the history, so it would always be a
 * step of its own; in Word it's part of the typing. (Enter that continues a
 * list inserts more than a line break and stays its own step, like Word's
 * AutoFormat.)
 */
const enterIsTyping = EditorState.transactionFilter.of((tr) =>
  isPlainEnter(tr)
    ? { changes: tr.changes, selection: tr.selection, effects: tr.effects, scrollIntoView: tr.scrollIntoView, userEvent: 'input.type' }
    : tr,
);

export function undoHistory(): Extension {
  // No time limit: a pause doesn't start a new step.
  return [lastEdit, enterIsTyping, history({ newGroupDelay: Infinity, joinToEvent: joinsPreviousStep })];
}

const icon = (path: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

/**
 * Typing fields outside the editor (dialogs, the code block name …) keep their
 * own Ctrl+Z; the editor's history only answers when the editor (or nothing
 * editable) has focus.
 */
function otherFieldFocused(view: EditorView): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || view.dom.contains(active)) return false;
  return active.isContentEditable || active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
}

export const undoCommands: EditorCommand[] = [
  {
    id: 'edit.undo',
    name: 'Angre',
    icon: icon('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
    key: 'Mod-z',
    scope: 'any',
    run: (view) => !otherFieldFocused(view) && undo(view),
    isEnabled: (state) => undoDepth(state) > 0,
  },
  {
    id: 'edit.redo',
    name: 'Gjør om',
    icon: icon('<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
    key: ['Mod-y', 'Mod-Shift-z'],
    scope: 'any',
    run: (view) => !otherFieldFocused(view) && redo(view),
    isEnabled: (state) => redoDepth(state) > 0,
  },
];
