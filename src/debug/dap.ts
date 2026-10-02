/**
 * Debug Adapter Protocol: a client for adapters that run as a separate
 * program (e.g. `python -m debugpy.adapter`), and the backend built on it.
 * https://microsoft.github.io/debug-adapter-protocol/
 */
import type { AdapterProcess } from '../platform';
import { fillLaunchArgs, type DebuggerConfig } from './debuggers';
import type { DebugBackend, DebugEvents, DebugHost, LaunchOptions, Scope, StackFrame, Variable } from './types';

interface DapMessage {
  seq: number;
  type: 'request' | 'response' | 'event';
  command?: string;
  event?: string;
  arguments?: unknown;
  body?: any;
  request_seq?: number;
  success?: boolean;
  message?: string;
}

export interface DapHandlers {
  event(name: string, body: any): void;
  /** Requests from the adapter to us (e.g. runInTerminal). */
  reverseRequest(command: string, args: any): Promise<unknown>;
}

/** Request/response bookkeeping on top of a message transport. */
export class DapClient {
  private seq = 1;
  private pending = new Map<number, { resolve(body: any): void; reject(err: Error): void }>();
  private closed: Error | null = null;

  constructor(
    private send: (json: string) => Promise<void>,
    private handlers: DapHandlers,
  ) {}

