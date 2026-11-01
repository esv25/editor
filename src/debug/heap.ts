/**
 * The program's data structures as a graph, for drawing them with pointers
 * (like Python Tutor): the variables of each function call, and the objects
 * they reach – lists, dicts, sets, tuples and the program's own objects – by
 * identity, so shared objects and cycles show as they are.
 *
 * Each backend runs a small program inside the debugged one (Python: `exec`
 * in the frame, Node: a function called with the variables) that returns the
 * graph as JSON. Pure logic, tested in tests/heap.test.ts.
 */

/** A value: a pointer to an object, or text for everything drawn in place (numbers, strings, None …). */
export type HeapValue = { ref: string } | { text: string };

export interface HeapEntry {
  /** Index, field name or key (none for sets). */
  label?: string;
  value: HeapValue;
}

export type HeapKind = 'object' | 'list' | 'tuple' | 'dict' | 'set';

export interface HeapObject {
  kind: HeapKind;
  /** Class name ("Node", "list", "Map"). */
  type: string;
  entries: HeapEntry[];
  /** How many there are in all (more than `entries` when cut short). */
  size: number;
}

export interface HeapFrame {
  name: string;
  vars: { name: string; value: HeapValue }[];
}

export interface HeapGraph {
  /** Outermost call first (the main program), the one stopped in last. */
  frames: HeapFrame[];
  objects: Record<string, HeapObject>;
  /** The same object has the same id at every stop (Python's `id`; not so in JavaScript). */
  stableIds?: boolean;
}

/** Objects fetched at most (the rest show as "…"), and entries per object. */
export const MAX_OBJECTS = 150;
export const MAX_ENTRIES = 40;

const KINDS = new Set<string>(['object', 'list', 'tuple', 'dict', 'set']);

/** What the program inside the debuggee returns (compact JSON). */
type RawValue = { r: string } | { t: string };
type RawVars = [string, RawValue][];
type RawObjects = Record<string, { k: string; n: string; e: [string | null, RawValue][]; s: number }>;

function decodeValue(raw: unknown): HeapValue {
  const v = raw as RawValue;
  if (v && typeof v === 'object' && 'r' in v && typeof v.r === 'string') return { ref: v.r };
  if (v && typeof v === 'object' && 't' in v) return { text: String(v.t) };
  return { text: '?' };
}

function decodeVars(raw: unknown): HeapFrame['vars'] {
  if (!Array.isArray(raw)) throw new Error('Ukjent svar');
  return (raw as RawVars).filter((x) => Array.isArray(x) && typeof x[0] === 'string').map(([name, value]) => ({ name, value: decodeValue(value) }));
}

function decodeObjects(raw: unknown): Record<string, HeapObject> {
  if (!raw || typeof raw !== 'object') throw new Error('Ukjent svar');
  const objects: Record<string, HeapObject> = {};
  for (const [id, o] of Object.entries(raw as RawObjects)) {
    if (!o || typeof o !== 'object') continue;
    const entries = (Array.isArray(o.e) ? o.e : []).map(([label, value]) => ({
      ...(label === null || label === undefined ? {} : { label: String(label) }),
      value: decodeValue(value),
    }));
    objects[id] = {
      kind: KINDS.has(o.k) ? (o.k as HeapKind) : 'object',
      type: String(o.n ?? ''),
      entries,
      size: typeof o.s === 'number' ? o.s : entries.length,
    };
  }
  return objects;
}

/** Pointers to objects that weren't fetched (over the limit) become "…". */
function finish(graph: HeapGraph): HeapGraph {
  const fix = (v: HeapValue): HeapValue => ('ref' in v && !graph.objects[v.ref] ? { text: '…' } : v);
  for (const o of Object.values(graph.objects)) for (const e of o.entries) e.value = fix(e.value);
  for (const f of graph.frames) for (const v of f.vars) v.value = fix(v.value);
  return graph;
}

/** One Python frame's answer: its variables and the objects they reach. Throws on anything else. */
export function decodeHeapPart(json: string): HeapPart {
  const raw = JSON.parse(json);
  return { vars: decodeVars(raw?.v), objects: decodeObjects(raw?.o) };
}

export interface HeapPart {
  vars: HeapFrame['vars'];
  objects: Record<string, HeapObject>;
}

/** Put the frames' parts together (objects are shared: same id = same object). */
export function mergeHeap(parts: { name: string; part: HeapPart }[]): HeapGraph {
  const objects: Record<string, HeapObject> = {};
  for (const { part } of parts) Object.assign(objects, part.objects);
  return finish({ frames: parts.map(({ name, part }) => ({ name, vars: part.vars })), objects, stableIds: true });
}

