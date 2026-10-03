/**
 * «Kodehjelp» in the editor: problems as squiggles (via @codemirror/lint),
 * the message at the end of the line, the same variable highlighted
 * everywhere, coloured bracket pairs, indent guides and completion – each
 * switched on by the settings (see levels.ts). Also F2 (rename everywhere),
 * F12 (go to definition) and the problems list.
 */
import { EditorSelection, EditorState, RangeSetBuilder, type Extension, type Text } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  highlightTrailingWhitespace,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { ensureSyntaxTree, getIndentUnit, syntaxTree } from '@codemirror/language';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { highlightSelectionMatches } from '@codemirror/search';
import {
  closeLintPanel,
  forEachDiagnostic,
  lintGutter,
  linter,
  nextDiagnostic,
  openLintPanel,
  previousDiagnostic,
  setDiagnosticsEffect,
  type Diagnostic,
} from '@codemirror/lint';
import type { SyntaxNode, Tree } from '@lezer/common';
import type { EditorCommand } from '../../commands/registry';
import { analyze, assistLang, diagnose, type AnyAnalysis } from './diagnose';
import { pythonModules } from './globals';
import { activeFeatures, type CodeHelpFeature, type CodeHelpSettings } from './levels';
import type { Issue, Ref } from './types';

export { activeFeatures } from './levels';

// ---- Analysis, shared by the problems, highlighting and F2/F12 ----

const cache = new WeakMap<Tree, AnyAnalysis>();

/** The analysis of a state's current syntax tree (cached per tree), or null for other languages. */
export function analysisOf(state: EditorState, lang: string, tree: Tree = syntaxTree(state)): AnyAnalysis | null {
  const kind = assistLang(lang);
  if (!kind) return null;
  let a = cache.get(tree);
  if (!a) {
    a = analyze(kind, tree, state.doc.toString());
    cache.set(tree, a);
  }
  return a;
}

/** The name reference at a position. */
function refAt(a: AnyAnalysis, pos: number): Ref | null {
  let lo = 0;
  let hi = a.refs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = a.refs[mid];
    if (r.to < pos) lo = mid + 1;
    else if (r.from > pos) hi = mid - 1;
    else return r;
  }
  return null;
}

/** Every place the name at `pos` (the same variable, not just the same text) occurs. */
export function occurrencesAt(state: EditorState, lang: string, pos: number): { refs: Ref[]; at: Ref } | null {
  const a = analysisOf(state, lang);
  const at = a && refAt(a, pos);
  if (!a || !at?.binding) return null;
  return { refs: a.refs.filter((r) => r.binding === at.binding), at };
}

// ---- Problems ----

const PROBLEM_FEATURES: CodeHelpFeature[] = ['syntaxErrors', 'names', 'unused', 'unusedParams', 'unreachable', 'tips'];

function toDiagnostic(issue: Issue, doc: Text, explain: boolean): Diagnostic {
  return {
    from: issue.from,
    to: Math.min(issue.to, doc.length),
    severity: issue.severity,
    message: issue.message,
    markClass: issue.markClass,
    renderMessage:
      explain && issue.explanation
        ? () => {
            const box = document.createElement('span');
            const head = document.createElement('strong');
            head.textContent = issue.message;
            const more = document.createElement('span');
            more.className = 'cm-diagnostic-explain';
            more.textContent = issue.explanation!;
            box.append(head, more);
            return box;
          }
        : undefined,
    actions: issue.fixes?.map((fix) => ({
      name: fix.label,
      apply: (view: EditorView, from: number) => {
        let changes = fix.changes;
        if (view.state.doc !== doc) {
          // Edited since: only fixes inside the marked text can follow it.
          if (!changes.every((c) => c.from >= issue.from && c.to <= issue.to)) return;
          const shift = from - issue.from;
          changes = changes.map((c) => ({ from: c.from + shift, to: c.to + shift, insert: c.insert }));
        }
        view.dispatch({ changes, userEvent: 'input.fix' });
      },
    })),
  };
}

