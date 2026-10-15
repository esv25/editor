import { describe, expect, it } from 'vitest';
import {
  addNode,
  boardText,
  boardTitleText,
  boardToMarkdown,
  connect,
  edgeGeometry,
  facingSide,
  moveNodes,
  newId,
  overlaps,
  parseBoard,
  placeNextTo,
  readingOrder,
  removeNodes,
  reverseEdge,
  serializeBoard,
  updateNode,
  type Board,
  type BoardNode,
} from '../src/board/model';
import { kindForName } from '../src/code/languages';
import { History } from '../src/diagram/history';

const card = (id: string, x: number, y: number, text = id, extra: Partial<BoardNode> = {}): BoardNode => ({
  id,
  type: 'text',
  x,
  y,
  width: 200,
  height: 60,
  text,
  ...extra,
});
const group = (id: string, x: number, y: number, width: number, height: number, label?: string): BoardNode => ({
  id,
  type: 'group',
  x,
  y,
  width,
  height,
  ...(label ? { label } : {}),
});
const board = (nodes: BoardNode[], edges: Board['edges'] = []): Board => ({ nodes, edges });

describe('board file (JSON Canvas)', () => {
  it('reads an empty file as an empty board', () => {
    expect(parseBoard('')).toEqual({ nodes: [], edges: [] });
    expect(parseBoard('  \n')).toEqual({ nodes: [], edges: [] });
  });

  it('refuses text that is not a board', () => {
    expect(() => parseBoard('# Notat')).toThrow();
    expect(() => parseBoard('[1, 2]')).toThrow();
    expect(() => parseBoard('{"nodes": 5}')).toThrow();
  });

  it('keeps fields and node types it does not know', () => {
    const text = JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', x: 1, y: 2, width: 100, height: 50, text: 'Hei', color: '3', styleAttributes: { shape: 'pill' } },
        { id: 'w', type: 'widget', x: 0, y: 0, width: 10, height: 10, thing: true },
      ],
      edges: [{ id: 'e', fromNode: 'a', toNode: 'w', fromSide: 'right', toSide: 'middle', label: 'x' }],
      metadata: { version: '1.0' },
    });
    const b = parseBoard(text);
    expect(b.nodes[0].styleAttributes).toEqual({ shape: 'pill' });
    expect(b.nodes[1]).toMatchObject({ type: 'widget', thing: true });
    expect(b.edges[0].fromSide).toBe('right');
    expect(b.edges[0].toSide).toBeUndefined(); // not a side
    const again = JSON.parse(serializeBoard(b));
    expect(again.metadata).toEqual({ version: '1.0' });
    expect(again.nodes[0].color).toBe('3');
  });

  it('fills in missing ids and sizes, and drops broken edges', () => {
    const b = parseBoard('{"nodes":[{"type":"text","x":5,"y":5},{"id":"a","x":0,"y":0},{"id":"a","x":1,"y":1}],"edges":[{"fromNode":"a"}]}');
    expect(b.nodes).toHaveLength(3);
    expect(new Set(b.nodes.map((n) => n.id)).size).toBe(3);
    expect(b.nodes[0].width).toBeGreaterThan(0);
    expect(b.edges).toHaveLength(0);
  });

  it('writes tab-indented JSON with whole-pixel positions', () => {
    const text = serializeBoard(board([card('a', 10.4, 20.6)]));
    expect(text).toContain('\n\t"nodes"');
    expect(JSON.parse(text).nodes[0]).toMatchObject({ x: 10, y: 21 });
    expect(parseBoard(text).nodes[0].text).toBe('a');
  });

  it('makes ids like Obsidian', () => {
    expect(newId()).toMatch(/^[0-9a-f]{16}$/);
    expect(newId()).not.toBe(newId());
  });

  it('opens .canvas files as boards', () => {
    expect(kindForName('Tavle.canvas')).toBe('board');
    expect(kindForName('notat.md')).toBe('markdown');
  });
});