/** The answer from `JS_HEAP_FUNCTION`, with the frames' names in the same order. */
export function decodeJsHeap(json: string, names: string[]): HeapGraph {
  const raw = JSON.parse(json);
  if (!Array.isArray(raw?.f)) throw new Error('Ukjent svar');
  const frames = names.map((name, i) => ({ name, vars: decodeVars(raw.f[i] ?? []) }));
  return finish({ frames, objects: decodeObjects(raw.o) });
}

// ---------- What changed ----------

/** Key of a variable in a call ("Hovedprogram" is call 0) – for `heapChanges`. */
export const heapVarKey = (frame: number, name: string) => `f${frame}\n${name}`;
/** Key of an object, or of one of its entries. */
export const heapEntryKey = (id: string, label?: string) => (label === undefined ? `o${id}` : `o${id}\n${label}`);

const same = (a: HeapValue | undefined, b: HeapValue) =>
  !!a && ('ref' in a ? 'ref' in b && a.ref === b.ref : 'text' in b && a.text === b.text);

/**
 * What is new or different since `before`: variables, objects and entries (by
 * the keys above). Objects are compared only when ids are stable; otherwise just
 * variables with values drawn in place.
 */
export function heapChanges(before: HeapGraph, after: HeapGraph): Set<string> {
  const changed = new Set<string>();
  after.frames.forEach((frame, i) => {
    const old = before.frames[i]?.name === frame.name ? before.frames[i] : undefined;
    if (!old) return;
    for (const v of frame.vars) {
      const was = old.vars.find((x) => x.name === v.name)?.value;
      if (after.stableIds ? !same(was, v.value) : 'text' in v.value && !same(was, v.value)) changed.add(heapVarKey(i, v.name));
    }
  });
  if (!after.stableIds || !before.stableIds) return changed;
  for (const [id, o] of Object.entries(after.objects)) {
    const old = before.objects[id];
    if (!old || old.type !== o.type) {
      changed.add(heapEntryKey(id));
      continue;
    }
    o.entries.forEach((e, i) => {
      const label = e.label ?? String(i);
      const was = e.label === undefined ? old.entries[i]?.value : old.entries.find((x) => x.label === e.label)?.value;
      if (!same(was, e.value)) changed.add(heapEntryKey(id, label));
    });
  }
  return changed;
}

// ---------- Python ----------

/**
 * Runs in the frame with `L` = its variables. With `G` (not the main program),
 * names that are just the globals are left out: debugpy evaluates with both.
 */
const PYTHON_HEAP = `
import types as T
from itertools import islice
import json
P = (int, float, complex, str, bytes, bool, type(None))
SKIP = (type, T.ModuleType, T.FunctionType, T.BuiltinFunctionType, T.MethodType)
FUNCS = (T.FunctionType, T.BuiltinFunctionType, T.MethodType)
objs = {}
queue = []
def short(r):
    return r if len(r) <= 60 else r[:57] + '…'
def text(v):
    try:
        return short(repr(v))
    except Exception:
        return '?'
def slots(v):
    s = getattr(type(v), '__slots__', ())
    return (s,) if isinstance(s, str) else tuple(s)
def isobj(v):
    return isinstance(v, (list, tuple, dict, set, frozenset)) or ((hasattr(v, '__dict__') or bool(slots(v))) and not isinstance(v, SKIP))
def val(v):
    if isinstance(v, P) or not isobj(v):
        if isinstance(v, FUNCS):
            return {'t': 'ƒ ' + getattr(v, '__name__', '')}
        if isinstance(v, type):
            return {'t': 'class ' + v.__name__}
        return {'t': text(v)}
    i = str(id(v))
    if i not in objs:
        if len(objs) >= MAX:
            return {'t': '…'}
        objs[i] = None
        queue.append(v)
    return {'r': i}
def fields(v):
    if hasattr(v, '__dict__'):
        return list(vars(v).items())
    return [(s, getattr(v, s)) for s in slots(v) if hasattr(v, s)]
def walk(v):
    if isinstance(v, dict):
        kind, items, size = 'dict', [(text(k), x) for k, x in islice(v.items(), ITEMS)], len(v)
    elif isinstance(v, (list, tuple)):
        kind, items, size = 'list' if isinstance(v, list) else 'tuple', list(enumerate(islice(v, ITEMS))), len(v)
    elif isinstance(v, (set, frozenset)):
        kind, items, size = 'set', [(None, x) for x in islice(v, ITEMS)], len(v)
    else:
        f = fields(v)
        kind, items, size = 'object', f[:ITEMS], len(f)
    return {'k': kind, 'n': type(v).__name__, 'e': [[None if k is None else str(k), val(x)] for k, x in items], 's': size}
found = [[k, val(x)] for k, x in list(L.items())
         if not k.startswith('__') and not isinstance(x, SKIP) and not (G is not None and k in G and G[k] is x)]
while queue:
    v = queue.pop(0)
    objs[str(id(v))] = walk(v)
J = json.dumps({'v': found, 'o': objs}, ensure_ascii=False)
out = type('', (), {'__repr__': lambda s: J})()
`;

