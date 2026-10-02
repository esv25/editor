/**
 * The debugger model the app works with, shaped after the Debug Adapter
 * Protocol. Each debugger (debugpy over DAP, Node's inspector) implements
 * `DebugBackend`; the rest of the app doesn't know which one it talks to.
 */
import type { ProcessHost } from '../platform';

export interface StackFrame {
  id: number;
  name: string;
  /** File on disk, if the frame is in one (not e.g. Node internals). */
  path?: string;
  /** 1-based. */
  line: number;
  column: number;
}

export interface Scope {
  name: string;
  /** Handle for `variables()`. */
  ref: number;
  /** Many or slow to fetch (e.g. globals): only loaded when expanded. */
  expensive?: boolean;
  /** Start closed in the debug view (less important, e.g. globals). */
  collapsed?: boolean;
}

export interface Variable {
  name: string;
  value: string;
  type?: string;
  /** Handle for the children (0 = none). */
  ref: number;
}

export interface StopInfo {
  /** 'breakpoint' | 'step' | 'exception' | 'pause' | 'entry' | … */
  reason: string;
  threadId: number;
  /** For exceptions: the exception, e.g. "ZeroDivisionError: division by zero". */
  text?: string;
}

export interface DebugEvents {
  stopped(info: StopInfo): void;
  continued(): void;
  /** Messages from the debugger (not the program's own output, which goes to its terminal). */
  output(text: string, category: 'console' | 'stdout' | 'stderr'): void;
  terminated(): void;
}

export interface LaunchOptions {
  /** The file to debug. */
  program: string;
  cwd: string;
  lang: string;
  /** File path -> 1-based line numbers. */
  breakpoints: Map<string, number[]>;
}

export interface TerminalRequest {
  title: string;
  program: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | null>;
}

/** What a debugger needs from the app. */
export interface DebugHost {
  processes: ProcessHost;
  /** Start the program being debugged in the terminal (so it can read input). */
  runInTerminal(request: TerminalRequest): Promise<{ pid: number | null }>;
}

export interface DebugBackend {
  start(options: LaunchOptions): Promise<void>;
  setBreakpoints(path: string, lines: number[]): Promise<void>;
  resume(threadId: number): Promise<void>;
  stepOver(threadId: number): Promise<void>;
  stepInto(threadId: number): Promise<void>;
  stepOut(threadId: number): Promise<void>;
  pause(threadId: number): Promise<void>;
  stackTrace(threadId: number): Promise<StackFrame[]>;
  scopes(frameId: number): Promise<Scope[]>;
  variables(ref: number): Promise<Variable[]>;
  evaluate(expression: string, frameId: number | undefined): Promise<Variable>;
  /** End the session and the program. */
  stop(): Promise<void>;
}

/** Paths on Windows are case-insensitive and may use either slash. */
export function samePath(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const norm = (p: string) => p.replace(/\//g, '\\').toLowerCase();
  return norm(a) === norm(b);
}
