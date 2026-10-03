/**
 * Debug sessions: starts a debugger for a code file (the program itself runs
 * in the terminal, so it can read input), follows where it stops – opens the
 * file and marks the line – and holds what the debug view shows. Every stop is
 * kept, so the user can step back and see how things were (history.ts).
 */
import { EditorView } from '@codemirror/view';
import type { EditorDocument } from '../app/document';
import { allowRunning } from '../app/trust';
import type { Workspace } from '../app/workspace';
import { platform, type Pty } from '../platform';
import type { TerminalPanel, TerminalTab } from '../terminal/terminalPanel';
import { breakpointLines, executionField, setExecutionLine, type ExecutionLine } from './breakpoints';
import { DapBackend } from './dap';
import { debuggerFor, type DebuggerConfig } from './debuggers';
import {
  changedVariables,
  expressionAt,
  MAX_HISTORY,
  nextPinColor,
  pinChanged,
  pinValue,
  previousInCall,
  type Pin,
  type ScopeState,
  type Snapshot,
  type WatchResult,
} from './history';
import { NodeBackend } from './node';
import { samePath, type DebugBackend, type DebugHost, type Scope, type StackFrame, type StopInfo, type Variable } from './types';

export type DebugStatus = 'starting' | 'running' | 'paused';

export interface PinState {
  pin: Pin;
  /** undefined = not known at this stop. */
  result?: WatchResult;
  /** Changed (or appeared) since the stop before in the same function call. */
  changed: boolean;
}

