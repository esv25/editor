import { describe, expect, it } from 'vitest';
import { decodeHeapPart, decodeJsHeap, heapChanges, heapEntryKey, heapVarKey, JS_HEAP_FUNCTION, mergeHeap, pythonHeapExpression, type HeapGraph } from '../src/debug/heap';
import { arrowPath, heapColumns, layoutHeap, type BoxSize } from '../src/debug/heapLayout';

/** A linked list a → b → c from the main program, and a call that points at b. */
const linked = (): HeapGraph =>
  mergeHeap([
    {
      name: 'Hovedprogram',
      part: decodeHeapPart(
        JSON.stringify({
          v: [['start', { r: '1' }], ['n', { t: '3' }]],
          o: {
            '1': { k: 'object', n: 'Node', e: [['element', { t: '1' }], ['neste', { r: '2' }]], s: 2 },
            '2': { k: 'object', n: 'Node', e: [['element', { t: '2' }], ['neste', { r: '3' }]], s: 2 },
            '3': { k: 'object', n: 'Node', e: [['element', { t: '3' }], ['neste', { t: 'None' }]], s: 2 },
          },
        }),
      ),
    },
    {
      name: 'finn',
      part: decodeHeapPart(JSON.stringify({ v: [['peker', { r: '2' }]], o: {} })),
    },
  ]);

describe('heap graph', () => {
  it('decodes the frames and objects', () => {
    const g = linked();
    expect(g.frames.map((f) => f.name)).toEqual(['Hovedprogram', 'finn']);
    expect(g.frames[1].vars).toEqual([{ name: 'peker', value: { ref: '2' } }]);
    expect(g.objects['1']).toEqual({
      kind: 'object',
      type: 'Node',
      entries: [
        { label: 'element', value: { text: '1' } },
        { label: 'neste', value: { ref: '2' } },
      ],
      size: 2,
    });
    expect(g.stableIds).toBe(true);
  });

  it('turns pointers to objects that were not fetched into "…"', () => {
    const g = mergeHeap([{ name: 'x', part: decodeHeapPart('{"v": [["a", {"r": "9"}]], "o": {}}') }]);
    expect(g.frames[0].vars[0].value).toEqual({ text: '…' });
  });

  it('rejects answers that are not a graph', () => {
    expect(() => decodeHeapPart('"<__main__. object at 0x1>"')).toThrow();
    expect(() => decodeHeapPart('not json')).toThrow();
  });

  it('decodes the JavaScript answer with the call names', () => {
    const json = JSON.stringify({ f: [[['liste', { r: '1' }]], []], o: { '1': { k: 'list', n: 'Array', e: [['0', { t: '1' }]], s: 1 } } });
    const g = decodeJsHeap(json, ['(hovedprogram)', 'f']);
    expect(g.frames.map((f) => f.name)).toEqual(['(hovedprogram)', 'f']);
    expect(g.objects['1'].kind).toBe('list');
    expect(g.stableIds).toBeFalsy();
  });

  it('builds a Python expression that passes the frame in', () => {
    expect(pythonHeapExpression(true)).toContain("'L': locals(), 'G': None");
    expect(pythonHeapExpression(false)).toContain("'G': globals()");
  });

  it('runs the JavaScript function on real values', () => {
    const fn = new Function(`return (${JS_HEAP_FUNCTION})`)() as (...args: unknown[]) => string;
    const a: { v: number; next: unknown } = { v: 1, next: null };
    const b = { v: 2, next: a };
    a.next = b; // a cycle
    const g = decodeJsHeap(fn([['a', 'f', 'tall'], ['m']], a, () => 1, 7, new Map([['k', [1, 2]]])), ['main', 'call']);
    expect(g.frames[0].vars.map((v) => v.name)).toEqual(['a', 'tall']);
    expect(g.frames[0].vars[1].value).toEqual({ text: '7' });
    const objects = Object.values(g.objects);
    expect(objects.map((o) => o.kind).sort()).toEqual(['dict', 'list', 'object', 'object']);
    const ref = g.frames[0].vars[0].value as { ref: string };
    const next = g.objects[ref.ref].entries[1].value as { ref: string };
    expect((g.objects[next.ref].entries[1].value as { ref: string }).ref).toBe(ref.ref);
  });
});