function problems(lang: string, features: Set<CodeHelpFeature>): Extension {
  return linter(
    (view) => {
      const { state } = view;
      const tree = ensureSyntaxTree(state, state.doc.length, 500);
      if (!tree) return [];
      const issues = diagnose(tree, state.doc.toString(), lang, features, analysisOf(state, lang, tree));
      const explain = features.has('explanations');
      return issues.map((i) => toDiagnostic(i, state.doc, explain));
    },
    { delay: 400 },
  );
}

/** Errors, warnings and notes in a state (for the status bar). */
export function problemCounts(state: EditorState): { errors: number; warnings: number; infos: number } {
  const counts = { errors: 0, warnings: 0, infos: 0 };
  forEachDiagnostic(state, (d) => {
    if (d.severity === 'error') counts.errors++;
    else if (d.severity === 'warning') counts.warnings++;
    else if (d.severity === 'info') counts.infos++;
  });
  return counts;
}

export function diagnosticsChanged(u: ViewUpdate): boolean {
  return u.transactions.some((tr) => tr.effects.some((e) => e.is(setDiagnosticsEffect)));
}

// ---- The message at the end of the line ----

class LineMessage extends WidgetType {
  constructor(
    readonly severity: string,
    readonly text: string,
  ) {
    super();
  }
  eq(other: LineMessage): boolean {
    return other.severity === this.severity && other.text === this.text;
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = `cm-line-message cm-line-message-${this.severity}`;
    el.textContent = this.text;
    return el;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

const WEIGHT: Record<string, number> = { error: 3, warning: 2, info: 1 };

const lineMessages = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || diagnosticsChanged(u)) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const { doc } = view.state;
      const visible = view.visibleRanges;
      const best = new Map<number, { severity: string; message: string; count: number }>();
      forEachDiagnostic(view.state, (d, from) => {
        if (!WEIGHT[d.severity] || !visible.some((r) => from >= r.from && from <= r.to)) return;
        const line = doc.lineAt(from).number;
        const old = best.get(line);
        if (!old) best.set(line, { severity: d.severity, message: d.message, count: 1 });
        else {
          old.count++;
          if (WEIGHT[d.severity] > WEIGHT[old.severity]) Object.assign(old, { severity: d.severity, message: d.message });
        }
      });
      const builder = new RangeSetBuilder<Decoration>();
      for (const [n, m] of [...best].sort((a, b) => a[0] - b[0])) {
        const line = doc.line(n);
        const text = m.count > 1 ? `${m.message}  (+${m.count - 1})` : m.message;
        builder.add(line.from, line.from, Decoration.line({ class: `cm-line-problem-${m.severity}` }));
        builder.add(line.to, line.to, Decoration.widget({ widget: new LineMessage(m.severity, text), side: 1 }));
      }
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

// ---- The same variable everywhere ----

const occurrenceMark = Decoration.mark({ class: 'cm-occurrence' });
const occurrenceWriteMark = Decoration.mark({ class: 'cm-occurrence cm-occurrence-write' });

function occurrences(lang: string): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      private timer: ReturnType<typeof setTimeout> | undefined;
      constructor(view: EditorView) {
        this.decorations = this.build(view.state);
      }
      update(u: ViewUpdate) {
        if (u.docChanged) {
          // Analysing on every key press is wasted work: wait until typing pauses.
          this.decorations = this.decorations.map(u.changes);
          clearTimeout(this.timer);
          this.timer = setTimeout(() => {
            this.decorations = this.build(u.view.state);
            u.view.dispatch({});
          }, 250);
        } else if (u.selectionSet) this.decorations = this.build(u.state);
      }
      destroy() {
        clearTimeout(this.timer);
      }
      build(state: EditorState): DecorationSet {
        const sel = state.selection.main;
        if (!sel.empty || state.selection.ranges.length > 1) return Decoration.none;
        const found = occurrencesAt(state, lang, sel.head);
        if (!found || found.refs.length < 2) return Decoration.none;
        return Decoration.set(
          found.refs.map((r) => (r.role === 'read' ? occurrenceMark : occurrenceWriteMark).range(r.from, r.to)),
          true,
        );
      }
    },
    { decorations: (v) => v.decorations },
  );
}