describe('changing a board', () => {
  it('puts areas behind cards', () => {
    const b = addNode(board([card('a', 0, 0)]), group('g', -20, -20, 300, 200));
    expect(b.nodes.map((n) => n.id)).toEqual(['g', 'a']);
  });

  it('moves what is inside an area along with it', () => {
    const b = board([group('g', 0, 0, 400, 300), card('in', 20, 20), card('out', 500, 0)]);
    const moved = moveNodes(b, ['g'], 40, 20);
    expect(moved.nodes.find((n) => n.id === 'in')).toMatchObject({ x: 60, y: 40 });
    expect(moved.nodes.find((n) => n.id === 'out')).toMatchObject({ x: 500, y: 0 });
  });

  it('removes the arrows of deleted cards', () => {
    const b = board([card('a', 0, 0), card('b', 300, 0), card('c', 600, 0)], [
      { id: 'e1', fromNode: 'a', toNode: 'b' },
      { id: 'e2', fromNode: 'b', toNode: 'c' },
    ]);
    expect(removeNodes(b, ['a']).edges.map((e) => e.id)).toEqual(['e2']);
  });

  it('connects once, and never a card to itself', () => {
    const b = board([card('a', 0, 0), card('b', 300, 0)]);
    const first = connect(b, 'a', 'b', 'e')!;
    expect(first.board.edges).toHaveLength(1);
    const second = connect(first.board, 'a', 'b')!;
    expect(second.board).toBe(first.board);
    expect(second.edge).toBe('e');
    expect(connect(b, 'a', 'a')).toBeNull();
    expect(connect(b, 'a', 'missing')).toBeNull();
  });

  it('turns an arrow around with its sides', () => {
    const b = board([card('a', 0, 0), card('b', 300, 0)], [{ id: 'e', fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left' }]);
    const e = reverseEdge(b, 'e').edges[0];
    expect(e).toMatchObject({ fromNode: 'b', toNode: 'a', fromSide: 'left', toSide: 'right' });
    // Still the default ends: the arrowhead is now at «a».
    expect(e.fromEnd).toBeUndefined();
    expect(e.toEnd).toBeUndefined();
  });

  it('drops a colour that is taken off', () => {
    const b = updateNode(board([card('a', 0, 0, 'a', { color: '2' })]), 'a', { color: undefined });
    expect('color' in b.nodes[0]).toBe(false);
    expect(JSON.parse(serializeBoard(b)).nodes[0].color).toBeUndefined();
  });

  it('places a new card next to one without covering another', () => {
    const b = board([card('a', 0, 0), card('taken', 260, 0)]);
    const r = placeNextTo(b, b.nodes[0], 'right');
    expect(r.x).toBeGreaterThan(200);
    expect(b.nodes.some((n) => overlaps(r, n))).toBe(false);
    const below = placeNextTo(b, b.nodes[0], 'down');
    expect(below.y).toBeGreaterThan(60);
  });

  it('lets arrows leave from the sides that face each other', () => {
    const a = { x: 0, y: 0, width: 200, height: 60 };
    expect(facingSide(a, { x: 400, y: 10, width: 200, height: 60 })).toBe('right');
    expect(facingSide(a, { x: 10, y: 300, width: 200, height: 60 })).toBe('bottom');
    expect(facingSide(a, { x: -400, y: 0, width: 200, height: 60 })).toBe('left');
    const g = edgeGeometry(a, { x: 400, y: 0, width: 200, height: 60 });
    expect(g.from).toEqual({ x: 200, y: 30 });
    expect(g.to).toEqual({ x: 400, y: 30 });
    expect(g.d.startsWith('M 200 30 C')).toBe(true);
  });

  it('undoes and redoes with snapshots, and forgets a change that came to nothing', () => {
    const h = new History<Board>();
    const b0 = board([]);
    const b1 = addNode(b0, card('a', 0, 0));
    h.record(b0);
    expect(h.undo(b1)).toBe(b0);
    expect(h.redo(b0)).toBe(b1);
    h.record(b1);
    h.forget(b1);
    expect(h.canUndo).toBe(true); // b0 is still there
    h.forget(b0);
    expect(h.canUndo).toBe(false);
  });
});

describe('reading a board in order', () => {
  it('goes top to bottom, left to right', () => {
    const b = board([card('c', 0, 200), card('b', 300, 0), card('a', 0, 5)]);
    expect(readingOrder(b).map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('follows the arrows first, keeping a chain together', () => {
    const b = board([card('start', 0, 0), card('other', 300, 0), card('next', 600, 400), card('last', 0, 600)], [
      { id: 'e1', fromNode: 'start', toNode: 'next' },
      { id: 'e2', fromNode: 'next', toNode: 'last' },
    ]);
    expect(readingOrder(b).map((n) => n.id)).toEqual(['start', 'next', 'last', 'other']);
  });

  it('reads an arrow pointing backwards the way it points', () => {
    const b = board([card('a', 0, 0), card('b', 300, 0)], [{ id: 'e', fromNode: 'a', toNode: 'b', fromEnd: 'arrow', toEnd: 'none' }]);
    expect(readingOrder(b).map((n) => n.id)).toEqual(['b', 'a']);
  });

  it('survives arrows in a circle', () => {
    const b = board([card('a', 0, 0), card('b', 300, 0)], [
      { id: 'e1', fromNode: 'a', toNode: 'b' },
      { id: 'e2', fromNode: 'b', toNode: 'a' },
    ]);
    expect(readingOrder(b).map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('turns a board into a document: areas become headings', () => {
    const b = board(
      [
        group('g2', 0, 400, 500, 300, 'Eksempler'),
        group('g1', 0, 0, 500, 300, 'Definisjon'),
        card('def', 20, 20, 'En funksjon gir én verdi for hver $x$'),
        card('ex', 20, 420, '- $f(x) = 2x + 1$'),
        card('loose', 700, 0, 'Spørsmål: hva med sirkler?'),
        card('empty', 700, 300, '  '),
      ],
      [{ id: 'e', fromNode: 'def', toNode: 'ex', label: 'for eksempel' }],
    );
    expect(boardToMarkdown(b)).toBe(
      'Spørsmål: hva med sirkler?\n\n## Definisjon\n\nEn funksjon gir én verdi for hver $x$\n\n## Eksempler\n\n*for eksempel:*\n\n- $f(x) = 2x + 1$\n',
    );
  });

  it('names a board after its first card and counts its words', () => {
    const b = board([card('b', 300, 0, 'Andre'), card('a', 0, 0, '# Tavle om funksjoner')], [{ id: 'e', fromNode: 'a', toNode: 'b', label: 'så' }]);
    expect(boardTitleText(b)).toBe('# Tavle om funksjoner');
    expect(boardText(b)).toContain('så');
    expect(boardTitleText(board([]))).toBe('');
  });
});
