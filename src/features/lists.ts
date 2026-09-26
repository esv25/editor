/**
 * List toggles: bullet list, numbered list, task list.
 *
 * If every selected line already is the requested kind, the markers are
 * removed; otherwise every line is converted to that kind (replacing other
 * list markers or heading marks).
 */
import type { EditorState, StateCommand } from '@codemirror/state';
import {
  applyChanges,
  headingPrefixLength,
  leadingWhitespace,
  parseListLine,
  selectedLines,
  type ListKind,
} from './util/markdown';
import type { Feature } from './types';

export function toggleList(kind: ListKind): StateCommand {
  return ({ state, dispatch }) => {
    const lines = selectedLines(state);
    const parsed = lines.map((line) => parseListLine(line.text));
    const remove = parsed.every((p) => p?.kind === kind);

    // Numbered lists continue from an item directly above the selection.
    const numbers = new Map<number, number>();
    const above = lines[0].number > 1 ? parseListLine(state.doc.line(lines[0].number - 1).text) : null;
    if (above?.kind === 'ordered') numbers.set(above.indent.length, above.number! + 1);

    const changes = lines.map((line, i) => {
      const list = parsed[i];
      const indent = list ? list.indent : leadingWhitespace(line.text);
      const prefixLength = list ? list.contentOffset : indent.length + headingPrefixLength(line.text.slice(indent.length));
      let insert = indent;
      if (!remove) {
        if (kind === 'bullet') insert += '- ';
        else if (kind === 'task') insert += list?.kind === 'task' ? line.text.slice(indent.length, list.contentOffset) : '- [ ] ';
        else {
          const n = numbers.get(indent.length) ?? 1;
          numbers.set(indent.length, n + 1);
          insert += `${n}. `;
        }
      }
      return { from: line.from, to: line.from + prefixLength, insert };
    });
    applyChanges(state, dispatch, changes);
    return true;
  };
}

const isKind = (kind: ListKind) => (state: EditorState) =>
  parseListLine(state.doc.lineAt(state.selection.main.head).text)?.kind === kind;

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const lists: Feature = {
  id: 'lists',
  commands: [
    {
      id: 'list.bullet',
      name: 'Punktliste',
      icon: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>'),
      key: 'Mod-Shift-8',
      run: toggleList('bullet'),
      isActive: isKind('bullet'),
    },
    {
      id: 'list.ordered',
      name: 'Nummerert liste',
      icon: svg('<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 4.5h1v3.5M4 8h2" stroke-width="1.5"/><path d="M4 10.5h2l-2 3h2" stroke-width="1.5"/><path d="M4 16.5h2l-1 1.2 1 1.3H4" stroke-width="1.5"/>'),
      key: 'Mod-Shift-7',
      run: toggleList('ordered'),
      isActive: isKind('ordered'),
    },
    {
      id: 'list.task',
      name: 'Huskeliste',
      icon: svg('<rect x="3" y="4" width="6" height="6" rx="1"/><path d="m4.5 7 1 1 2-2" stroke-width="1.5"/><rect x="3" y="14" width="6" height="6" rx="1"/><path d="M13 7h8M13 17h8"/>'),
      key: 'Mod-Shift-9',
      run: toggleList('task'),
      isActive: isKind('task'),
    },
  ],
};
