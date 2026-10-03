/**
 * Looking back while debugging, and highlighted ("pinned") variables.
 *
 * Neither debugpy nor Node's inspector can run a program backwards, so every
 * stop is kept as a snapshot – the line, the call stack and the variables as
 * they were – and stepping back shows an earlier one (like Thonny, or Visual
 * Studio's IntelliTrace). The program itself stays where it is.
 *
 * Pure logic, tested without a debugger (tests/debugHistory.test.ts).
 */
import type { Scope, StackFrame, StopInfo, Variable } from './types';

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

/** What the debug view shows for one stop: filled in while paused there, then kept as it was. */
export interface Snapshot {
  /** Counts stops in a session. */
  id: number;
  stop: StopInfo;
  frames: StackFrame[];
  frameIndex: number;
  scopes: ScopeState[];
  /** The variables were fetched (they aren't if the user steps on before they arrive). */
  loaded: boolean;
  watchResults: WatchResult[];
  /** Highlighted expressions, evaluated at this stop. */
  pinResults: WatchResult[];
  /** Children of variables opened at this stop, by handle. */
  children: Map<number, Variable[]>;
}

/** Stops kept for stepping back. */
export const MAX_HISTORY = 1000;

/** The function call a snapshot shows: same function, same file, same depth in the stack. */
function callKey(s: Snapshot): string | null {
  const f = s.frames[s.frameIndex];
  return f ? `${f.name}\n${f.path ?? ''}\n${s.frames.length - s.frameIndex}` : null;
}

/**
 * The latest earlier stop in the same function call as `history[index]`, to
 * compare with. After stepping out of a function, that's the stop before the call.
 */
export function previousInCall(history: Snapshot[], index: number): Snapshot | undefined {
  const key = history[index] && callKey(history[index]);
  if (!key) return undefined;
  for (let i = index - 1; i >= 0 && i >= index - 200; i--) {
    if (callKey(history[i]) === key) return history[i].loaded ? history[i] : undefined;
  }
  return undefined;
}

/** Key for a top-level variable: "<scope name>/<variable name>". */
export const variableKey = (scope: string, name: string) => `${scope}/${name}`;

/** Variables that changed (or appeared) since `before`, as `variableKey`s. */
export function changedVariables(before: Snapshot | undefined, after: Snapshot): Set<string> {
  const changed = new Set<string>();
  if (!before || !after.loaded) return changed;
  const old = new Map<string, string>();
  for (const { scope, variables } of before.scopes) {
    for (const v of variables ?? []) old.set(variableKey(scope.name, v.name), v.value);
  }
  for (const { scope, variables } of after.scopes) {
    // Only scopes fetched both times (e.g. Node's globals are only fetched when opened).
    if (!variables || !before.scopes.some((s) => s.scope.name === scope.name && s.variables)) continue;
    for (const v of variables) {
      const key = variableKey(scope.name, v.name);
      if (old.get(key) !== v.value) changed.add(key);
    }
  }
  return changed;
}

// ---------- Highlighted variables ----------

export interface Pin {
  /** A variable name or an expression ("self.total", "liste[0]", "len(liste)"). */
  expression: string;
  /** 1–PIN_COLORS; kept while it's highlighted. */
  color: number;
}

export const PIN_COLORS = 5;

/** Colour for a new pin: the first one not in use. */
export function nextPinColor(pins: Pin[]): number {
  for (let c = 1; c <= PIN_COLORS; c++) if (!pins.some((p) => p.color === c)) return c;
  return (pins.length % PIN_COLORS) + 1;
}

/** A top-level variable by name, innermost scope first (as the language looks names up). */
export function findVariable(scopes: ScopeState[], name: string): Variable | undefined {
  for (const { variables } of scopes) {
    const v = variables?.find((x) => x.name === name);
    if (v) return v;
  }
  return undefined;
}

/**
 * A pin's value at a stop: the variable, if it is one (so this also works for
 * stops from before it was pinned), else the evaluated expression.
 * undefined = not known at that stop.
 */
export function pinValue(snapshot: Snapshot, expression: string): WatchResult | undefined {
  const variable = findVariable(snapshot.scopes, expression);
  if (variable) return { expression, value: variable };
  return snapshot.pinResults.find((r) => r.expression === expression);
}

/** Whether a pin's value changed (or it appeared) since `before`. */
export function pinChanged(before: Snapshot | undefined, after: Snapshot, expression: string): boolean {
  const now = pinValue(after, expression);
  if (!before || !now?.value) return false;
  const then = pinValue(before, expression);
  return !!then && then.value?.value !== now.value.value;
}

const ID_CHAR = /[\p{L}\p{N}_$]/u;
const isIdChar = (ch: string | undefined) => !!ch && ID_CHAR.test(ch);

/** A variable name (also with æøå), possibly with attributes ("self.total"), which can be found in the code. */
export const isNameChain = (text: string) => /^[\p{L}_$][\p{L}\p{N}_$]*(\.[\p{L}_$][\p{L}\p{N}_$]*)*$/u.test(text);

export interface Occurrence {
  from: number;
  to: number;
  name: string;
}

/**
 * Where the names occur in a piece of code, as whole names: "total" isn't
 * found in "totalt" or in "self.total" (that's another variable).
 */
export function findOccurrences(text: string, names: string[]): Occurrence[] {
  const wanted = names.filter(isNameChain).sort((a, b) => b.length - a.length);
  if (!wanted.length) return [];
  const alternatives = wanted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(?<![\\p{L}\\p{N}_$.])(?:${alternatives})(?![\\p{L}\\p{N}_$])`, 'gu');
  return [...text.matchAll(re)].map((m) => ({ from: m.index, to: m.index + m[0].length, name: m[0] }));
}

/**
 * The variable at a position in a line of code, with what it's an attribute of
 * ("self.total", "punkt.x"); '' if there's none.
 */
export function expressionAt(line: string, offset: number): string {
  let start = offset;
  let end = offset;
  while (isIdChar(line[start - 1])) start--;
  while (isIdChar(line[end])) end++;
  if (start === end) return '';
  while (line[start - 1] === '.' && isIdChar(line[start - 2])) {
    start--;
    while (isIdChar(line[start - 1])) start--;
  }
  const expression = line.slice(start, end);
  return /^\p{N}/u.test(expression) ? '' : expression;
}
