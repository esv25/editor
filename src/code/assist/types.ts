/**
 * Shared types for the code analysis behind «Kodehjelp»: scopes, the names
 * declared in them, every place a name is used, and the problems found.
 * Everything here is plain data (no CodeMirror), so it can be tested in Node.
 */
import type { CodeHelpFeature } from './levels';

export type Severity = 'error' | 'warning' | 'info' | 'hint';

export type ScopeKind = 'module' | 'function' | 'class' | 'block' | 'comprehension';

export interface Scope {
  kind: ScopeKind;
  from: number;
  to: number;
  parent: Scope | null;
  /** Value names declared here. */
  names: Map<string, Binding>;
  /** TypeScript: type names declared here. */
  types: Map<string, Binding>;
  /** Python: names declared `global` / `nonlocal` here. */
  globals: Set<string>;
  nonlocals: Set<string>;
}

export type BindingKind = 'variable' | 'constant' | 'function' | 'class' | 'import' | 'parameter' | 'type';

export interface Def {
  from: number;
  to: number;
  /** Where the name has its value (after the whole assignment, `x = x + 1`). */
  at: number;
}

export interface Binding {
  name: string;
  kind: BindingKind;
  scope: Scope;
  /** Every place that gives the name a value (declarations and assignments), in order. */
  defs: Def[];
  /** How often the value is read. */
  reads: number;
  /** Never reported as unused (exported, `_x`, `self`, class attributes …). */
  keep?: boolean;
  /** JS: `const` or an import – can't get a new value. */
  readonly?: boolean;
  /** JS: let/const/class – can't be used before the declaration. */
  lexical?: boolean;
  /** A function parameter: which function, and its position (unused only after the last used one). */
  param?: { fn: number; index: number };
  /** Imports: the whole statement, and whether this is its only name (then the statement fades). */
  statement?: { from: number; to: number; only: boolean };
  /** Python: the module this import binds (`import math as m` → "math"). */
  module?: string;
}

/**
 * One place a name occurs. `def` gives it a value (declaration or Python
 * assignment), `write` assigns to an existing name (JS), `readwrite` is
 * `x += 1`, and `mention` is neither (`global x`).
 */
export type RefRole = 'def' | 'write' | 'read' | 'readwrite' | 'mention';

export interface Ref {
  from: number;
  to: number;
  name: string;
  role: RefRole;
  scope: Scope;
  binding: Binding | null;
  /** Type position (TypeScript). */
  type?: boolean;
  /** Don't complain if it can't be resolved (`typeof x`, type names). */
  quiet?: boolean;
  /** Loops around the reference inside its function (Python: use before assignment in a loop is fine). */
  loops?: readonly { from: number; to: number }[];
  /** A call (`name(...)`), for nicer messages. */
  call?: boolean;
}

export interface Fix {
  label: string;
  changes: { from: number; to: number; insert: string }[];
}

export interface Issue {
  from: number;
  to: number;
  severity: Severity;
  /** The setting that turns it on. */
  feature: CodeHelpFeature;
  /** Short message, like VS Code. */
  message: string;
  /** Longer explanation for beginners (shown with «Forklaringer»). */
  explanation?: string;
  fixes?: Fix[];
  /** Extra CSS class on the marked text (faded unused/unreachable code). */
  markClass?: string;
  /** Generic syntax error (dropped near more specific messages). */
  generic?: boolean;
  /** A bracket that's never closed: the parser can't make sense of what follows. */
  unclosed?: boolean;
  /** The marked text may be misspelled: suggest the closest of these. */
  candidates?: Iterable<string>;
}

export interface Analysis {
  refs: Ref[];
  bindings: Binding[];
  module: Scope;
  issues: Issue[];
}

export function newScope(kind: ScopeKind, from: number, to: number, parent: Scope | null): Scope {
  return { kind, from, to, parent, names: new Map(), types: new Map(), globals: new Set(), nonlocals: new Set() };
}

/** The innermost function (or module) scope a scope belongs to. */
export function functionScopeOf(scope: Scope): Scope {
  let s = scope;
  while (s.parent && s.kind !== 'function' && s.kind !== 'module') s = s.parent;
  return s;
}
