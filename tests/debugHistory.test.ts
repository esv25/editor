import { describe, expect, it } from 'vitest';
import {
  changedVariables,
  expressionAt,
  findOccurrences,
  isNameChain,
  nextPinColor,
  pinChanged,
  pinValue,
  previousInCall,
  type Snapshot,
} from '../src/debug/history';
import { jsChildExpression } from '../src/debug/node';
import type { StackFrame, Variable } from '../src/debug/types';

const frame = (name: string, line: number, path = 'C:\\x\\prog.py'): StackFrame => ({ id: line, name, path, line, column: 1 });
const vars = (values: Record<string, string>): Variable[] => Object.entries(values).map(([name, value]) => ({ name, value, ref: 0 }));

let nextId = 1;
/** A stop in `frames[0]` (innermost first) with these local variables. */
function snap(frames: StackFrame[], locals: Record<string, string> | null, extra: Partial<Snapshot> = {}): Snapshot {
  return {
    id: nextId++,
    stop: { reason: 'step', threadId: 1 },
    frames,
    frameIndex: 0,
    scopes: locals ? [{ scope: { name: 'Locals', ref: 1 }, variables: vars(locals) }] : [],
    loaded: locals !== null,
    watchResults: [],
    pinResults: [],
    children: new Map(),
    ...extra,
  };
}

const main = (line: number) => [frame('<module>', line)];
const inF = (line: number, callerLine = 9) => [frame('f', line), frame('<module>', callerLine)];

describe('what changed since the stop before', () => {
  it('marks changed and new variables, not unchanged ones', () => {
    const before = snap(main(1), { a: '1', b: '2' });
    const after = snap(main(2), { a: '1', b: '3', c: "'ny'" });
    expect([...changedVariables(before, after)]).toEqual(['Locals/b', 'Locals/c']);
  });

  it('compares with the same function call, skipping stops inside a called function', () => {
    const history = [snap(main(3), { x: '0' }), snap(inF(1), { n: '5' }), snap(inF(2), { n: '5', r: '25' }), snap(main(4), { x: '25' })];
    expect(previousInCall(history, 3)).toBe(history[0]);
    expect(previousInCall(history, 2)).toBe(history[1]);
    expect([...changedVariables(previousInCall(history, 3), history[3])]).toEqual(['Locals/x']);
  });

  it('treats a recursive call as another call', () => {
    const outer = [frame('f', 2), frame('<module>', 9)];
    const inner = [frame('f', 1), frame('f', 2), frame('<module>', 9)];
    const history = [snap(outer, { n: '3' }), snap(inner, { n: '2' })];
    expect(previousInCall(history, 1)).toBeUndefined();
  });

  it('marks nothing when the stop before has no variables (the user stepped on quickly)', () => {
    const history = [snap(main(1), null), snap(main(2), { a: '1' })];
    expect(previousInCall(history, 1)).toBeUndefined();
    expect(changedVariables(undefined, history[1]).size).toBe(0);
  });

  it('only compares scopes fetched both times', () => {
    const before = snap(main(1), { a: '1' });
    const after = snap(main(2), { a: '1' });
    after.scopes.push({ scope: { name: 'Globals', ref: 2 }, variables: vars({ g: '1' }) });
    expect(changedVariables(before, after).size).toBe(0);
  });
});

