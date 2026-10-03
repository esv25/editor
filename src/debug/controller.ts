/**
 * Debug sessions: starts a debugger for a code file (the program itself runs
 * in the terminal, so it can read input), follows where it stops – opens the
 * file and marks the line – and holds what the debug view shows.
 */
import { EditorView } from '@codemirror/view';
import type { EditorDocument } from '../app/document';
import { allowRunning } from '../app/trust';
import type { Workspace } from '../app/workspace';
import { platform, type Pty } from '../platform';
import type { TerminalPanel, TerminalTab } from '../terminal/terminalPanel';
import { breakpointLines, executionField, setExecutionLine } from './breakpoints';
import { DapBackend } from './dap';
import { debuggerFor, type DebuggerConfig } from './debuggers';
import { NodeBackend } from './node';
import {
  samePath,
  type DebugBackend,
  type DebugHost,
  type Scope,
  type StackFrame,
  type StopInfo,
  type Variable,
} from './types';

export type DebugStatus = 'starting' | 'running' | 'paused';

export interface ScopeState {
  scope: Scope;
  /** null until loaded (expensive scopes load when expanded). */
  variables: Variable[] | null;
}

export interface WatchResult {
  expression: string;
  value?: Variable;
  error?: string;
}

type Action = 'continue' | 'step' | 'pause';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class DebugController {
  /** null = no session. */
  status: DebugStatus | null = null;
  /** Name of the file being debugged. */
  name = '';
  stop: StopInfo | null = null;
  /** Counts stops; variable handles from an earlier stop are no longer valid. */
  stopId = 0;
  frames: StackFrame[] = [];
  frameIndex = 0;
  scopes: ScopeState[] = [];
  /** Expressions shown under "Uttrykk", evaluated at every stop. */
  watches: string[] = [];
  watchResults: WatchResult[] = [];
  /** What made the program stop besides a breakpoint ('step' or 'pause'). */
  lastAction: Action = 'continue';

  private backend: DebugBackend | null = null;
  private session = 0;
  private tab: TerminalTab | null = null;
  private lastDoc: EditorDocument | null = null;
  /** Asking to install (or installing) the debugger: F5 again shouldn't ask twice. */
  private installing = false;
  private listeners = new Set<() => void>();
  /** Breakpoint changes not yet sent to the debugger, by path. */
  private pendingSync = new Map<string, { timer: ReturnType<typeof setTimeout>; doc: EditorDocument }>();

  constructor(
    private ws: Workspace,
    private getView: () => EditorView,
    private terminal: TerminalPanel,
  ) {
    ws.onActiveChange(() => this.showExecutionLine(false));
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  get active(): boolean {
    return this.status !== null;
  }

  get frame(): StackFrame | undefined {
    return this.frames[this.frameIndex];
  }

  /** Why this document can't be debugged, or null if it can. */
  problem(doc: EditorDocument | null): string | null {
    if (!platform.processes) return 'Feilsøking finnes bare i skrivebordsappen';
    if (!doc || doc.kind !== 'code') return 'Åpne en kodefil for å feilsøke';
    if (!debuggerFor(doc.lang)) return `Feilsøking av ${doc.lang || 'denne filtypen'} støttes ikke ennå`;
    return null;
  }

  // ---------- Starting and ending ----------

  /** Start debugging a document (default: the active one). */
  start(doc = this.ws.activeDoc): boolean {
    if (this.active || !doc) return false;
    if (this.installing) return true;
    const problem = this.problem(doc);
    if (problem) {
      this.ws.showError(problem);
      return doc.kind === 'code';
    }
    void this.launch(doc, debuggerFor(doc.lang)!);
    return true;
  }

  private async launch(doc: EditorDocument, config: DebuggerConfig): Promise<void> {
    const session = ++this.session;
    this.lastDoc = doc;
    this.name = doc.name;
    this.tab = null;
    this.status = 'starting';
    this.clearStop();
    this.changed();

    if (!(await doc.ensureSaved()) || !doc.file?.path) {
      this.end(session);
      this.ws.showError('Filen må lagres før den kan feilsøkes');
      return;
    }
    this.name = doc.name;
    const program = doc.file.path;
    if (!(await allowRunning(program))) {
      this.end(session);
      return;
    }
    const backend = this.createBackend(config, session);
    this.backend = backend;
    try {
      await backend.start({
        program,
        cwd: program.replace(/[\\/][^\\/]*$/, ''),
        lang: doc.lang,
        breakpoints: this.allBreakpoints(),
      });
      if (session === this.session && this.status === 'starting') {
        this.status = 'running';
        this.changed();
      }
    } catch (err) {
      if (session !== this.session) return;
      const text = errorText(err);
      // Set by runInTerminal while starting (TypeScript can't see that across the await).
      const tab = this.tab as TerminalTab | null;
      const pty = tab?.pty;
      void backend.stop().finally(() => pty?.kill());
      this.end(session);
      if (config.missing && config.install && text.includes(config.missing)) {
        void this.offerInstall(config, doc);
      } else {
        this.ws.showError(`Kunne ikke starte feilsøkingen: ${text.split('\n').filter(Boolean).pop() ?? text}`);
        tab?.print(text, 'error');
      }
    }
  }

  private createBackend(config: DebuggerConfig, session: number): DebugBackend {
    const live = () => session === this.session && this.active;
    const host: DebugHost = {
      processes: platform.processes!,
      runInTerminal: async (request) => {
        const tab = await this.terminal.runProgram('debug', 'debug', { ...request, title: this.name });
        if (session === this.session) this.tab = tab;
        return { pid: tab.pty?.pid ?? null };
      },
    };
    const events = {
      stopped: (info: StopInfo) => {
        if (live()) void this.stopped(info);
      },
      continued: () => {
        if (live()) this.continued();
      },
      output: (text: string, category: string) => {
        if (live()) this.tab?.write(category === 'stderr' ? `\x1b[31m${text}\x1b[0m` : `\x1b[2m${text}\x1b[0m`);
      },
      terminated: () => this.end(session),
    };
    return config.type === 'node' ? new NodeBackend(host, events) : new DapBackend(config, host, events);
  }

  /** The debugger isn't installed: offer to install it, then start again. */
  private async offerInstall(config: DebuggerConfig, doc: EditorDocument): Promise<void> {
    const what = config.installName ?? 'feilsøkeren';
    this.installing = true;
    const yes = await platform.confirm(
      `For å feilsøke trengs tillegget «${what}», som ikke er installert ennå. Installere det nå? Det tar vanligvis under ett minutt.`,
    );
    if (!yes) {
      this.installing = false;
      return;
    }
    const [program, ...args] = config.install!;
    let tab: TerminalTab;
    try {
      tab = await this.terminal.runProgram('run', 'install', { title: `Installerer ${what}`, program, args });
    } catch {
      this.installing = false;
      return;
    }
    const off = tab.onExit((code) => {
      off();
      this.installing = false;
      if (code === 0) {
        tab.print(`${what} er installert. Starter feilsøkingen …`);
        this.start(doc);
      } else {
        this.ws.showError(`Klarte ikke å installere ${what} – se terminalen`);
      }
    });
  }

  /** The session is over (program ended, stopped, or failed). */
  private end(session: number): void {
    if (session !== this.session || !this.active) return;
    this.backend = null;
    this.status = null;
    this.clearStop();
    for (const { timer } of this.pendingSync.values()) clearTimeout(timer);
    this.pendingSync.clear();
    this.showExecutionLine(false);
    this.changed();
  }

  /** Shift+F5: end the session and the program. */
  stopSession(): boolean {
    if (!this.active) return false;
    const backend = this.backend;
    const pty: Pty | null | undefined = this.tab?.pty;
    // The program may outlive the debugger (Node keeps running when it disconnects).
    void (backend ? backend.stop() : Promise.resolve()).finally(() => pty?.kill());
    this.end(this.session);
    return true;
  }

  /** Ctrl+Shift+F5: start the same file again. */
  restart(): boolean {
    const doc = this.lastDoc;
    if (!this.active || !doc) return false;
    this.stopSession();
    setTimeout(() => this.start(doc), 300);
    return true;
  }

  // ---------- Running ----------

  private act(action: Action, run: (backend: DebugBackend, threadId: number) => Promise<void>): boolean {
    const backend = this.backend;
    if (!backend) return false;
    if (action === 'pause' ? this.status !== 'running' : this.status !== 'paused') return false;
    this.lastAction = action;
    const threadId = this.stop?.threadId ?? 1;
    if (action !== 'pause') {
      this.status = 'running';
      // Stepping usually stops again right away: keep showing where we were until then.
      if (action === 'continue') this.clearStop();
      this.showExecutionLine(false);
      this.changed();
    }
    // Breakpoints just changed must be in place before the program moves on.
    void this.flushBreakpoints()
      .then(() => run(backend, threadId))
      .catch((err) => this.ws.showError(errorText(err)));
    return true;
  }

  resume = () => this.act('continue', (b, t) => b.resume(t));
  stepOver = () => this.act('step', (b, t) => b.stepOver(t));
  stepInto = () => this.act('step', (b, t) => b.stepInto(t));
  stepOut = () => this.act('step', (b, t) => b.stepOut(t));
  pause = () => this.act('pause', (b, t) => b.pause(t));

  private continued(): void {
    if (this.status === 'running') return;
    this.status = 'running';
    this.clearStop();
    this.showExecutionLine(false);
    this.changed();
  }

  private clearStop(): void {
    this.stop = null;
    this.frames = [];
    this.frameIndex = 0;
    this.scopes = [];
    this.watchResults = [];
  }

  private async stopped(info: StopInfo): Promise<void> {
    const backend = this.backend!;
    const session = this.session;
    const stopId = ++this.stopId;
    let frames: StackFrame[] = [];
    try {
      frames = await backend.stackTrace(info.threadId);
    } catch {
      // Show the stop without a stack.
    }
    if (session !== this.session || stopId !== this.stopId) return;
    this.status = 'paused';
    this.stop = info;
    this.frames = frames;
    // The innermost frame in a file we can show (skips e.g. Node internals).
    this.frameIndex = Math.max(0, frames.findIndex((f) => f.path));
    this.scopes = [];
    this.changed();
    await this.reveal();
    await Promise.all([this.loadScopes(), this.evaluateWatches()]);
  }

  /** Pick a frame in the call stack: show its line and its variables. */
  selectFrame(index: number): void {
    if (this.status !== 'paused' || !this.frames[index] || index === this.frameIndex) return;
    this.frameIndex = index;
    this.scopes = [];
    this.changed();
    void this.reveal().then(() => Promise.all([this.loadScopes(), this.evaluateWatches()]));
  }

  /** Open the frame's file (if needed) and mark the line. */
  private async reveal(): Promise<void> {
    const path = this.frame?.path;
    if (!path) return;
    const open = this.ws.allDocs().find((d) => samePath(d.file?.path, path));
    if (open && open !== this.ws.activeDoc) this.ws.activate(open);
    else if (!open) await this.ws.openPath(path);
    this.showExecutionLine(true);
  }

  /** Mark the paused line in the active document (if it's the frame's file). */
  private showExecutionLine(scroll: boolean): void {
    const view = this.getView();
    const current = view.state.field(executionField, false);
    if (current === undefined) return; // Not a debuggable code file.
    const frame = this.frame;
    const line = frame && samePath(frame.path, this.ws.activeDoc?.file?.path) ? frame.line : null;
    const next = line && line <= view.state.doc.lines ? { line, top: this.frameIndex === 0 } : null;
    const effects = [];
    if (current?.line !== next?.line || current?.top !== next?.top) effects.push(setExecutionLine.of(next));
    if (scroll && next) {
      effects.push(EditorView.scrollIntoView(view.state.doc.line(next.line).from, { y: 'nearest', yMargin: 120 }));
    }
    if (effects.length) view.dispatch({ effects });
  }

  // ---------- Variables and expressions ----------

  private async loadScopes(): Promise<void> {
    const { backend, frame, stopId } = this;
    if (!backend || !frame) return;
    let scopes: Scope[] = [];
    try {
      scopes = await backend.scopes(frame.id);
    } catch {
      // No variables to show.
    }
    const states = await Promise.all(
      scopes.map(async (scope, i) => ({
        scope,
        variables: scope.expensive && i > 0 ? null : await backend.variables(scope.ref).catch(() => []),
      })),
    );
    if (stopId !== this.stopId || frame !== this.frame) return;
    this.scopes = states;
    this.changed();
  }

  /** Children of an expandable variable (handles are valid until the program moves on). */
  async children(ref: number): Promise<Variable[]> {
    if (!this.backend || this.status !== 'paused') return [];
    return this.backend.variables(ref).catch(() => []);
  }

  addWatch(expression: string): void {
    const expr = expression.trim();
    if (!expr || this.watches.includes(expr)) return;
    this.watches.push(expr);
    void this.evaluateWatches();
  }

  removeWatch(expression: string): void {
    this.watches = this.watches.filter((w) => w !== expression);
    this.watchResults = this.watchResults.filter((r) => r.expression !== expression);
    this.changed();
  }

  private async evaluateWatches(): Promise<void> {
    const { backend, stopId } = this;
    if (!backend || this.status !== 'paused') return;
    const frameId = this.frame?.id;
    const results = await Promise.all(
      this.watches.map(async (expression): Promise<WatchResult> => {
        try {
          return { expression, value: await backend.evaluate(expression, frameId) };
        } catch (err) {
          return { expression, error: errorText(err) };
        }
      }),
    );
    if (stopId !== this.stopId) return;
    this.watchResults = results;
    this.changed();
  }

  // ---------- Breakpoints ----------

  /** Breakpoints in all open files, by path. */
  private allBreakpoints(): Map<string, number[]> {
    const map = new Map<string, number[]>();
    for (const doc of this.ws.allDocs()) {
      const path = doc.file?.path;
      if (!path) continue;
      const lines = breakpointLines(doc === this.ws.activeDoc ? this.getView().state : doc.state);
      if (lines.length) map.set(path, lines);
    }
    return map;
  }

  /** The active document's breakpoints changed: tell a running session (debounced while typing). */
  breakpointsChanged(doc: EditorDocument): void {
    const path = doc.file?.path;
    if (!this.backend || !path) return;
    clearTimeout(this.pendingSync.get(path)?.timer);
    this.pendingSync.set(path, { doc, timer: setTimeout(() => void this.syncBreakpoints(path), 250) });
  }

  private async syncBreakpoints(path: string): Promise<void> {
    const pending = this.pendingSync.get(path);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingSync.delete(path);
    await this.backend?.setBreakpoints(path, breakpointLines(pending.doc.state)).catch(() => {});
  }

  private async flushBreakpoints(): Promise<void> {
    await Promise.all([...this.pendingSync.keys()].map((path) => this.syncBreakpoints(path)));
  }
}
