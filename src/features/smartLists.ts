/**
 * Smart lists:
 * - Enter continues the list (new bullet / next number / new unchecked task)
 * - Enter on an empty item ends the list
 * - Backspace right after a marker removes it
 * - Tab / Shift+Tab nests / un-nests the item (with its sub-items)
 *
 * Enter/Backspace use lang-markdown's implementations. Indentation follows
 * CommonMark: a child item starts at the parent's content column, so
 * "1. foo" nests children by 3 spaces and "- foo" by 2.
 */
import { Prec, type ChangeSpec, type EditorState, type StateCommand } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentLess } from '@codemirror/commands';
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown';
import { insertIndent } from '../code/indentation';
import { applyChanges, findEnclosing, leadingWhitespace, parseListLine, selectedLines } from './util/markdown';
import type { Feature } from './types';

type Direction = 'in' | 'out';

/** The indent (in columns) the list item on `lineNo` should get, or null if it can't move. */
export function targetIndent(state: EditorState, lineNo: number, dir: Direction): number | null {
  const item = parseListLine(state.doc.line(lineNo).text);
  if (!item) return null;
  const current = item.indent.length;
  for (let n = lineNo - 1; n >= 1; n--) {
    const text = state.doc.line(n).text;
    const other = parseListLine(text);
    if (!other) {
      // Blank lines and indented continuation text belong to the list; anything else ends it.
      if (text.trim() === '' || leadingWhitespace(text).length > 0) continue;
      break;
    }
    const indent = other.indent.length;
    if (dir === 'in') {
      if (indent < current) return null; // we're the first child – nothing to nest under
      if (indent === current) return other.childIndent;
    } else if (indent < current) {
      return indent;
    }
  }
  return dir === 'out' && current > 0 ? 0 : null;
}

function shiftListItems(dir: Direction): StateCommand {
  return ({ state, dispatch }) => {
    const lines = selectedLines(state);
    const first = lines[0];
    const item = parseListLine(first.text);
    // Code that merely looks like a list item ("- x" in a code block) isn't one.
    if (!item || inCodeBlock(state)) return false;
    const target = targetIndent(state, first.number, dir);
    if (target === null) return true; // in a list, but can't move: swallow Tab so focus stays
    const delta = target - item.indent.length;

    // Bring sub-items (deeper-indented lines right below) along.
    let last = lines[lines.length - 1].number;
    if (lines.length === 1) {
      while (last < state.doc.lines) {
        const next = state.doc.line(last + 1).text;
        if (next.trim() === '' || leadingWhitespace(next).length <= item.indent.length) break;
        last++;
      }
    }

    const changes = [];
    for (let n = first.number; n <= last; n++) {
      const line = state.doc.line(n);
      if (line.text.trim() === '') continue;
      if (delta > 0) changes.push({ from: line.from, insert: ' '.repeat(delta) });
      else {
        const remove = Math.min(-delta, leadingWhitespace(line.text).length);
        if (remove > 0) changes.push({ from: line.from, to: line.from + remove });
      }
    }
    applyChanges(state, dispatch, changes, dir === 'in' ? 'input.indent' : 'delete.dedent');
    return true;
  };
}

/** Enter: continue the list; on an empty item, end the list (or go up one level). */
export const continueList = insertNewlineContinueMarkupCommand({ nonTightLists: false });

export const indentListItem = shiftListItems('in');
export const outdentListItem = shiftListItems('out');

/** Prose outside lists: Tab/Shift+Tab move the selected lines by two spaces. */
function shiftProse(dir: Direction): StateCommand {
  return ({ state, dispatch }) => {
    const changes = selectedLines(state).flatMap((line): ChangeSpec[] => {
      if (dir === 'in') return [{ from: line.from, insert: '  ' }];
      const remove = Math.min(2, leadingWhitespace(line.text).length);
      return remove ? [{ from: line.from, to: line.from + remove }] : [];
    });
    applyChanges(state, dispatch, changes, dir === 'in' ? 'input.indent' : 'delete.dedent');
    return true;
  };
}

function inCodeBlock(state: EditorState): boolean {
  const { from, to } = state.selection.main;
  return findEnclosing(state, from, to, 'FencedCode') !== null;
}

/** Tab outside lists: code-style indent inside code blocks, a small shift in prose. */
export const tabOutsideList: StateCommand = (target) =>
  inCodeBlock(target.state) ? insertIndent(target) : shiftProse('in')(target);
export const shiftTabOutsideList: StateCommand = (target) =>
  inCodeBlock(target.state) ? indentLess(target) : shiftProse('out')(target);

export const smartLists: Feature = {
  id: 'smartLists',
  extension: () => [
    Prec.high(
      keymap.of([
        { key: 'Enter', run: continueList },
        { key: 'Backspace', run: deleteMarkupBackward },
      ]),
    ),
    // Outside lists (and so also keeping focus in the editor).
    keymap.of([{ key: 'Tab', run: tabOutsideList, shift: shiftTabOutsideList }]),
  ],
  commands: [
    { id: 'list.indent', name: 'Rykk inn listepunkt', key: 'Tab', run: indentListItem },
    { id: 'list.outdent', name: 'Rykk ut listepunkt', key: 'Shift-Tab', run: outdentListItem },
  ],
};