describe('what changed', () => {
  it('marks changed entries, new objects and changed variables', () => {
    const before = linked();
    const after = linked();
    after.objects['3'].entries[0] = { label: 'element', value: { text: '30' } };
    after.objects['4'] = { kind: 'object', type: 'Node', entries: [], size: 0 };
    after.frames[1].vars[0] = { name: 'peker', value: { ref: '3' } };
    const changed = heapChanges(before, after);
    expect([...changed].sort()).toEqual([heapVarKey(1, 'peker'), heapEntryKey('3', 'element'), heapEntryKey('4')].sort());
  });

  it('compares only values drawn in place when ids are not stable', () => {
    const before: HeapGraph = { frames: [{ name: 'f', vars: [{ name: 'a', value: { ref: '1' } }, { name: 'n', value: { text: '1' } }] }], objects: {} };
    const after: HeapGraph = { frames: [{ name: 'f', vars: [{ name: 'a', value: { ref: '2' } }, { name: 'n', value: { text: '2' } }] }], objects: {} };
    expect([...heapChanges(before, after)]).toEqual([heapVarKey(0, 'n')]);
  });
});

describe('heap layout', () => {
  it('puts each object one column right of what first points to it', () => {
    const columns = heapColumns(linked());
    expect(Object.fromEntries(columns)).toEqual({ f0: 0, f1: 0, o1: 1, o2: 2, o3: 3 });
  });

  it('places a linked list in a row, level with its pointers', () => {
    const g = linked();
    const box = (dots: number): BoxSize => ({ w: 100, h: 60, dots: Array.from({ length: dots }, (_, i) => ({ x: 90, y: 30 + i * 20 })) });
    const sizes = new Map<string, BoxSize>([
      ['f0', box(2)],
      ['f1', box(1)],
      ['o1', box(2)],
      ['o2', box(2)],
      ['o3', box(2)],
    ]);
    const layout = layoutHeap(g, sizes);
    const r = (k: string) => layout.boxes.get(k)!;
    expect(r('o1').x).toBeGreaterThan(r('f0').x + 100);
    expect(r('o2').x).toBeGreaterThan(r('o1').x + 100);
    // The first node level with the variable pointing to it, and the chain straight across.
    expect(r('o1').y).toBe(r('f0').y + 30 - 14);
    expect(r('o2').y).toBe(r('o1').y);
    expect(r('o3').y).toBe(r('o1').y);
    // b is the main program's (through a.neste), so finn's pointer to it is drawn as shared.
    expect(layout.arrows.find((a) => a.from === 'f1')?.shared).toBe(true);
    expect(layout.arrows.filter((a) => a.shared)).toHaveLength(1);
    // The second call stands under the first.
    expect(r('f1').y).toBeGreaterThanOrEqual(r('f0').y + 60);
    // start → o1, neste → o2, neste → o3, peker → o2.
    expect(layout.arrows.map((a) => `${a.from}>${a.to}`).sort()).toEqual(['f0>o1', 'f1>o2', 'o1>o2', 'o2>o3']);
    expect(layout.width).toBeGreaterThan(r('o3').x + 100);
  });

  it('gives each subtree its own band, so arrows never cross', () => {
    // rot → (venstre: a → (a1, a2), hoyre: b)
    const node = (kids: [string, string | null][]) => ({
      kind: 'object' as const,
      type: 'Tre',
      entries: kids.map(([label, ref]) => ({ label, value: ref ? { ref } : { text: 'None' } })),
      size: kids.length,
    });
    const g: HeapGraph = {
      frames: [{ name: 'main', vars: [{ name: 'rot', value: { ref: 'r' } }] }],
      objects: {
        r: node([['venstre', 'a'], ['hoyre', 'b']]),
        a: node([['venstre', 'a1'], ['hoyre', 'a2']]),
        b: node([]),
        a1: node([]),
        a2: node([]),
      },
    };
    const two = { w: 100, h: 60, dots: [{ x: 90, y: 30 }, { x: 90, y: 50 }] };
    const none = { w: 100, h: 30, dots: [] };
    const sizes = new Map<string, BoxSize>([
      ['f0', { w: 100, h: 40, dots: [{ x: 90, y: 30 }] }],
      ['or', two],
      ['oa', two],
      ['ob', none],
      ['oa1', none],
      ['oa2', none],
    ]);
    const layout = layoutHeap(g, sizes);
    const r = (k: string) => layout.boxes.get(k)!;
    expect(r('oa').y).toBe(r('or').y);
    expect(r('oa1').y).toBe(r('oa').y);
    expect(r('oa2').y).toBeGreaterThanOrEqual(r('oa1').y + 30);
    // The right subtree starts below everything in the left one.
    expect(r('ob').y).toBeGreaterThanOrEqual(Math.max(r('oa').y + 60, r('oa2').y + 30));
    expect(layout.arrows.every((a) => !a.shared)).toBe(true);
  });

  it('draws arrows straight across to the right, round onto the top otherwise', () => {
    expect(arrowPath({ x: 10, y: 50 }, { x: 100, y: 30, w: 80, h: 60 })).toMatch(/^M10,50 C.* 100,50$/);
    const back = arrowPath({ x: 200, y: 50 }, { x: 20, y: 100, w: 80, h: 60 });
    expect(back).toMatch(/ 44,100$/);
  });
});