// ---- Coloured bracket pairs ----

const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);
const bracketMarks = [1, 2, 3].map((n) => Decoration.mark({ class: `cm-bracket-${n}` }));

/** How many brackets are open at `pos`. */
function depthAt(tree: Tree, pos: number): number {
  let depth = 0;
  for (let n: SyntaxNode | null = tree.resolveInner(pos, 1); n; n = n.parent) {
    for (let c = n.firstChild; c && c.to <= pos; c = c.nextSibling) {
      if (c.to - c.from !== 1) continue;
      if (OPEN.has(c.name)) depth++;
      else if (CLOSE.has(c.name)) depth--;
    }
  }
  return Math.max(0, depth);
}

const bracketColors = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState)) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const tree = syntaxTree(view.state);
      const { doc } = view.state;
      const builder = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        let depth = depthAt(tree, from);
        tree.iterate({
          from,
          to,
          enter: (node) => {
            if (node.to - node.from !== 1) return;
            const ch = node.name;
            if (doc.sliceString(node.from, node.to) !== ch) return;
            if (OPEN.has(ch)) builder.add(node.from, node.to, bracketMarks[depth++ % 3]);
            else if (CLOSE.has(ch)) {
              depth = Math.max(0, depth - 1);
              builder.add(node.from, node.to, bracketMarks[depth % 3]);
            }
          },
        });
      }
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

// ---- Indent guides ----

function indentColumns(text: string, tabSize: number): number | null {
  let col = 0;
  for (const ch of text) {
    if (ch === ' ') col++;
    else if (ch === '\t') col += tabSize - (col % tabSize);
    else return col;
  }
  return null; // blank
}

const indentGuides = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const { state } = view;
      const { doc, tabSize } = state;
      const unit = getIndentUnit(state) || 4;
      const builder = new RangeSetBuilder<Decoration>();
      // A blank line continues the guides of the lines around it.
      const nearest = (from: number, step: 1 | -1): number => {
        for (let n = from, i = 0; n >= 1 && n <= doc.lines && i < 200; n += step, i++) {
          const cols = indentColumns(doc.line(n).text, tabSize);
          if (cols !== null) return cols;
        }
        return 0;
      };
      let lastLine = 0;
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = doc.lineAt(pos);
          if (line.number > lastLine) {
            lastLine = line.number;
            let cols = indentColumns(line.text, tabSize);
            if (cols === null) cols = Math.min(nearest(line.number - 1, -1), nearest(line.number + 1, 1));
            const levels = Math.ceil(cols / unit);
            if (levels > 0) {
              builder.add(
                line.from,
                line.from,
                Decoration.line({ attributes: { class: 'cm-indent-guides', style: `--indent-levels: ${levels}; --indent-unit: ${unit}` } }),
              );
            }
          }
          pos = line.to + 1;
        }
      }
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

// ---- Completion: what's in Python modules (`math.` → sqrt, pi …) ----

const CONSTANTS = new Set(['pi', 'e', 'tau', 'inf', 'nan', 'altzone', 'daylight', 'timezone', 'tzname']);

function moduleMembers(lang: string) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const word = ctx.matchBefore(/[A-Za-z_]\w*\.\w*$/);
    if (!word) return null;
    const dot = word.text.indexOf('.');
    const a = analysisOf(ctx.state, lang);
    const ref = a && refAt(a, word.from + 1);
    const module = ref?.binding?.kind === 'import' ? ref.binding.module : undefined;
    const names = module ? pythonModules[module] : undefined;
    if (!names) return null;
    return {
      from: word.from + dot + 1,
      options: [...names].map((label) => ({ label, type: /^[A-Z]/.test(label) ? 'class' : CONSTANTS.has(label) ? 'constant' : 'function' })),
      validFor: /^\w*$/,
    };
  };
}