describe('highlighted variables', () => {
  it('get the first free colour', () => {
    expect(nextPinColor([])).toBe(1);
    expect(nextPinColor([{ expression: 'a', color: 1 }, { expression: 'b', color: 3 }])).toBe(2);
    const all = [1, 2, 3, 4, 5].map((color) => ({ expression: `v${color}`, color }));
    expect(nextPinColor(all)).toBe(1);
  });

  it('are looked up among the variables first, then evaluated', () => {
    const s = snap(main(2), { total: '10' }, { pinResults: [{ expression: 'len(liste)', value: { name: 'len(liste)', value: '3', ref: 0 } }] });
    expect(pinValue(s, 'total')?.value?.value).toBe('10');
    expect(pinValue(s, 'len(liste)')?.value?.value).toBe('3');
    expect(pinValue(s, 'ukjent')).toBeUndefined();
  });

  it('use the innermost scope first', () => {
    const s = snap(inF(1), { x: '1' });
    s.scopes.push({ scope: { name: 'Globals', ref: 2 }, variables: vars({ x: '99', y: '2' }) });
    expect(pinValue(s, 'x')?.value?.value).toBe('1');
    expect(pinValue(s, 'y')?.value?.value).toBe('2');
  });

  it('are marked when they changed or appeared, also for stops from before they were pinned', () => {
    const a = snap(main(1), { i: '0' });
    const b = snap(main(2), { i: '1' });
    const c = snap(main(3), { i: '1', total: '5' });
    expect(pinChanged(a, b, 'i')).toBe(true);
    expect(pinChanged(b, c, 'i')).toBe(false);
    // `total` didn't exist at b – nothing is known about it there, so it doesn't count as changed.
    expect(pinChanged(b, c, 'total')).toBe(false);
    expect(pinChanged(undefined, c, 'i')).toBe(false);
  });

  it('count an expression that started working as changed', () => {
    const a = snap(main(1), {}, { pinResults: [{ expression: 'liste[0]', error: 'IndexError' }] });
    const b = snap(main(2), {}, { pinResults: [{ expression: 'liste[0]', value: { name: 'liste[0]', value: '7', ref: 0 } }] });
    expect(pinChanged(a, b, 'liste[0]')).toBe(true);
  });
});

describe('the variable at the cursor', () => {
  /** "|" marks the cursor. */
  const at = (text: string) => {
    const cursor = text.indexOf('|');
    return expressionAt(text.slice(0, cursor) + text.slice(cursor + 1), cursor);
  };

  it('finds the name around the cursor', () => {
    expect(at('total = tot|al + 1')).toBe('total');
    expect(at('total| = 1')).toBe('total');
    expect(at('|total = 1')).toBe('total');
    expect(at('høy|de = 2')).toBe('høyde');
  });

  it('includes what it is an attribute of', () => {
    expect(at('self.to|tal += 1')).toBe('self.total');
    expect(at('print(punkt.x|)')).toBe('punkt.x');
    expect(at('a.b.c|')).toBe('a.b.c');
  });

  it('finds nothing between names or on numbers', () => {
    expect(at('a = | b')).toBe('');
    expect(at('x = 12|3')).toBe('');
  });
});

describe('where highlighted names occur in the code', () => {
  const found = (text: string, names: string[]) => findOccurrences(text, names).map((o) => text.slice(o.from, o.to));

  it('matches whole names only', () => {
    expect(found('total = totalt + total', ['total'])).toEqual(['total', 'total']);
    expect(found('i = 0\nfor i in liste: print(i)', ['i'])).toEqual(['i', 'i', 'i']);
  });

  it('skips attributes with the same name, but finds attribute chains that are pinned', () => {
    expect(found('total = self.total', ['total'])).toEqual(['total']);
    expect(found('self.total += total', ['self.total'])).toEqual(['self.total']);
    expect(found('x.total.append(1)', ['x.total', 'x'])).toEqual(['x.total']);
  });

  it('handles æøå and $, and ignores expressions that are not names', () => {
    expect(found('høyde = høyde2 + høyde', ['høyde'])).toEqual(['høyde', 'høyde']);
    expect(found('$el = $el + 1', ['$el'])).toEqual(['$el', '$el']);
    expect(found('len(liste)', ['len(liste)'])).toEqual([]);
    expect(isNameChain('len(liste)')).toBe(false);
    expect(isNameChain('punkt.x')).toBe(true);
  });
});

describe('expressions for JavaScript values', () => {
  it('reaches properties the way you would write them', () => {
    expect(jsChildExpression(undefined, 'liste')).toBe('liste');
    expect(jsChildExpression('liste', '0')).toBe('liste[0]');
    expect(jsChildExpression('punkt', 'x')).toBe('punkt.x');
    expect(jsChildExpression('obj', 'a b')).toBe('obj["a b"]');
    expect(jsChildExpression('(a + b)', 'length')).toBe('(a + b).length');
  });
});
