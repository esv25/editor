/**
 * Indentation for code: which unit to use (detected from the file, or the
 * language's usual one) and a VS Code-like Tab.
 */
import { countColumn, EditorSelection, type Extension, type StateCommand } from '@codemirror/state';
import { getIndentUnit, indentUnit } from '@codemirror/language';
import { indentMore } from '@codemirror/commands';

/** Languages that are usually indented with 2 spaces; most others use 4. */
const TWO_SPACES = new Set(['javascript', 'typescript', 'json', 'html', 'css', 'yaml', 'xml']);

export function defaultIndentFor(lang: string): string {
  if (lang === 'go') return '\t';
  return TWO_SPACES.has(lang) ? '  ' : '    ';
}

/**
 * The indentation a file uses: "\t" if lines are mostly tab-indented, else
 * the most common step by which indentation increases (2, 4 …). Null if the
 * file has no indented lines to go by.
 */
export function detectIndent(text: string): string | null {
  let tabLines = 0;
  let spaceLines = 0;
  const steps = new Map<number, number>();
  let previous = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const ws = /^[ \t]*/.exec(line)![0];
    if (ws.includes('\t')) {
      tabLines++;
      continue;
    }
    if (ws.length > 0) spaceLines++;
    const step = ws.length - previous;
    if (step > 0 && step <= 8) steps.set(step, (steps.get(step) ?? 0) + 1);
    previous = ws.length;
  }
  if (tabLines > spaceLines) return '\t';
  let best = 0;
  let bestCount = 0;
  for (const [step, count] of steps) {
    if (count > bestCount || (count === bestCount && step < best)) [best, bestCount] = [step, count];
  }
  return best ? ' '.repeat(best) : null;
}

/** Indent unit for a code document: what the file already uses, else the language default. */
export function indentationFor(text: string, lang: string): Extension {
  return indentUnit.of(detectIndent(text) ?? defaultIndentFor(lang));
}

/**
 * Tab in code, like VS Code: with a selection, indent the selected lines;
 * otherwise insert spaces up to the next tab stop at the cursor (or a tab
 * character when the unit is a tab).
 */
export const insertIndent: StateCommand = ({ state, dispatch }) => {
  if (state.selection.ranges.some((r) => !r.empty)) return indentMore({ state, dispatch });
  const unit = state.facet(indentUnit);
  const size = getIndentUnit(state);
  const tr = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.head);
    let insert = '\t';
    if (!unit.includes('\t')) {
      const column = countColumn(line.text.slice(0, range.head - line.from), state.tabSize);
      insert = ' '.repeat(size - (column % size));
    }
    return { changes: { from: range.head, insert }, range: EditorSelection.cursor(range.head + insert.length) };
  });
  dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.indent' }));
  return true;
};