// ---- All together ----

export function codeAssistExtensions(lang: string, settings: CodeHelpSettings): Extension {
  const features = activeFeatures(settings);
  const supported = assistLang(lang) !== null;
  const out: Extension[] = [
    // Ctrl+Space always shows suggestions; «Forslag mens du skriver» opens them by itself.
    autocompletion({ activateOnTyping: features.has('autocomplete') }),
  ];
  if (lang === 'python') out.push(EditorState.languageData.of(() => [{ autocomplete: moduleMembers(lang) }]));
  if (PROBLEM_FEATURES.some((f) => features.has(f))) {
    out.push(problems(lang, features));
    if (features.has('gutterMarkers')) out.push(lintGutter({ markerFilter: (ds) => ds.filter((d) => d.severity !== 'hint') }));
    if (features.has('inlineMessages')) out.push(lineMessages);
  }
  if (features.has('occurrences')) {
    // Selected text is highlighted everywhere; without a selection, the variable under the cursor
    // (or, where the language isn't analysed, the word).
    out.push(highlightSelectionMatches({ highlightWordAroundCursor: !supported, minSelectionLength: 2 }));
    if (supported) out.push(occurrences(lang));
  }
  if (features.has('bracketColors')) out.push(bracketColors);
  if (features.has('indentGuides')) out.push(indentGuides);
  if (features.has('trailingSpace')) out.push(highlightTrailingWhitespace());
  return out;
}

// ---- Commands ----

function rename(view: EditorView, lang: string): boolean {
  const found = occurrencesAt(view.state, lang, view.state.selection.main.head);
  if (!found) return false;
  const ranges = found.refs.map((r) => EditorSelection.range(r.from, r.to));
  view.dispatch({
    selection: EditorSelection.create(ranges, found.refs.indexOf(found.at)),
    scrollIntoView: true,
    userEvent: 'select',
  });
  return true;
}

function goToDefinition(view: EditorView, lang: string): boolean {
  const found = occurrencesAt(view.state, lang, view.state.selection.main.head);
  const def = found?.at.binding?.defs[0];
  if (!def) return false;
  view.dispatch({ selection: EditorSelection.range(def.from, def.to), scrollIntoView: true, userEvent: 'select' });
  return true;
}

/** The language of the state (set by code mode), passed in to avoid an import cycle. */
export function assistCommands(langOf: (state: EditorState) => string): EditorCommand[] {
  return [
    {
      id: 'code.problems',
      name: 'Vis/skjul problemer (liste over feil)',
      key: 'Mod-Shift-m',
      scope: 'code',
      run: (view) => closeLintPanel(view) || openLintPanel(view),
    },
    { id: 'code.nextProblem', name: 'Gå til neste problem', key: 'F8', scope: 'code', run: nextDiagnostic },
    { id: 'code.prevProblem', name: 'Gå til forrige problem', key: 'Shift-F8', scope: 'code', run: previousDiagnostic },
    {
      id: 'code.rename',
      name: 'Gi nytt navn overalt (markerer alle stedene variabelen brukes)',
      key: 'F2',
      scope: 'code',
      run: (view) => rename(view, langOf(view.state)),
    },
    {
      id: 'code.goToDefinition',
      name: 'Gå til der navnet er definert',
      key: 'F12',
      scope: 'code',
      run: (view) => goToDefinition(view, langOf(view.state)),
    },
  ];
}

/** Norwegian texts for the problems list. */
export const assistPhrases = EditorState.phrases.of({
  Diagnostics: 'Problemer',
  'No diagnostics': 'Ingen problemer',
  close: 'Lukk',
});