/**
 * A Python expression that gives the frame's part of the graph as JSON. The
 * program runs with `exec` in its own namespace (so it leaves nothing behind);
 * the result is an object whose repr is the JSON, since the debugger shows the
 * repr of what an expression gives.
 */
export function pythonHeapExpression(mainProgram: boolean): string {
  // A JSON string is also a valid Python string literal.
  const globals = mainProgram ? 'None' : 'globals()';
  return `(lambda g: (exec(${JSON.stringify(PYTHON_HEAP)}, g), g['out'])[1])({'L': locals(), 'G': ${globals}, 'MAX': ${MAX_OBJECTS}, 'ITEMS': ${MAX_ENTRIES}})`;
}

// ---------- JavaScript ----------

/**
 * Called in the program (Runtime.callFunctionOn) with the frames' variable
 * names and then their values; returns the whole graph as JSON. Own data
 * properties only, so no getters run.
 */
export const JS_HEAP_FUNCTION = `function (frames, ...values) {
  const MAX = ${MAX_OBJECTS}, ITEMS = ${MAX_ENTRIES};
  const ids = new Map(), objs = {}, queue = [];
  const short = (s) => (s.length > 60 ? s.slice(0, 57) + '\\u2026' : s);
  const text = (v) => {
    switch (typeof v) {
      case 'string': return short(JSON.stringify(v));
      case 'function': return /^class\\b/.test(Function.prototype.toString.call(v)) ? 'class ' + v.name : '\\u0192 ' + v.name;
      case 'bigint': return v + 'n';
      case 'symbol': return v.toString();
      default: return String(v);
    }
  };
  const special = (v) => v instanceof Date || v instanceof RegExp || v instanceof Error || v instanceof Promise || ArrayBuffer.isView(v) || v instanceof WeakMap || v instanceof WeakSet;
  const val = (v) => {
    if (v === null || typeof v !== 'object') return { t: text(v) };
    if (special(v)) { try { return { t: short(String(v)) }; } catch { return { t: '?' }; } }
    let id = ids.get(v);
    if (id === undefined) {
      if (ids.size >= MAX) return { t: '\\u2026' };
      id = String(ids.size + 1);
      ids.set(v, id);
      queue.push(v);
    }
    return { r: id };
  };
  const own = (v) => {
    const out = [];
    for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(v))) if (d.enumerable && 'value' in d) out.push([k, d.value]);
    return out;
  };
  const walk = (v) => {
    let k, items, size;
    if (Array.isArray(v)) { k = 'list'; size = v.length; items = []; for (let i = 0; i < Math.min(size, ITEMS); i++) items.push([String(i), v[i]]); }
    else if (v instanceof Map) { k = 'dict'; size = v.size; items = [...v].slice(0, ITEMS).map(([key, x]) => [typeof key === 'object' && key ? '{\\u2026}' : text(key), x]); }
    else if (v instanceof Set) { k = 'set'; size = v.size; items = [...v].slice(0, ITEMS).map((x) => [null, x]); }
    else { k = 'object'; const f = own(v); size = f.length; items = f.slice(0, ITEMS); }
    const proto = Object.getPrototypeOf(v);
    const n = Array.isArray(v) ? 'Array' : proto === null ? 'Object' : (proto.constructor && proto.constructor.name) || 'Object';
    return { k, n, e: items.map(([key, x]) => [key, val(x)]), s: size };
  };
  let at = 0;
  const parts = frames.map((names) => {
    const v = [];
    for (const name of names) {
      const x = values[at++];
      if (typeof x !== 'function') v.push([name, val(x)]);
    }
    return v;
  });
  while (queue.length) { const v = queue.shift(); objs[ids.get(v)] = walk(v); }
  return JSON.stringify({ f: parts, o: objs });
}`;
