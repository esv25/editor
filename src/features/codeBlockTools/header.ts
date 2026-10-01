/**
 * Header on a fenced code block's opening line: name, language menu and a
 * Run button. It replaces the raw ```lang title="…" text unless the cursor
 * is on that line itself, so selecting or typing in the code never makes
 * the block change shape. The name is edited in its own input field.
 */
import { RangeSet, type Range } from '@codemirror/state';
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
import { parseFence, rewriteFence } from '../util/fence';
import { languageChoices, normalizeLang } from './runners';
import { runnability } from './run';

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
      const input = document.createElement('input');
      input.className = 'cm-codeblock-title-input';
      input.value = this.title ?? '';
      input.placeholder = 'Navn, f.eks. beregning.py';
      let done = false;
      const finish = (save: boolean) => {
        if (done) return;
        done = true;
        if (save) updateFence(view, lineFrom(), { title: input.value });
        input.replaceWith(title);
        view.focus();
      };
      input.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') {
          ev.preventDefault();
          finish(true);
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          finish(false);
        }
      });
      input.addEventListener('blur', () => finish(true));
      title.replaceWith(input);
      input.focus();
      input.select();
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

/** Lines the cursor/selection ends are on (only those show raw fence text). */
function cursorLines(view: EditorView): Set<number> {
  const lines = new Set<number>();
  if (!view.hasFocus) return lines;
  for (const r of view.state.selection.ranges) {
    lines.add(view.state.doc.lineAt(r.head).number);
    lines.add(view.state.doc.lineAt(r.anchor).number);
  }
  return lines;
}

function build(view: EditorView, hideMarkup: boolean, actions: HeaderActions): DecorationSet {
  const { state } = view;
  const { doc } = state;
  const onLine = cursorLines(view);
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
        // Show the raw fence while the cursor is on it, so it can be edited as text.
        if (!info || !hideMarkup || onLine.has(open.number)) return false;
        const indent = open.text.length - open.text.trimStart().length;
        const widget = new HeaderWidget(info.lang, info.title, actions);
        decos.push(Decoration.replace({ widget }).range(open.from + indent, open.to));
        return false;
      },
    });
  }
  return RangeSet.of(decos, true);
}

export function headerPlugin(hideMarkup: boolean, actions: HeaderActions) {
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
