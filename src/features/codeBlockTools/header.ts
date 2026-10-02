/**
 * Header on a fenced code block's opening line: name, language menu and a
 * Run button. It always replaces the raw ```lang title="…" text, and the
 * closing ``` is hidden, so the block never changes shape. The name is
 * edited in its own input field, the language in the menu.
 */
import { EditorSelection, EditorState, RangeSet, type Line, type Range } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { describeCommand } from '../../commands/registry';
import { editInPlace } from '../util/editInPlace';
import { isClosingFence, parseFence, rewriteFence } from '../util/fence';
import { languageChoices, normalizeLang } from './runners';
import { runnability } from './run';

const hiddenCloseLine = Decoration.line({ class: 'cm-codeblock-close-hidden' });

export interface HeaderActions {
  run(view: EditorView, pos: number): void;
}

/** Change the language and/or title on the fence line starting at `lineFrom`. */
export function updateFence(view: EditorView, lineFrom: number, change: { lang?: string; title?: string }): void {
  const line = view.state.doc.lineAt(lineFrom);
  const text = rewriteFence(line.text, change);
  if (text === null || text === line.text) return;
  view.dispatch({ changes: { from: line.from, to: line.to, insert: text }, userEvent: 'input.codeblock' });
}

class HeaderWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly title: string | null,
    readonly actions: HeaderActions,
  ) {
    super();
  }

  eq(other: HeaderWidget) {
    return other.lang === this.lang && other.title === this.title;
  }

  toDOM(view: EditorView) {
    const root = document.createElement('span');
    root.className = 'cm-codeblock-header';
    const lineFrom = () => view.state.doc.lineAt(view.posAtDOM(root)).from;

    // Name: shown as text, edited in an input (Enter saves, Esc cancels).
    const title = document.createElement('span');
    title.className = `cm-codeblock-title${this.title ? '' : ' placeholder'}`;
    title.textContent = this.title || 'Gi navn …';
    title.title = 'Klikk for å gi blokken et navn';
    title.addEventListener('mousedown', (e) => {
      e.preventDefault();
      editInPlace(title, {
        value: this.title ?? '',
        placeholder: 'Navn, f.eks. beregning.py',
        className: 'cm-codeblock-title-input',
        onSave: (value) => updateFence(view, lineFrom(), { title: value }),
        onDone: () => view.focus(),
      });
    });
    root.append(title);

    const select = document.createElement('select');
    select.className = 'cm-codeblock-lang';
    select.title = 'Kodespråk';
    const current = normalizeLang(this.lang);
    const choices = [...languageChoices];
    if (!choices.some((c) => c.id === current)) choices.push({ id: this.lang, label: this.lang });
    for (const choice of choices) {
      const option = document.createElement('option');
      option.value = choice.id;
      option.textContent = choice.label;
      option.selected = choice.id === current || choice.id === this.lang;
      select.append(option);
    }
    select.addEventListener('change', () => {
      updateFence(view, lineFrom(), { lang: select.value });
      view.focus();
    });
    root.append(select);

    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'cm-codeblock-run';
    run.textContent = '▶ Kjør';
    const can = runnability(this.lang);
    run.disabled = !can.ok;
    run.title = can.ok ? describeCommand('codeblock.run') : can.reason;
    run.addEventListener('mousedown', (e) => e.preventDefault());
    run.addEventListener('click', () => this.actions.run(view, lineFrom()));
    root.append(run);
    return root;
  }

  ignoreEvent() {
    return true;
  }
}

function build(view: EditorView, hideMarkup: boolean, actions: HeaderActions): DecorationSet {
  const { state } = view;
  const { doc } = state;
  const decos: Range<Decoration>[] = [];
  const seen = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'FencedCode') return;
        const open = doc.lineAt(node.from);
        if (seen.has(open.from)) return false;
        seen.add(open.from);
        const info = parseFence(open.text);
        if (!info || !hideMarkup) return false;
        // The fence lines are never shown as text: name and language are edited in
        // the header, so the block keeps its shape wherever the cursor is.
        const indent = open.text.length - open.text.trimStart().length;
        const widget = new HeaderWidget(info.lang, info.title, actions);
        decos.push(Decoration.replace({ widget }).range(open.from + indent, open.to));
        // The closing ``` line shrinks to the block's bottom edge.
        const close = doc.lineAt(node.to);
        if (close.number > open.number && isClosingFence(close.text, info.fence)) {
          decos.push(hiddenCloseLine.range(close.from));
          if (close.length > 0) decos.push(Decoration.replace({}).range(close.from, close.to));
        }
        return false;
      },
    });
  }
  return RangeSet.of(decos, true);
}

/** Whether `line` is the opening or closing fence of a code block. */
function isFenceLine(state: EditorState, line: Line): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(line.from, 1); node; node = node.parent) {
    if (node.name !== 'FencedCode') continue;
    const open = state.doc.lineAt(node.from);
    if (open.number === line.number) return true;
    const info = parseFence(open.text);
    return !!info && state.doc.lineAt(node.to).number === line.number && isClosingFence(line.text, info.fence);
  }
  return false;
}

/**
 * The fence lines are hidden, so the cursor must never rest on them (typing
 * there would edit invisible text). Moving onto one continues to the next line
 * in the direction of travel. Edits are left alone, so typing ``` still works.
 */
const skipHiddenFences = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.docChanged || tr.selection.ranges.length > 1) return tr;
  const range = tr.selection.main;
  if (!range.empty) return tr;
  const state = tr.startState;
  const { doc } = state;
  const forward = range.head >= state.selection.main.head;
  let line = doc.lineAt(range.head);
  for (let i = 0; i < 3 && isFenceLine(state, line); i++) {
    const next = forward ? line.number + 1 : line.number - 1;
    if (next < 1 || next > doc.lines) break;
    line = doc.line(next);
  }
  if (line.number === doc.lineAt(range.head).number) return tr;
  const head = forward ? line.from : line.to;
  return [tr, { selection: EditorSelection.cursor(head), sequential: true }];
});

export function headerPlugin(hideMarkup: boolean, actions: HeaderActions) {
  if (!hideMarkup) return [];
  return [skipHiddenFences, headerViewPlugin(hideMarkup, actions)];
}

function headerViewPlugin(hideMarkup: boolean, actions: HeaderActions) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, hideMarkup, actions);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
          this.decorations = build(u.view, hideMarkup, actions);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      // The header replaces the fence text; let the cursor skip over it as a unit.
      provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
    },
  );
}
