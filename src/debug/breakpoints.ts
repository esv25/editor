/**
 * Breakpoints (red dots in the gutter) and the line a debug session is
 * paused on, for code files. Breakpoints live in each document's editor
 * state, so they follow the text as it's edited.
 */
import { RangeSet, StateEffect, StateField, type EditorState, type Extension, type Transaction } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, gutter, lineNumbers, type ViewUpdate } from '@codemirror/view';

class BreakpointMarker extends GutterMarker {
  toDOM() {
    const dot = document.createElement('span');
    dot.className = 'cm-breakpoint';
    return dot;
  }
}
const breakpointMarker = new BreakpointMarker();

class ExecutionMarker extends GutterMarker {
  constructor(readonly top: boolean) {
    super();
  }
  eq(other: ExecutionMarker) {
    return other.top === this.top;
  }
  toDOM() {
    const arrow = document.createElement('span');
    arrow.className = `cm-exec-arrow${this.top ? '' : ' cm-exec-arrow-frame'}`;
    return arrow;
  }
}

/** Toggle the breakpoint on the line at this position. */
export const toggleBreakpointEffect = StateEffect.define<number>({ map: (pos, changes) => changes.mapPos(pos) });
/** Replace all breakpoints (1-based line numbers), e.g. when restoring a session. */
export const setBreakpointsEffect = StateEffect.define<number[]>();

export const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    if (tr.docChanged && set.size > 0) {
      // Keep each breakpoint at the start of its line, moving with the line's text
      // (Enter at the start of a line pushes the breakpoint down with the code).
      const starts = new Set<number>();
      set.between(0, tr.startState.doc.length, (from) => {
        starts.add(tr.state.doc.lineAt(tr.changes.mapPos(from, 1)).from);
      });
      set = RangeSet.of([...starts].sort((a, b) => a - b).map((pos) => breakpointMarker.range(pos)));
    }
    for (const effect of tr.effects) {
      if (effect.is(toggleBreakpointEffect)) {
        const line = tr.state.doc.lineAt(effect.value);
        let had = false;
        set.between(line.from, line.to, () => {
          had = true;
        });
        set = had
          ? set.update({ filter: (from) => from < line.from || from > line.to })
          : set.update({ add: [breakpointMarker.range(line.from)] });
      } else if (effect.is(setBreakpointsEffect)) {
        const { doc } = tr.state;
        const lines = [...new Set(effect.value)].filter((n) => n >= 1 && n <= doc.lines).sort((a, b) => a - b);
        set = RangeSet.of(lines.map((n) => breakpointMarker.range(doc.line(n).from)));
      }
    }
    return set;
  },
});

/** Line numbers (1-based, sorted) that have a breakpoint. */
export function breakpointLines(state: EditorState): number[] {
  const set = state.field(breakpointField, false);
  if (!set) return [];
  const lines = new Set<number>();
  set.between(0, state.doc.length, (from) => {
    lines.add(state.doc.lineAt(from).number);
  });
  return [...lines].sort((a, b) => a - b);
}

/** F9: breakpoint on/off on the cursor's line(s). */
export function toggleBreakpoint(view: EditorView): boolean {
  if (!view.state.field(breakpointField, false)) return false;
  const lines = new Set(view.state.selection.ranges.map((r) => view.state.doc.lineAt(r.head).from));
  view.dispatch({ effects: [...lines].map((pos) => toggleBreakpointEffect.of(pos)) });
  return true;
}

/** Whether this transaction changed the breakpoints (or moved them by editing). */
export function breakpointsChanged(update: ViewUpdate): boolean {
  if (!update.state.field(breakpointField, false)) return false;
  return update.transactions.some(
    (tr: Transaction) =>
      tr.effects.some((e) => e.is(toggleBreakpointEffect) || e.is(setBreakpointsEffect)) ||
      (tr.docChanged && update.startState.field(breakpointField).size > 0),
  );
}

// ---------- Where execution is paused ----------

export interface ExecutionLine {
  line: number;
  /** The innermost frame (where the program actually is), not a caller picked in the call stack. */
  top: boolean;
}

export const setExecutionLine = StateEffect.define<ExecutionLine | null>();

export const executionField = StateField.define<ExecutionLine | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setExecutionLine)) value = effect.value;
    if (value && tr.docChanged) {
      const pos = tr.changes.mapPos(tr.startState.doc.line(Math.min(value.line, tr.startState.doc.lines)).from);
      value = { ...value, line: tr.state.doc.lineAt(pos).number };
    }
    return value;
  },
  provide: (field) =>
    EditorView.decorations.compute([field], (state) => {
      const exec = state.field(field);
      if (!exec || exec.line > state.doc.lines) return Decoration.none;
      const cls = exec.top ? 'cm-exec-line' : 'cm-exec-line cm-exec-line-frame';
      return Decoration.set([Decoration.line({ class: cls }).range(state.doc.line(exec.line).from)]);
    }),
});

const executionMarkers = (state: EditorState) => {
  const exec = state.field(executionField);
  if (!exec || exec.line > state.doc.lines) return RangeSet.empty;
  return RangeSet.of([new ExecutionMarker(exec.top).range(state.doc.line(exec.line).from)]);
};

/** Clicking a line number or the space before it toggles a breakpoint (a big target on purpose). */
const toggleOnClick = {
  mousedown(view: EditorView, line: { from: number }, event: Event) {
    if ((event as MouseEvent).button !== 0) return false;
    view.dispatch({ effects: toggleBreakpointEffect.of(line.from) });
    return true;
  },
};

/** Gutter with breakpoints and the paused line, plus clickable line numbers. */
export function breakpointGutter(): Extension {
  return [
    breakpointField,
    executionField,
    gutter({
      class: 'cm-breakpoint-gutter',
      markers: (view) => [view.state.field(breakpointField), executionMarkers(view.state)],
      initialSpacer: () => breakpointMarker,
      domEventHandlers: toggleOnClick,
    }),
    lineNumbers({ domEventHandlers: toggleOnClick }),
  ];
}
