/**
 * Header on a fenced code block's opening line: name, language menu and a
 * Run button. When the cursor is outside the block, the raw
 * ```lang title="…" text is replaced by the header; inside, the raw text is
 * shown for editing and the controls float to the right.
 */
import { EditorSelection, RangeSet, type Range } from '@codemirror/state';
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
import { activeLines } from '../livePreview';
import { parseFence } from '../util/fence';
import { languageChoices, normalizeLang } from './runners';
import { runnability } from './run';

export interface HeaderActions {
  run(view: EditorView, pos: number): void;
}

/** Change the language on the fence line starting at `lineFrom`. */
export function setFenceLanguage(view: EditorView, lineFrom: number, lang: string): void {
  const line = view.state.doc.lineAt(lineFrom);
  const info = parseFence(line.text);
  if (!info) return;
  const from = line.from + info.langFrom;
  const to = line.from + info.langTo;
  // Keep a space between a new language and a following title.
  const needsSpace = info.lang === '' && lang !== '' && info.langTo < line.text.length && line.text[info.langTo] !== ' ';
  view.dispatch({ changes: { from, to, insert: lang + (needsSpace ? ' ' : '') }, userEvent: 'input.codeblock' });
}

/** Put the cursor in the block's title (adding title="" if there is none). */
export function editFenceTitle(view: EditorView, lineFrom: number): void {
  const line = view.state.doc.lineAt(lineFrom);
  const info = parseFence(line.text);
  if (!info) return;
  if (info.title !== null) {
    view.dispatch({ selection: EditorSelection.range(line.from + info.titleFrom, line.from + info.titleTo) });
  } else {
    const at = line.from + info.langTo;
    const insert = ' title=""';
    view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length - 1 }, userEvent: 'input.codeblock' });
  }
  view.focus();
}

class HeaderWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly title: string | null,
    /** Replaces the raw fence text (cursor outside the block). */
    readonly full: boolean,
    readonly actions: HeaderActions,
  ) {
    super();
  }

  eq(other: HeaderWidget) {
    return other.lang === this.lang && other.title === this.title && other.full === this.full;
  }

  toDOM(view: EditorView) {
    const root = document.createElement('span');
    root.className = `cm-codeblock-header${this.full ? ' full' : ''}`;
    const lineFrom = () => view.state.doc.lineAt(view.posAtDOM(root)).from;

    if (this.full) {
      const title = document.createElement('span');
      title.className = `cm-codeblock-title${this.title ? '' : ' placeholder'}`;
      title.textContent = this.title || 'Gi navn …';
      title.title = 'Klikk for å endre navn';
      title.addEventListener('mousedown', (e) => {
        e.preventDefault();
        editFenceTitle(view, lineFrom());
      });
      root.append(title);
    }

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
    select.addEventListener('change', () => setFenceLanguage(view, lineFrom(), select.value));
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
  const active = activeLines(view);
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
        if (!info) return false;
        const last = doc.lineAt(node.to).number;
        let cursorInside = false;
        for (let n = open.number; n <= last && !cursorInside; n++) cursorInside = active.has(n);

        const indent = open.text.length - open.text.trimStart().length;
        if (hideMarkup && !cursorInside) {
          const widget = new HeaderWidget(info.lang, info.title, true, actions);
          decos.push(Decoration.replace({ widget }).range(open.from + indent, open.to));
        } else {
          const widget = new HeaderWidget(info.lang, info.title, false, actions);
          decos.push(Decoration.widget({ widget, side: 1 }).range(open.to));
        }
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
    { decorations: (v) => v.decorations },
  );
}
