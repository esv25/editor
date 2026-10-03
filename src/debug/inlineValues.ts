/**
 * Highlighted variables in the code while debugging: their values at the end
 * of the paused line, and each place they occur marked in their colour (not
 * inside strings or comments). Both come from `executionField`, which the
 * debug controller sets.
 */
import { syntaxTree } from '@codemirror/language';
import type { Range } from '@codemirror/state';
import { Decoration, ViewPlugin, WidgetType, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';
import { executionField, type InlineValue } from './breakpoints';
import { findOccurrences, PIN_COLORS } from './history';

/** Values longer than this are cut off at the end of the line (the debug view shows all of it). */
const MAX_VALUE = 48;

function shortValue(value: string): string {
  const flat = value.replace(/\s+/g, ' ');
  return flat.length > MAX_VALUE ? `${flat.slice(0, MAX_VALUE - 1)}…` : flat;
}

class ValuesWidget extends WidgetType {
  constructor(readonly values: InlineValue[]) {
    super();
  }

  eq(other: ValuesWidget) {
    return JSON.stringify(other.values) === JSON.stringify(this.values);
  }

  toDOM() {
    const box = document.createElement('span');
    box.className = 'cm-debug-values';
    box.setAttribute('aria-hidden', 'true');
    for (const v of this.values) {
      const chip = document.createElement('span');
      chip.className = `cm-debug-value pin-c${v.color}${v.changed ? ' changed' : ''}`;
      chip.title = `${v.expression} = ${v.value}${v.changed ? ' (nettopp endret)' : ''}`;
      const name = document.createElement('span');
      name.className = 'cm-debug-value-name';
      name.textContent = v.expression;
      chip.append(name, ` = ${shortValue(v.value ?? '')}`);
      box.append(chip);
    }
    return box;
  }
}

const marks = Array.from({ length: PIN_COLORS + 1 }, (_, c) => Decoration.mark({ class: `cm-debug-ref pin-c${c}` }));

/** Text that isn't code: strings and comments (but code inside f-strings and template strings is). */
function inStringOrComment(tree: Tree, pos: number): boolean {
  for (let node: SyntaxNode | null = tree.resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === 'FormatReplacement' || node.name === 'Interpolation') return false;
    if (/String|Comment/.test(node.name)) return true;
  }
  return false;
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const exec = state.field(executionField, false);
  if (!exec?.pins?.length || exec.line > state.doc.lines) return Decoration.none;
  const ranges: Range<Decoration>[] = [];
  const colors = new Map(exec.pins.map((p) => [p.expression, p.color]));
  const tree = syntaxTree(state);
  for (const { from, to } of view.visibleRanges) {
    for (const o of findOccurrences(state.sliceDoc(from, to), [...colors.keys()])) {
      if (inStringOrComment(tree, from + o.from)) continue;
      ranges.push(marks[colors.get(o.name) ?? 0].range(from + o.from, from + o.to));
    }
  }
  const values = exec.pins.filter((p) => p.value !== undefined);
  if (values.length) {
    ranges.push(Decoration.widget({ widget: new ValuesWidget(values), side: 1 }).range(state.doc.line(exec.line).to));
  }
  return Decoration.set(ranges, true);
}

/** The highlighted variables' values and places in the code (for debuggable code files). */
export const inlineValues = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      const exec = update.state.field(executionField, false);
      if (
        update.docChanged ||
        update.viewportChanged ||
        exec !== update.startState.field(executionField, false) ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
