/**
 * Heading commands: toggle H1/H2/H3 on the selected line(s).
 */
import type { StateCommand } from '@codemirror/state';
import { applyChanges, headingLevel, headingPrefixLength, parseListLine, selectedLines } from './util/markdown';
import type { Feature } from './types';

/** Set the selected lines to heading `level`, or back to text if they already are. */
export function toggleHeading(level: number): StateCommand {
  return ({ state, dispatch }) => {
    const lines = selectedLines(state);
    const allAtLevel = lines.every((line) => headingLevel(line.text) === level);
    const changes = lines.map((line) => {
      // Replace an existing heading prefix, or a list marker (a list item can't also be a heading).
      const list = parseListLine(line.text);
      const prefix = headingPrefixLength(line.text) || (list ? list.contentOffset : 0);
      return { from: line.from, to: line.from + prefix, insert: allAtLevel ? '' : '#'.repeat(level) + ' ' };
    });
    applyChanges(state, dispatch, changes);
    return true;
  };
}

/** Make the selected lines headings of `level` (never removes a heading). */
export function makeHeading(level: number): StateCommand {
  return ({ state, dispatch }) => {
    const lines = selectedLines(state).filter((l) => l.text.trim() !== '' && headingLevel(l.text) === 0);
    if (lines.length === 0) return false;
    applyChanges(
      state,
      dispatch,
      lines.map((line) => ({ from: line.from, insert: '#'.repeat(level) + ' ' })),
    );
    return true;
  };
}

const headingCommand = (level: number) => ({
  id: `heading.${level}`,
  name: `Overskrift ${level}`,
  label: `H${level}`,
  key: `Mod-Shift-${level}`,
  run: toggleHeading(level),
  isActive: (state: Parameters<StateCommand>[0]['state']) =>
    headingLevel(state.doc.lineAt(state.selection.main.head).text) === level,
});

export const headings: Feature = {
  id: 'headings',
  commands: [1, 2, 3].map(headingCommand),
};
