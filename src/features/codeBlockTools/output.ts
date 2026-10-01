/**
 * Run output shown below a code block. Lives in editor state (not in the
 * document text), follows the block as the text changes, and disappears
 * when the block is removed.
 */
import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { blockAt } from '../util/fence';
import type { RunOutcome } from './run';

export interface OutputEntry {
  id: number;
  /** Start of the block's opening fence line. */
  pos: number;
  running: boolean;
  outcome?: RunOutcome;
}

export const startRun = StateEffect.define<{ id: number; pos: number }>({
  map: (value, changes) => ({ ...value, pos: changes.mapPos(value.pos, -1) }),
});
export const finishRun = StateEffect.define<{ id: number; outcome: RunOutcome }>();
export const clearOutput = StateEffect.define<number>(); // entry id

/** Hooks the widget needs, supplied by the feature (avoids import cycles). */
export interface OutputActions {
  rerun(view: EditorView, pos: number): void;
}

let actions: OutputActions = { rerun: () => {} };
export function setOutputActions(a: OutputActions): void {
  actions = a;
}

export const outputField = StateField.define<OutputEntry[]>({
  create: () => [],
  update(entries, tr) {
    let next = entries;
    if (tr.docChanged) {
      next = next
        .map((e) => ({ ...e, pos: tr.changes.mapPos(e.pos, -1) }))
        // Drop output whose block is gone.
        .filter((e) => {
          const line = tr.state.doc.lineAt(e.pos);
          return line.from === e.pos && blockAt(tr.state.doc, e.pos) !== null;
        });
    }
    for (const effect of tr.effects) {
      if (effect.is(startRun)) {
        next = [...next.filter((e) => e.pos !== effect.value.pos), { ...effect.value, running: true }];
      } else if (effect.is(finishRun)) {
        next = next.map((e) => (e.id === effect.value.id ? { ...e, running: false, outcome: effect.value.outcome } : e));
      } else if (effect.is(clearOutput)) {
        next = next.filter((e) => e.id !== effect.value);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.compute(['doc', field], (state) => buildDecorations(state, state.field(field))),
});

function buildDecorations(state: EditorState, entries: OutputEntry[]) {
  const decos: Range<Decoration>[] = [];
  for (const entry of entries) {
    const block = blockAt(state.doc, entry.pos);
    if (!block) continue;
    const at = (block.close ?? state.doc.line(state.doc.lines)).to;
    decos.push(Decoration.widget({ widget: new OutputWidget(entry), block: true, side: 1 }).range(at));
  }
  return Decoration.set(decos, true);
}

function statusText(running: boolean, o: RunOutcome | undefined): { text: string; cls: string } {
  if (running || !o) return { text: 'Kjører …', cls: 'running' };
  if (o.kind === 'html') return { text: 'Forhåndsvisning', cls: 'ok' };
  if (o.kind === 'error') return { text: 'Kunne ikke kjøre', cls: 'error' };
  const r = o.result;
  const time = r.durationMs < 1000 ? `${r.durationMs} ms` : `${(r.durationMs / 1000).toFixed(1)} s`;
  if (r.timedOut) return { text: `Stoppet etter ${time} (tidsgrense)`, cls: 'error' };
  if (r.exitCode === 0) return { text: `Ferdig · ${time}`, cls: 'ok' };
  return { text: `Avsluttet med kode ${r.exitCode ?? '?'} · ${time}`, cls: 'error' };
}

/**
 * The output box (status line, rerun/close buttons, output text or HTML
 * preview). Shared by code blocks and the run panel for code files.
 */
export function renderOutput(opts: {
  running: boolean;
  outcome?: RunOutcome;
  onRerun?: () => void;
  onClose: () => void;
}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'cm-code-output';

  const head = document.createElement('div');
  head.className = 'cm-code-output-head';
  const status = statusText(opts.running, opts.outcome);
  const label = document.createElement('span');
  label.className = `cm-code-output-status ${status.cls}`;
  label.textContent = status.text;
  head.append(label);

  const button = (text: string, title: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.title = title;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', onClick);
    head.append(b);
  };
  if (!opts.running && opts.onRerun) button('⟳', 'Kjør igjen', opts.onRerun);
  button('✕', 'Skjul utdata', opts.onClose);
  root.append(head);

  const o = opts.outcome;
  if (o?.kind === 'html') {
    const frame = document.createElement('iframe');
    frame.className = 'cm-code-output-frame';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.srcdoc = o.html;
    root.append(frame);
  } else if (o) {
    const pre = document.createElement('pre');
    if (o.kind === 'error') {
      pre.append(errorSpan(o.message));
    } else {
      if (o.result.stdout) pre.append(o.result.stdout);
      if (o.result.stderr) pre.append(errorSpan(o.result.stderr));
      if (!o.result.stdout && !o.result.stderr) {
        const empty = document.createElement('span');
        empty.className = 'empty';
        empty.textContent = '(ingen utdata)';
        pre.append(empty);
      }
    }
    root.append(pre);
  }
  return root;
}

class OutputWidget extends WidgetType {
  constructor(readonly entry: OutputEntry) {
    super();
  }

  eq(other: OutputWidget) {
    // Position changes alone shouldn't re-render (would reload HTML previews).
    return other.entry.id === this.entry.id && other.entry.running === this.entry.running && other.entry.outcome === this.entry.outcome;
  }

  toDOM(view: EditorView) {
    const { entry } = this;
    const currentPos = () => view.state.field(outputField).find((e) => e.id === entry.id)?.pos;
    return renderOutput({
      running: entry.running,
      outcome: entry.outcome,
      onRerun: () => {
        const pos = currentPos();
        if (pos !== undefined) actions.rerun(view, pos);
      },
      onClose: () => view.dispatch({ effects: clearOutput.of(entry.id) }),
    });
  }

  ignoreEvent() {
    return true;
  }
}

function errorSpan(text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'stderr';
  span.textContent = text;
  return span;
}
