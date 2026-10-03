/**
 * Debugging JavaScript/TypeScript with Node's built-in inspector (Chrome
 * DevTools Protocol over a WebSocket). The program runs in the terminal with
 * --inspect-brk; this translates between the protocol and `DebugBackend`.
 */
import { runnerFor } from '../features/codeBlockTools/runners';
import type { DebugBackend, DebugEvents, DebugHost, LaunchOptions, Scope, StackFrame, Variable } from './types';

interface RemoteObject {
  type: string;
  subtype?: string;
  className?: string;
  value?: unknown;
  unserializableValue?: string;
  description?: string;
  objectId?: string;
  preview?: ObjectPreview;
}

interface ObjectPreview {
  type: string;
  subtype?: string;
  description?: string;
  overflow: boolean;
  properties: { name: string; type: string; subtype?: string; value?: string }[];
}

interface CallFrame {
  callFrameId: string;
  functionName: string;
  location: { scriptId: string; lineNumber: number; columnNumber?: number };
  url: string;
  scopeChain: { type: string; name?: string; object: RemoteObject }[];
}

// ---------- Paths and URLs ----------

/** "C:\\a b\\x.mjs" -> "file:///C:/a%20b/x.mjs" (like Node's pathToFileURL). */
export function pathToFileUrl(path: string): string {
  let p = path.replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(p)) p = `/${p}`;
  return `file://${[...p].map((ch) => (/[A-Za-z0-9\-._~!$&'()*+,;=:@/]/.test(ch) ? ch : encodeURIComponent(ch))).join('')}`;
}

