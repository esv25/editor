/**
 * Task lists: "- [ ]" / "- [x]" render as clickable checkboxes.
 * Clicking toggles the character in the text; the text stays the source of truth.
 */
import { RangeSet, type Range, type StateCommand } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { activeLines } from './livePreview';
import { applyChanges, parseListLine, selectedLines } from './util/markdown';
import type { Feature } from './types';

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM() {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.checked;
    box.className = 'cm-task-checkbox';
    box.setAttribute('aria-label', this.checked ? 'Gjort' : 'Ikke gjort');
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

const checkedLine = Decoration.line({ class: 'cm-task-checked' });
const hidden = Decoration.replace({});
const boxes = [new CheckboxWidget(false), new CheckboxWidget(true)].map((widget) => Decoration.replace({ widget }));

function build(view: EditorView, hideMarkup: boolean): DecorationSet {
  const { state } = view;
  const active = activeLines(view);
  const decos: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'TaskMarker') return;
        const checked = /x/i.test(state.sliceDoc(node.from, node.to));
        const line = state.doc.lineAt(node.from);
        if (checked) decos.push(checkedLine.range(line.from));
        // Hide the "- " before the box when the cursor isn't on the line.
        const list = parseListLine(line.text);
        if (hideMarkup && list && !active.has(line.number)) {
          const markerFrom = line.from + list.indent.length;
          if (markerFrom < node.from) decos.push(hidden.range(markerFrom, node.from));
        }
        decos.push(boxes[checked ? 1 : 0].range(node.from, node.to));
      },
    });
  }
  return RangeSet.of(decos, true);
}

/** Flip "[ ]" <-> "[x]" for the task marker starting at `pos`. */
function toggleAt(view: EditorView, pos: number): boolean {
  const marker = view.state.sliceDoc(pos, pos + 3);
  if (!/^\[[ xX]\]$/.test(marker)) return false;
  view.dispatch({
    changes: { from: pos + 1, to: pos + 2, insert: marker[1] === ' ' ? 'x' : ' ' },
    userEvent: 'input.toggleTask',
  });
  return true;
}

/** Toggle done/not done for the task(s) on the selected line(s). */
export const toggleTaskDone: StateCommand = ({ state, dispatch }) => {
  const changes = [];
  for (const line of selectedLines(state)) {
    const list = parseListLine(line.text);
    if (list?.kind !== 'task') continue;
    const boxAt = line.from + line.text.indexOf('[', list.indent.length + list.marker.length);
    changes.push({ from: boxAt + 1, to: boxAt + 2, insert: list.checked ? ' ' : 'x' });
  }
  if (changes.length === 0) return false;
  applyChanges(state, dispatch, changes, 'input.toggleTask');
  return true;
};

function taskListPlugin(hideMarkup: boolean) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, hideMarkup);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
          this.decorations = build(u.view, hideMarkup);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        mousedown(event, view) {
          const target = event.target as HTMLElement;
          if (!target.classList.contains('cm-task-checkbox')) return false;
          // Handle on mousedown so the cursor doesn't jump to the line (which would reveal markup).
          event.preventDefault();
          return toggleAt(view, view.posAtDOM(target));
        },
      },
    },
  );
}

export const taskList: Feature = {
  id: 'taskList',
  extension: (settings) => taskListPlugin(settings.hideMarkup),
  commands: [
    {
      id: 'task.toggleDone',
      name: 'Merk oppgave som gjort/ugjort',
      key: 'Mod-Enter',
      run: toggleTaskDone,
    },
  ],
};