  request<T = any>(command: string, args?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(this.closed);
    const seq = this.seq++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(seq, { resolve, reject });
      this.send(JSON.stringify({ seq, type: 'request', command, arguments: args })).catch((err) => {
        this.pending.delete(seq);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  receive(json: string): void {
    let message: DapMessage;
    try {
      message = JSON.parse(json);
    } catch {
      return;
    }
    if (message.type === 'response') {
      const waiting = this.pending.get(message.request_seq!);
      if (!waiting) return;
      this.pending.delete(message.request_seq!);
      if (message.success) waiting.resolve(message.body ?? {});
      else waiting.reject(new Error(message.body?.error?.format ?? message.message ?? `${message.command} feilet`));
    } else if (message.type === 'event') {
      this.handlers.event(message.event!, message.body ?? {});
    } else if (message.type === 'request') {
      void this.answer(message);
    }
  }

  private async answer(request: DapMessage): Promise<void> {
    const response = { seq: this.seq++, type: 'response', request_seq: request.seq, command: request.command };
    try {
      const body = await this.handlers.reverseRequest(request.command!, request.arguments);
      await this.send(JSON.stringify({ ...response, success: true, body }));
    } catch (err) {
      await this.send(JSON.stringify({ ...response, success: false, message: String(err) })).catch(() => {});
    }
  }

  /** The adapter is gone: fail everything still waiting. */
  close(error: Error): void {
    this.closed = error;
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
}

export class DapBackend implements DebugBackend {
  private client: DapClient;
  private process: AdapterProcess | null = null;
  private capabilities: any = {};
  private initialized: Promise<void>;
  private resolveInitialized!: () => void;
  private stderr = '';
  private ended = false;

  constructor(
    private config: DebuggerConfig,
    private host: DebugHost,
    private events: DebugEvents,
  ) {
    this.initialized = new Promise((resolve) => (this.resolveInitialized = resolve));
    this.client = new DapClient((json) => this.process?.send(json) ?? Promise.reject(new Error('Ikke startet')), {
      event: (name, body) => this.onEvent(name, body),
      reverseRequest: (command, args) => this.onRequest(command, args),
    });
  }

  async start(options: LaunchOptions): Promise<void> {
    const { config } = this;
    this.process = await this.host.processes.startAdapter(
      { program: config.command ?? '', args: config.args ?? [], cwd: options.cwd },
      {
        onMessage: (json) => this.client.receive(json),
        onStderr: (text) => (this.stderr += text),
        onExit: () => {
          this.client.close(new Error(this.stderr.trim() || 'Feilsøkeren avsluttet'));
          this.end();
        },
      },
    );

    this.capabilities = await this.client.request('initialize', {
      clientID: 'editor',
      clientName: 'Editor',
      adapterID: options.lang,
      locale: 'nb',
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsRunInTerminalRequest: true,
    });
    // debugpy answers `launch` only after configurationDone, so don't wait for it here.
    const launched = this.client.request('launch', fillLaunchArgs(config.launch ?? {}, { file: options.program, cwd: options.cwd }));
    launched.catch(() => {});
    await Promise.race([this.initialized, launched.then(() => this.initialized)]);

    for (const [path, lines] of options.breakpoints) await this.setBreakpoints(path, lines);
    const filters: { filter: string }[] = this.capabilities.exceptionBreakpointFilters ?? [];
    if (filters.length) {
      // Stop on errors the program doesn't handle, so the user sees where it crashed.
      const uncaught = filters.some((f) => f.filter === 'uncaught') ? ['uncaught'] : [];
      await this.client.request('setExceptionBreakpoints', { filters: uncaught });
    }
    if (this.capabilities.supportsConfigurationDoneRequest) await this.client.request('configurationDone');
    await launched;
  }

  private onEvent(name: string, body: any): void {
    switch (name) {
      case 'initialized':
        this.resolveInitialized();
        break;
      case 'stopped':
        void this.stopped(body);
        break;
      case 'continued':
        this.events.continued();
        break;
      case 'output':
        if (body.category !== 'telemetry' && body.output) {
          const category = body.category === 'stdout' || body.category === 'stderr' ? body.category : 'console';
          this.events.output(body.output, category);
        }
        break;
      case 'terminated':
        this.end();
        break;
    }
  }

  private async stopped(body: any): Promise<void> {
    const threadId = body.threadId ?? 1;
    let text: string | undefined;
    if (body.reason === 'exception') {
      text = body.text ?? body.description;
      if (this.capabilities.supportsExceptionInfoRequest) {
        try {
          const info = await this.client.request('exceptionInfo', { threadId });
          text = [info.exceptionId, info.description].filter(Boolean).join(': ') || text;
        } catch {
          // Keep the text from the event.
        }
      }
    }
    this.events.stopped({ reason: body.reason ?? 'pause', threadId, text });
  }

  private async onRequest(command: string, args: any): Promise<unknown> {
    if (command === 'runInTerminal') {
      const [program, ...rest] = args.args as string[];
      const { pid } = await this.host.runInTerminal({ title: args.title ?? '', program, args: rest, cwd: args.cwd, env: args.env });
      return pid ? { processId: pid } : {};
    }
    throw new Error(`Støttes ikke: ${command}`);
  }

  /** The session is over: tell the app once, and make sure the adapter goes away. */
  private end(): void {
    if (this.ended) return;
    this.ended = true;
    this.events.terminated();
    const process = this.process;
    void this.client
      .request('disconnect', { terminateDebuggee: true })
      .catch(() => {})
      .finally(() => setTimeout(() => process?.kill(), 1000));
  }

  async setBreakpoints(path: string, lines: number[]): Promise<void> {
    await this.client.request('setBreakpoints', {
      source: { path },
      breakpoints: lines.map((line) => ({ line })),
      lines,
    });
  }

  resume(threadId: number) {
    return this.client.request('continue', { threadId });
  }
  stepOver(threadId: number) {
    return this.client.request('next', { threadId });
  }
  stepInto(threadId: number) {
    return this.client.request('stepIn', { threadId });
  }
  stepOut(threadId: number) {
    return this.client.request('stepOut', { threadId });
  }
  pause(threadId: number) {
    return this.client.request('pause', { threadId });
  }

  async stackTrace(threadId: number): Promise<StackFrame[]> {
    const body = await this.client.request('stackTrace', { threadId, startFrame: 0, levels: 100 });
    return (body.stackFrames ?? []).map((f: any) => ({
      id: f.id,
      name: f.name,
      path: f.source?.path,
      line: f.line,
      column: f.column,
    }));
  }

  async scopes(frameId: number): Promise<Scope[]> {
    const body = await this.client.request('scopes', { frameId });
    // The first scope is the most relevant one (local variables); the rest start closed.
    return (body.scopes ?? []).map((s: any, i: number) => ({
      name: s.name,
      ref: s.variablesReference,
      expensive: s.expensive,
      collapsed: s.expensive || i > 0,
    }));
  }

  async variables(ref: number): Promise<Variable[]> {
    const body = await this.client.request('variables', { variablesReference: ref });
    return (body.variables ?? []).map((v: any) => ({ name: v.name, value: v.value, type: v.type, ref: v.variablesReference ?? 0 }));
  }

  async evaluate(expression: string, frameId: number | undefined): Promise<Variable> {
    const body = await this.client.request('evaluate', { expression, frameId, context: 'watch' });
    return { name: expression, value: body.result, type: body.type, ref: body.variablesReference ?? 0 };
  }

  async stop(): Promise<void> {
    if (this.ended) return;
    try {
      await Promise.race([
        this.client.request('disconnect', { terminateDebuggee: true }),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    } catch {
      // Already gone.
    }
    this.end();
  }
}