/** "file:///C:/a%20b/x.mjs" -> "C:\\a b\\x.mjs"; undefined for non-file URLs (node:internal/…). */
export function fileUrlToPath(url: string): string | undefined {
  if (!url.startsWith('file://')) return undefined;
  let p: string;
  try {
    p = decodeURIComponent(url.slice('file://'.length));
  } catch {
    return undefined;
  }
  if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1).replace(/\//g, '\\');
  return p;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * A regex for a file's URL that ignores case (Windows) and whether characters
 * are percent-encoded, so breakpoints match however Node spells the URL.
 */
export function urlRegexFor(path: string): string {
  const url = pathToFileUrl(path);
  const hexByte = (byte: string) => `%${[...byte].map((d) => (/[a-f]/i.test(d) ? `[${d.toLowerCase()}${d.toUpperCase()}]` : d)).join('')}`;
  let out = '';
  for (let i = 0; i < url.length; i++) {
    if (url[i] === '%') {
      // An encoded character: its UTF-8 bytes, matched either encoded or as the raw character.
      let bytes = '';
      while (url[i] === '%') {
        bytes += url.slice(i + 1, i + 3);
        i += 3;
      }
      i--;
      const raw = decodeURIComponent(bytes.replace(/(..)/g, '%$1'));
      const encoded = bytes.match(/../g)!.map(hexByte).join('');
      const rawPattern = [...raw].map((ch) => (/[a-z]/i.test(ch) ? `[${ch.toLowerCase()}${ch.toUpperCase()}]` : escapeRegex(ch))).join('');
      out += `(?:${encoded}|${rawPattern})`;
    } else if (/[a-z]/i.test(url[i])) {
      out += `[${url[i].toLowerCase()}${url[i].toUpperCase()}]`;
    } else {
      out += escapeRegex(url[i]);
    }
  }
  return `^${out}$`;
}

// ---------- Values ----------

const SCOPE_NAMES: Record<string, string> = {
  local: 'Lokale',
  closure: 'Omsluttende',
  block: 'Blokk',
  catch: 'Catch',
  script: 'Skript',
  module: 'Modul',
  global: 'Globale',
  with: 'With',
  eval: 'Eval',
};

function previewValue(p: { type: string; subtype?: string; value?: string }): string {
  if (p.type === 'string') return JSON.stringify(p.value ?? '');
  if (p.type === 'function') return 'ƒ';
  if (p.type === 'object' && p.subtype !== 'null') return p.value ?? 'Object';
  return p.value ?? p.type;
}

/** Short text for a value, like the browser console shows it. */
export function describeValue(o: RemoteObject): string {
  switch (o.type) {
    case 'undefined':
      return 'undefined';
    case 'string':
      return JSON.stringify(o.value);
    case 'number':
    case 'boolean':
    case 'bigint':
      return o.unserializableValue ?? o.description ?? String(o.value);
    case 'symbol':
      return o.description ?? 'Symbol()';
    case 'function': {
      const first = (o.description ?? '').split('\n')[0];
      const name = /(?:function\*?|class)\s+([\w$]+)/.exec(first)?.[1] ?? /^(?:async\s+)?([\w$]+)\s*\(/.exec(first)?.[1];
      return /^class\b/.test(first) ? `class ${name ?? ''}`.trim() : `ƒ ${name ?? ''}()`;
    }
    case 'object': {
      if (o.subtype === 'null') return 'null';
      const p = o.preview;
      if (!p || ['error', 'date', 'regexp', 'promise', 'map', 'set', 'weakmap', 'weakset'].includes(o.subtype ?? '')) {
        return (o.description ?? o.className ?? 'Object').split('\n')[0];
      }
      const more = p.overflow ? ', …' : '';
      if (o.subtype === 'array' || o.subtype === 'typedarray') {
        return `[${p.properties.map(previewValue).join(', ')}${more}]`;
      }
      const prefix = o.className && o.className !== 'Object' ? `${o.className} ` : '';
      return `${prefix}{${p.properties.map((x) => `${x.name}: ${previewValue(x)}`).join(', ')}${more}}`;
    }
    default:
      return o.description ?? o.type;
  }
}

/** Objects can be expanded (except null). */
const expandable = (o: RemoteObject | undefined) => !!o?.objectId && (o.type === 'object' || o.type === 'function') && o.subtype !== 'null';

// ---------- Backend ----------

export class NodeBackend implements DebugBackend {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve(result: any): void; reject(err: Error): void }>();
  private scripts = new Map<string, string>(); // scriptId -> url
  private breakpointIds = new Map<string, string[]>(); // lower-case path -> breakpoint ids
  private frames: CallFrame[] = [];
  private refs = new Map<number, string>(); // variables handle -> objectId
  private nextRef = 1;
  private firstPause = true;
  private ended = false;

  constructor(
    private host: DebugHost,
    private events: DebugEvents,
  ) {}

  async start(options: LaunchOptions): Promise<void> {
    const runner = runnerFor(options.lang) ?? runnerFor('javascript')!;
    const port = await this.host.processes.freePort();
    const args = [`--inspect-brk=127.0.0.1:${port}`, ...runner.args.map((a) => a.replaceAll('{file}', options.program))];
    const name = options.program.split(/[\\/]/).pop()!;
    await this.host.runInTerminal({ title: name, program: runner.command, args, cwd: options.cwd });
    const url = await this.host.processes.inspectorUrl(port, 15000);
    await this.connect(url);

    await this.send('Runtime.enable');
    await this.send('Debugger.enable');
    // Step over Node's own code and installed packages.
    await this.send('Debugger.setBlackboxPatterns', { patterns: ['^node:', '[\\\\/]node_modules[\\\\/]'] }).catch(() => {});
    await this.send('Debugger.setPauseOnExceptions', { state: 'uncaught' });
    for (const [path, lines] of options.breakpoints) await this.setBreakpoints(path, lines);
    await this.send('Runtime.runIfWaitingForDebugger');
  }

  private connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error('Fikk ikke kontakt med Node sin feilsøker'));
      socket.onclose = () => this.end();
      socket.onmessage = (e) => this.receive(String(e.data));
      this.socket = socket;
    });
  }

  private send<T = any>(method: string, params?: unknown): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Feilsøkingen er avsluttet'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  private receive(json: string): void {
    const message = JSON.parse(json);
    if (message.id !== undefined) {
      const waiting = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) waiting?.reject(new Error(message.error.message));
      else waiting?.resolve(message.result ?? {});
      return;
    }
    const params = message.params ?? {};
    switch (message.method) {
      case 'Debugger.scriptParsed':
        this.scripts.set(params.scriptId, params.url);
        break;
      case 'Debugger.paused':
        this.paused(params);
        break;
      case 'Debugger.resumed':
        this.events.continued();
        break;
      case 'Runtime.executionContextDestroyed':
        // The program is done; Node waits for us to disconnect before it exits.
        if (!this.ended) this.socket?.close();
        break;
    }
  }

  private paused(params: { callFrames: CallFrame[]; reason: string; data?: RemoteObject; hitBreakpoints?: string[] }): void {
    this.frames = params.callFrames;
    this.refs.clear();
    const hit = (params.hitBreakpoints?.length ?? 0) > 0;
    const exception = params.reason === 'exception' || params.reason === 'promiseRejection';
    // --inspect-brk stops before the first line; carry on unless a breakpoint is right there.
    if (this.firstPause) {
      this.firstPause = false;
      if (!hit && !exception) {
        void this.send('Debugger.resume');
        return;
      }
    }
    const reason = exception ? 'exception' : hit ? 'breakpoint' : params.reason === 'other' ? 'step' : params.reason;
    const text = exception && params.data ? (params.data.description ?? describeValue(params.data)).split('\n')[0] : undefined;
    this.events.stopped({ reason, threadId: 1, text });
  }

  private end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const { reject } of this.pending.values()) reject(new Error('Feilsøkingen er avsluttet'));
    this.pending.clear();
    this.socket?.close();
    this.events.terminated();
  }

  async setBreakpoints(path: string, lines: number[]): Promise<void> {
    const key = path.toLowerCase();
    for (const id of this.breakpointIds.get(key) ?? []) {
      await this.send('Debugger.removeBreakpoint', { breakpointId: id }).catch(() => {});
    }
    const ids: string[] = [];
    const urlRegex = urlRegexFor(path);
    for (const line of lines) {
      try {
        const result = await this.send('Debugger.setBreakpointByUrl', { lineNumber: line - 1, urlRegex, columnNumber: 0 });
        ids.push(result.breakpointId);
      } catch {
        // E.g. a line without code; skip it.
      }
    }
    this.breakpointIds.set(key, ids);
  }

  async resume() {
    await this.send('Debugger.resume');
  }
  async stepOver() {
    await this.send('Debugger.stepOver');
  }
  async stepInto() {
    await this.send('Debugger.stepInto');
  }
  async stepOut() {
    await this.send('Debugger.stepOut');
  }
  async pause() {
    await this.send('Debugger.pause');
  }

  async stackTrace(): Promise<StackFrame[]> {
    return this.frames.map((f, i) => ({
      id: i,
      name: f.functionName || '(hovedprogram)',
      path: fileUrlToPath(f.url || this.scripts.get(f.location.scriptId) || ''),
      line: f.location.lineNumber + 1,
      column: (f.location.columnNumber ?? 0) + 1,
    }));
  }

  async scopes(frameId: number): Promise<Scope[]> {
    const frame = this.frames[frameId];
    if (!frame) return [];
    return frame.scopeChain.map((s) => ({
      name: SCOPE_NAMES[s.type] ?? s.type,
      ref: this.handle(s.object.objectId!),
      expensive: s.type === 'global',
      collapsed: s.type === 'global',
    }));
  }

  private handle(objectId: string): number {
    const ref = this.nextRef++;
    this.refs.set(ref, objectId);
    return ref;
  }

  async variables(ref: number): Promise<Variable[]> {
    const objectId = this.refs.get(ref);
    if (!objectId) return [];
    const result = await this.send('Runtime.getProperties', { objectId, ownProperties: true, generatePreview: true });
    const vars: Variable[] = [];
    for (const p of result.result ?? []) {
      // Own enumerable properties (plus an array's length); getters aren't run.
      if (!p.value || (p.enumerable === false && p.name !== 'length') || p.name === '__proto__') continue;
      const value: RemoteObject = p.value;
      vars.push({ name: p.name, value: describeValue(value), type: value.subtype ?? value.type, ref: expandable(value) ? this.handle(value.objectId!) : 0 });
    }
    for (const p of result.internalProperties ?? []) {
      // Map/Set contents, wrapped primitives.
      if (p.name !== '[[Entries]]' && p.name !== '[[PrimitiveValue]]') continue;
      const value: RemoteObject = p.value;
      vars.push({ name: p.name, value: describeValue(value), type: value.subtype ?? value.type, ref: expandable(value) ? this.handle(value.objectId!) : 0 });
    }
    return vars;
  }

  async evaluate(expression: string, frameId: number | undefined): Promise<Variable> {
    const frame = frameId !== undefined ? this.frames[frameId] : undefined;
    const result = frame
      ? await this.send('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression, generatePreview: true })
      : await this.send('Runtime.evaluate', { expression, generatePreview: true });
    if (result.exceptionDetails) {
      const e = result.exceptionDetails;
      throw new Error((e.exception?.description ?? e.text ?? 'Feil').split('\n')[0]);
    }
    const value: RemoteObject = result.result;
    return { name: expression, value: describeValue(value), type: value.subtype ?? value.type, ref: expandable(value) ? this.handle(value.objectId!) : 0 };
  }

  async stop(): Promise<void> {
    this.end();
  }
}