type Action = 'continue' | 'step' | 'pause';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Highlighted variables are remembered per program, also between runs of the app.
const PINS_KEY = 'editor.debugPins.v1';
const pinKey = (path: string) => path.replace(/\//g, '\\').toLowerCase();

function readPinStore(): Record<string, Pin[]> {
  try {
    const all = JSON.parse(localStorage.getItem(PINS_KEY) ?? '{}');
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
}

function loadPins(path: string): Pin[] {
  const pins = readPinStore()[pinKey(path)];
  if (!Array.isArray(pins)) return [];
  return pins.filter((p) => typeof p?.expression === 'string' && typeof p.color === 'number');
}

function savePins(path: string, pins: Pin[]): void {
  const all = readPinStore();
  delete all[pinKey(path)];
  if (pins.length) all[pinKey(path)] = pins;
  // Only the most recently changed files.
  const keys = Object.keys(all);
  for (const key of keys.slice(0, Math.max(0, keys.length - 100))) delete all[key];
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable: they're remembered until the app closes.
  }
}

export class DebugController {
  /** null = no session. */
  status: DebugStatus | null = null;
  /** The program has ended, but the debug view stays so the user can still look back. */
  finished = false;
  /** Name of the file being debugged. */
  name = '';
  /** Every stop in this session, oldest first. While paused, the last one is where the program is. */
  history: Snapshot[] = [];
  /** Counts stops; variable handles from an earlier stop are no longer valid. */
  stopId = 0;
  /** Expressions shown under "Uttrykk", evaluated at every stop. */
  watches: string[] = [];
  /** Highlighted variables (or expressions) for the program being debugged. */
  pins: Pin[] = [];

  /** The stop the program is at (null while it runs). */
  private current: Snapshot | null = null;
  /** Index in `history` of the stop shown when stepping back; null = the present. */
  private pastIndex: number | null = null;
  /** What made the program stop besides a breakpoint ('step' or 'pause'). */
  private lastAction: Action = 'continue';
  /** The file being debugged (whose pins these are). */
  private program = '';
  /** Variables whose children are being fetched (at the current stop). */
  private loadingChildren = new Set<number>();
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
    this.showExecutionLine(false);
    for (const fn of this.listeners) fn();
  }

  get active(): boolean {
    return this.status !== null;
  }

  /** The debug view is shown: a session, or one that ended and can still be looked back at. */
  get visible(): boolean {
    return this.active || this.finished;
  }

  /** The stop the debug view shows: where the program is, or an earlier one when stepping back. */
  get shown(): Snapshot | null {
    return this.pastIndex !== null ? (this.history[this.pastIndex] ?? null) : this.current;
  }

  /** Looking at an earlier stop (the program is still where it was). */
  get inPast(): boolean {
    return this.pastIndex !== null;
  }

  get stop(): StopInfo | null {
    return this.shown?.stop ?? null;
  }

  get frames(): StackFrame[] {
    return this.shown?.frames ?? [];
  }

  get frameIndex(): number {
    return this.shown?.frameIndex ?? 0;
  }

  get frame(): StackFrame | undefined {
    return this.frames[this.frameIndex];
  }

  get scopes(): ScopeState[] {
    return this.shown?.scopes ?? [];
  }

  /** The variables of the stop shown have been fetched. */
  get loaded(): boolean {
    return this.shown?.loaded ?? false;
  }

  get watchResults(): WatchResult[] {
    return this.shown?.watchResults ?? [];
  }

  /** Where the program actually is, while paused. */
  get presentFrame(): StackFrame | undefined {
    return this.current?.frames[this.current.frameIndex];
  }

  /** Index of "now": the stop the program is at, or one past the last stop when it has ended. */
  private get presentIndex(): number {
    return this.current ? this.history.length - 1 : this.history.length;
  }

  /** 1-based number of the stop shown, out of `history.length`. */
  get stepNumber(): number {
    return (this.pastIndex ?? this.presentIndex) + 1;
  }

  /** "Gå ut av funksjonen" makes sense: the program is in a function called from the user's code. */
  get canStepOut(): boolean {
    const frames = this.current?.frames ?? [];
    const top = frames.findIndex((f) => f.path);
    return this.status === 'paused' && !this.inPast && top >= 0 && frames.slice(top + 1).some((f) => f.path);
  }

  get canStepBack(): boolean {
    return ((this.status === 'paused' && !!this.current) || this.finished) && this.stepNumber > 1;
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
    this.finished = false;
    this.clearStop();
    this.history = [];
    this.changed();

    if (!(await doc.ensureSaved()) || !doc.file?.path) {
      this.end(session);
      this.ws.showError('Filen må lagres før den kan feilsøkes');
      return;
    }
    this.name = doc.name;
    const program = doc.file.path;
    if (!samePath(program, this.program)) {
      this.program = program;
      this.pins = loadPins(program);
    }
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
      terminated: () => this.end(session, true),
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
  private end(session: number, ended = false): void {
    if (session !== this.session || !this.active) return;
    this.backend = null;
    this.status = null;
    this.clearStop();
    // The program ended by itself: keep the stops, so the user can see how it got there.
    this.finished = ended && this.history.length > 0;
    if (!this.finished) this.history = [];
    for (const { timer } of this.pendingSync.values()) clearTimeout(timer);
    this.pendingSync.clear();
    this.changed();
  }

  /** Shift+F5: end the session and the program (or close the view of one that has ended). */
  stopSession(): boolean {
    if (!this.active) {
      if (!this.finished) return false;
      this.finished = false;
      this.history = [];
      this.clearStop();
      this.changed();
      return true;
    }
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
    if (!this.visible || !doc) return false;
    const running = this.active;
    this.stopSession();
    if (running) setTimeout(() => this.start(doc), 300);
    else this.start(doc);
    return true;
  }

  // ---------- Running ----------

  private act(action: Action, run: (backend: DebugBackend, threadId: number) => Promise<void>): boolean {
    if (this.inPast && action !== 'pause') {
      // Looking back: the steps go forward through what already happened; F5 goes back to now.
      if (action === 'continue') this.toPresent();
      else this.showStop(this.stepNumber);
      return true;
    }
    const backend = this.backend;
    if (!backend) return false;
    if (action === 'pause' ? this.status !== 'running' : this.status !== 'paused') return false;
    this.lastAction = action;
    const threadId = this.current?.stop.threadId ?? 1;
    if (action !== 'pause') {
      this.status = 'running';
      // Stepping usually stops again right away: keep showing where we were until then.
      if (action === 'continue') this.clearStop();
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
  stepOut = () => {
    // In the main program there's no function to go out of: it would just run to the end.
    if (this.status === 'paused' && !this.inPast && !this.canStepOut) {
      this.ws.showError('Programmet er ikke inne i en funksjon nå. Trykk F10 for neste linje, eller Shift+F10 for å gå tilbake.');
      return true;
    }
    return this.act('step', (b, t) => b.stepOut(t));
  };
  pause = () => this.act('pause', (b, t) => b.pause(t));

  private continued(): void {
    if (this.status === 'running') return;
    this.status = 'running';
    this.clearStop();
    this.changed();
  }

  private clearStop(): void {
    this.current = null;
    this.pastIndex = null;
    this.loadingChildren.clear();
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
    const paused = this.lastAction === 'pause' && (info.reason === 'step' || info.reason === 'pause');
    const snapshot: Snapshot = {
      id: stopId,
      stop: paused ? { ...info, reason: 'pause' } : info,
      frames,
      // The innermost frame in a file we can show (skips e.g. Node internals).
      frameIndex: Math.max(0, frames.findIndex((f) => f.path)),
      scopes: [],
      loaded: false,
      watchResults: [],
      pinResults: [],
      children: new Map(),
    };
    this.clearStop();
    this.history.push(snapshot);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.current = snapshot;
    this.status = 'paused';
    this.changed();
    await this.reveal();
    await this.load(snapshot);
  }

  /** Whether this is the stop the program is paused at (only then can the debugger be asked). */
  private isLive(snapshot: Snapshot): boolean {
    return snapshot === this.current && this.status === 'paused' && !!this.backend;
  }

  /** Fetch the variables and expressions for the present stop's selected frame. */
  private async load(snapshot: Snapshot): Promise<void> {
    await Promise.all([this.loadScopes(snapshot), this.evaluate(snapshot)]);
  }

  /** Pick a frame in the call stack: show its line and its variables. */
  selectFrame(index: number): void {
    const snapshot = this.current;
    if (this.inPast || this.status !== 'paused' || !snapshot?.frames[index] || index === snapshot.frameIndex) return;
    snapshot.frameIndex = index;
    snapshot.scopes = [];
    snapshot.loaded = false;
    this.changed();
    void this.reveal().then(() => this.load(snapshot));
  }

  // ---------- Stepping back ----------

  /** Shift+F10: show the stop before this one, as it was then (the program stays where it is). */
  stepBack = (): boolean => {
    if (!((this.status === 'paused' && this.current) || this.finished)) return false;
    if (this.canStepBack) this.showStop(this.stepNumber - 2);
    return true;
  };

  /** Back to where the program is now (or to "it has ended"). */
  toPresent = (): boolean => {
    if (!this.inPast) return false;
    this.showStop(this.presentIndex);
    return true;
  };

  private showStop(index: number): void {
    this.pastIndex = index >= this.presentIndex ? null : Math.max(0, index);
    this.changed();
    void this.reveal();
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

  /** Mark the paused line in the active document (if it's the frame's file), with the highlighted values. */
  private showExecutionLine(scroll: boolean): void {
    const view = this.getView();
    const current = view.state.field(executionField, false);
    if (current === undefined) return; // Not a debuggable code file.
    const frame = this.frame;
    const line = frame && samePath(frame.path, this.ws.activeDoc?.file?.path) ? frame.line : null;
    const next: ExecutionLine | null =
      line && line <= view.state.doc.lines
        ? {
            line,
            top: this.frameIndex === 0,
            past: this.inPast,
            pins: this.pinStates().map(({ pin, result, changed }) => ({
              expression: pin.expression,
              color: pin.color,
              value: result?.value?.value,
              changed,
            })),
          }
        : null;
    const effects = [];
    if (JSON.stringify(current) !== JSON.stringify(next)) effects.push(setExecutionLine.of(next));
    if (scroll && next) {
      effects.push(EditorView.scrollIntoView(view.state.doc.line(next.line).from, { y: 'nearest', yMargin: 120 }));
    }
    if (effects.length) view.dispatch({ effects });
  }

  // ---------- Variables and expressions ----------

  private async loadScopes(snapshot: Snapshot): Promise<void> {
    const { backend } = this;
    const frame = snapshot.frames[snapshot.frameIndex];
    if (!backend || !frame) return;
    let scopes: Scope[] = [];
    let failed = false;
    try {
      scopes = await backend.scopes(frame.id);
    } catch {
      failed = true;
    }
    const states = await Promise.all(
      scopes.map(async (scope, i) => ({
        scope,
        variables:
          scope.expensive && i > 0
            ? null
            : await backend.variables(scope.ref).catch(() => {
                failed = true;
                return [];
              }),
      })),
    );
    if (frame !== snapshot.frames[snapshot.frameIndex] || !this.history.includes(snapshot)) return;
    // If the program moved on meanwhile, keep the answers only if they all came (handles expire),
    // so the stop can still be looked back at.
    if (failed && !this.isLive(snapshot)) return;
    snapshot.scopes = states;
    snapshot.loaded = true;
    this.changed();
  }

  /**
   * Children of an expandable variable at the stop shown: null while they're
   * fetched, undefined if they can't be (an earlier stop where it wasn't opened).
   */
  childrenOf(ref: number): Variable[] | null | undefined {
    const snapshot = this.shown;
    const cached = snapshot?.children.get(ref);
    if (cached) return cached;
    if (!snapshot || !this.isLive(snapshot)) return undefined;
    if (!this.loadingChildren.has(ref)) {
      this.loadingChildren.add(ref);
      void this.backend!.variables(ref)
        .catch(() => [])
        .then((vars) => {
          this.loadingChildren.delete(ref);
          if (!this.isLive(snapshot)) return;
          snapshot.children.set(ref, vars);
          this.changed();
        });
    }
    return null;
  }

  addWatch(expression: string): void {
    const expr = expression.trim();
    if (!expr || this.watches.includes(expr) || this.pinFor(expr)) return;
    this.watches.push(expr);
    this.changed();
    if (this.current) void this.evaluate(this.current);
  }

  removeWatch(expression: string): void {
    this.watches = this.watches.filter((w) => w !== expression);
    this.changed();
  }

  /** Evaluate the expressions and the highlighted variables at the present stop. */
  private async evaluate(snapshot: Snapshot): Promise<void> {
    const { backend } = this;
    if (!backend || !this.isLive(snapshot)) return;
    const frameId = snapshot.frames[snapshot.frameIndex]?.id;
    const run = (expression: string): Promise<WatchResult> =>
      backend.evaluate(expression, frameId).then(
        (value) => ({ expression, value }),
        (err) => ({ expression, error: errorText(err) }),
      );
    const [watches, pins] = await Promise.all([
      Promise.all(this.watches.map(run)),
      Promise.all(this.pins.map((p) => run(p.expression))),
    ]);
    if (!this.isLive(snapshot) || frameId !== snapshot.frames[snapshot.frameIndex]?.id) return;
    snapshot.watchResults = watches;
    snapshot.pinResults = pins;
    this.changed();
  }

  // ---------- Highlighted variables ----------

  pinFor(expression: string): Pin | undefined {
    return this.pins.find((p) => p.expression === expression);
  }

  /** Highlight a variable (or expression), or stop highlighting it. */
  togglePin(expression: string): void {
    const expr = expression.trim();
    if (!expr) return;
    const pinned = this.pinFor(expr);
    if (pinned) {
      this.pins = this.pins.filter((p) => p !== pinned);
    } else {
      this.pins = [...this.pins, { expression: expr, color: nextPinColor(this.pins) }];
      // A highlighted expression moves up from "Uttrykk".
      this.watches = this.watches.filter((w) => w !== expr);
    }
    if (this.program) savePins(this.program, this.pins);
    this.changed();
    if (!pinned && this.current) void this.evaluate(this.current);
  }

  /** Shift+F9: highlight the variable at the cursor (or the selected expression), or stop highlighting it. */
  pinAtCursor(): boolean {
    if (!this.visible) return false;
    const { state } = this.getView();
    const range = state.selection.main;
    const line = state.doc.lineAt(range.head);
    const expression = range.empty ? expressionAt(line.text, range.head - line.from) : state.sliceDoc(range.from, range.to).trim();
    if (!expression || expression.includes('\n')) this.ws.showError('Sett markøren på en variabel for å fremheve den');
    else this.togglePin(expression);
    return true;
  }

  /** The highlighted variables at the stop shown. */
  pinStates(): PinState[] {
    const snapshot = this.shown;
    const before = snapshot ? this.before(snapshot) : undefined;
    return this.pins.map((pin) => ({
      pin,
      result: snapshot ? pinValue(snapshot, pin.expression) : undefined,
      changed: !!snapshot && pinChanged(before, snapshot, pin.expression),
    }));
  }

  /** Variables at the stop shown that changed since the stop before (as `variableKey`s). */
  changedVariables(): Set<string> {
    const snapshot = this.shown;
    return snapshot ? changedVariables(this.before(snapshot), snapshot) : new Set();
  }

  private before(snapshot: Snapshot): Snapshot | undefined {
    return previousInCall(this.history, this.history.indexOf(snapshot));
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
