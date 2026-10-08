import { describe, expect, it } from 'vitest';
import { alignMove, alignResize, guidesFor } from '../src/diagram/align';
import { settleAnchors } from '../src/diagram/attach';
import { exportSvg, isDiagramPath, parseDiagramSvg } from '../src/diagram/fileFormat';
import { History } from '../src/diagram/history';
import {
  addNeighbor,
  addNode,
  connect,
  emptyDiagram,
  nodeAt,
  normalizeDiagram,
  edgesBetween,
  moveNodes,
  nodesInRect,
  removeNodes,
  reverseEdge,
  snap,
  updateEdge,
  updateNode,
  type Diagram,
} from '../src/diagram/model';
import { edgePresets, renderEdge } from '../src/diagram/edges';
import { edgePoints, fontSizes } from '../src/diagram/render';
import { cornerPath, offsetPolyline, routeBetween, trim } from '../src/diagram/routing';
import { shapeFor } from '../src/diagram/shapes';
import { setUnderline, styledLine, textUnderline } from '../src/diagram/shapes/common';
import { absolutePoints, curveData, pathNodeFrom } from '../src/diagram/shapes/path';
import { classSections } from '../src/diagram/shapes/umlClass';
import { toSvgString } from '../src/diagram/svg';
import { markTool, selectTool } from '../src/diagram/tools/select';
import type { Selection, ToolContext } from '../src/diagram/tools/types';

const box = (x: number, y: number, text = '') => ({ shape: 'box', x, y, w: 160, h: 80, text });

function twoBoxes(): Diagram {
  let d = addNode(emptyDiagram(), box(0, 0, 'A')).diagram;
  d = addNode(d, box(300, 0, 'B')).diagram;
  return connect(d, 'n1', 'n2').diagram;
}

describe('diagram model', () => {
  it('gives fresh ids', () => {
    const d = twoBoxes();
    expect(d.nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(d.edges).toEqual([{ id: 'e1', from: 'n1', to: 'n2', head: 'arrow', tail: 'none', dashed: false }]);
    expect(addNode(removeNodes(d, ['n1']), box(0, 0)).id).toBe('n3');
  });

  it('refuses self-arrows and duplicates', () => {
    const d = twoBoxes();
    expect(connect(d, 'n1', 'n1').id).toBeNull();
    expect(connect(d, 'n1', 'n2')).toEqual({ diagram: d, id: 'e1' });
  });

  it('removes arrows with their nodes', () => {
    expect(removeNodes(twoBoxes(), ['n2']).edges).toEqual([]);
  });

  it('finds nodes generously', () => {
    const d = twoBoxes();
    expect(nodeAt(d, { x: 10, y: 10 }, 0)?.id).toBe('n1');
    expect(nodeAt(d, { x: 170, y: 40 }, 16)?.id).toBe('n1');
    expect(nodeAt(d, { x: 230, y: 40 }, 16)).toBeNull();
    expect(nodeAt(d, { x: 290, y: 40 }, 16)?.id).toBe('n2');
  });

  it('adds a connected neighbour, skipping occupied space', () => {
    const d = twoBoxes();
    const down = addNeighbor(d, 'n1', 'down', 20)!;
    expect(down.diagram.nodes.find((n) => n.id === down.id)).toMatchObject({ x: 0, y: 140, w: 160, h: 80 });
    expect(down.diagram.edges.at(-1)).toMatchObject({ from: 'n1', to: down.id });
    // Steps of 220 to the right: x 220 and 440 overlap n2 (300–460), so it lands at 660.
    const right = addNeighbor(d, 'n1', 'right', 20)!;
    expect(right.diagram.nodes.find((n) => n.id === right.id)!.x).toBe(660);
  });

  it('snaps to the grid', () => {
    expect(snap(29, 20)).toBe(20);
    expect(snap(31, 20)).toBe(40);
  });

  it('accepts only sensible data from files', () => {
    expect(normalizeDiagram({ nodes: 'x' })).toBeNull();
    const d = normalizeDiagram({ nodes: [{ id: 'n1', x: 'a' }], edges: [{ id: 'e1', from: 'n1', to: 'n9' }] })!;
    expect(d.nodes[0]).toEqual({ id: 'n1', shape: 'box', x: 0, y: 0, w: 160, h: 80, text: '' });
    expect(d.edges).toEqual([]);
  });
});

describe('geometry', () => {
  it('ends arrows on the outlines', () => {
    const d = twoBoxes();
    expect(edgePoints(d, d.edges[0])).toEqual([{ x: 160, y: 40 }, { x: 300, y: 40 }]);
  });

  it('knows each shape’s outline', () => {
    const node = { id: 'n', shape: '', x: 0, y: 0, w: 200, h: 100, text: '' };
    expect(shapeFor('ellipse').boundary(node, { x: 100, y: -500 })).toEqual({ x: 100, y: 0 });
    expect(shapeFor('diamond').boundary(node, { x: 500, y: 50 })).toEqual({ x: 200, y: 50 });
    const corner = shapeFor('diamond').boundary(node, { x: 200, y: 100 });
    expect(corner.x).toBeCloseTo(150);
    expect(corner.y).toBeCloseTo(75);
  });
});

describe('corners', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 60 };

  it('go sideways first, up/down first, or not at all', () => {
    expect(cornerPath(a, b, undefined)).toEqual([a, b]);
    expect(cornerPath(a, b, 'hv')).toEqual([a, { x: 100, y: 0 }, b]);
    expect(cornerPath(a, b, 'vh')).toEqual([a, { x: 0, y: 60 }, b]);
    // Already straight: no corner.
    expect(cornerPath(a, { x: 100, y: 0 }, 'vh')).toEqual([a, { x: 100, y: 0 }]);
  });

  it('go a little straight out of a figure first', () => {
    const right = { x: 1, y: 0 };
    // Out of a right side, then up/down as chosen, then across.
    expect(cornerPath(a, b, 'vh', right)).toEqual([a, { x: 20, y: 0 }, { x: 20, y: 60 }, b]);
    // Into a left side: arrives from the left, 20 before the end.
    expect(cornerPath(a, b, 'vh', right, { x: -1, y: 0 })).toEqual([a, { x: 20, y: 0 }, { x: 20, y: 60 }, b]);
    expect(cornerPath(a, b, 'hv', right, { x: -1, y: 0 })).toEqual([a, { x: 80, y: 0 }, { x: 80, y: 60 }, b]);
    // A figure's top-right corner, up/down first: up out of the figure, across, down – not back through it.
    expect(cornerPath(a, b, 'vh', { x: 1, y: -1 })).toEqual([a, { x: 0, y: -20 }, { x: 100, y: -20 }, b]);
    // Never doubles back: out to the right, end to the left – turns right after the short piece.
    expect(cornerPath(a, { x: -100, y: 60 }, 'hv', right)).toEqual([a, { x: 20, y: 0 }, { x: 20, y: 60 }, { x: -100, y: 60 }]);
    // Free ends (not on a figure): no extra piece.
    expect(cornerPath(a, b, 'vh')).toEqual([a, { x: 0, y: 60 }, b]);
  });

  it('take lines between figures round a corner, or across the gap', () => {
    const at = (x: number, y: number) => ({ x, y, w: 100, h: 60 });
    // Diagonally apart: one corner, outside both figures.
    expect(routeBetween(at(0, 0), at(300, 200), 'hv')).toEqual([{ x: 50, y: 30 }, { x: 350, y: 30 }, { x: 350, y: 230 }]);
    expect(routeBetween(at(0, 0), at(300, 200), 'vh')).toEqual([{ x: 50, y: 30 }, { x: 50, y: 230 }, { x: 350, y: 230 }]);
    // Side by side but not level: out, a turn halfway across the gap, in.
    expect(routeBetween(at(0, 0), at(300, 40), 'vh')).toEqual([
      { x: 50, y: 30 },
      { x: 200, y: 30 },
      { x: 200, y: 70 },
      { x: 350, y: 70 },
    ]);
    // One above the other.
    expect(routeBetween(at(0, 0), at(20, 200), 'hv')).toEqual([
      { x: 50, y: 30 },
      { x: 50, y: 130 },
      { x: 70, y: 130 },
      { x: 70, y: 230 },
    ]);
    // Level: straight across.
    expect(routeBetween(at(0, 0), at(300, 0), 'hv')).toEqual([{ x: 50, y: 30 }, { x: 350, y: 30 }]);
  });

  it('end on the outlines of the figures', () => {
    let d = addNode(addNode(emptyDiagram(), box(0, 0)).diagram, box(300, 200)).diagram;
    d = updateEdge(connect(d, 'n1', 'n2').diagram, 'e1', { route: 'hv' });
    expect(edgePoints(d, d.edges[0])).toEqual([{ x: 160, y: 40 }, { x: 380, y: 40 }, { x: 380, y: 200 }]);
    expect(reverseEdge(d, 'e1').edges[0].route).toBe('hv');
    expect(normalizeDiagram(JSON.parse(JSON.stringify(d)))!.edges[0].route).toBe('hv');
    expect(normalizeDiagram({ nodes: d.nodes, edges: [{ ...d.edges[0], route: 'diagonal' }] })!.edges[0].route).toBeUndefined();
  });

  it('are drawn with the arrow head along the last piece', () => {
    const svg = toSvgString(renderEdge({ head: 'arrow', tail: 'none' }, [a, { x: 100, y: 0 }, b]));
    expect(svg).toContain('<polyline');
    // Arrow pointing straight down at (100, 60), line stopping 10 above it.
    expect(svg).toContain('points="100,60 105.5,48 94.5,48"');
    expect(svg).toContain('points="0,0 100,0 100,50"');
  });

  it('keep double lines apart round the corner', () => {
    const line = [a, { x: 100, y: 0 }, b];
    expect(offsetPolyline(line, 2.5)).toEqual([{ x: 0, y: 2.5 }, { x: 97.5, y: 2.5 }, { x: 97.5, y: 60 }]);
    expect(trim(line, 10, 10)).toEqual([{ x: 10, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }]);
    expect(trim(line, 100, 70)).toBeNull();
  });

  it('turn a Strek round a corner', () => {
    const node = { id: 'n', ...pathNodeFrom([a, b], false), smooth: false, route: 'vh' as const };
    const svg = toSvgString(shapeFor('path').render(node));
    expect(svg).toContain('d="M0,0 L0,60 L100,60"');
    expect(shapeFor('path').distance!(node, { x: 0, y: 30 })).toBe(0);
    expect(shapeFor('path').distance!(node, { x: 50, y: 30 })).toBe(30);
  });
});

describe('file format', () => {
  it('round-trips through SVG, special characters included', () => {
    let d = twoBoxes();
    d = { ...d, nodes: d.nodes.map((n) => (n.id === 'n1' ? { ...n, text: 'a < b & "c"\nny linje]]>' } : n)) };
    const svg = exportSvg(d);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('<metadata id="editor-diagram">');
    expect(svg).toContain('a &lt; b &amp; &quot;c&quot;');
    expect(parseDiagramSvg(svg)).toEqual(d);
  });

  it('fits the picture to the drawing', () => {
    const svg = exportSvg(twoBoxes());
    expect(svg).toContain('width="500" height="120" viewBox="-20 -20 500 120"');
  });

  it('marks an empty drawing', () => {
    const svg = exportSvg(emptyDiagram());
    expect(svg).toContain('Tom tegning');
    expect(parseDiagramSvg(svg)).toEqual(emptyDiagram());
  });

  it('rejects SVGs it didn’t make', () => {
    expect(parseDiagramSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toBeNull();
    expect(isDiagramPath('C:\\a\\Tegning.Diagram.svg')).toBe(true);
    expect(isDiagramPath('bilde.svg')).toBe(false);
  });
});

describe('history', () => {
  it('undoes and redoes', () => {
    const h = new History();
    const a = emptyDiagram();
    const b = twoBoxes();
    h.record(a);
    expect(h.undo(b)).toBe(a);
    expect(h.redo(a)).toBe(b);
    expect(h.redo(b)).toBeNull();
  });
});

describe('lines', () => {
  it('get the chosen type and texts', () => {
    const inherit = edgePresets.find((p) => p.id === 'inherit')!.style;
    let d = addNode(addNode(emptyDiagram(), box(0, 0)).diagram, box(300, 0)).diagram;
    d = connect(d, 'n1', 'n2', inherit).diagram;
    expect(d.edges[0]).toMatchObject({ head: 'triangle', tail: 'none', dashed: false });
    d = updateEdge(d, 'e1', { fromLabel: '1', toLabel: '0..*' });
    expect(d.edges[0]).toMatchObject({ fromLabel: '1', toLabel: '0..*' });
  });

  it('turn around with their ends and texts', () => {
    let d = addNode(addNode(emptyDiagram(), box(0, 0)).diagram, box(300, 0)).diagram;
    d = connect(d, 'n1', 'n2', { head: 'none', tail: 'filledDiamond', dashed: false }).diagram;
    d = updateEdge(d, 'e1', { fromLabel: '1', toLabel: 'N' });
    expect(reverseEdge(d, 'e1').edges[0]).toMatchObject({ from: 'n2', to: 'n1', head: 'filledDiamond', tail: 'none', fromLabel: 'N', toLabel: '1' });
  });

  it('draw their end marks', () => {
    const svg = (style: Parameters<typeof renderEdge>[0]) => toSvgString(renderEdge(style, [{ x: 0, y: 0 }, { x: 100, y: 0 }]));
    expect(svg({ head: 'triangle', tail: 'none', dashed: true })).toContain('stroke-dasharray="8 6"');
    expect(svg({ head: 'triangle', tail: 'none', dashed: true })).toContain('fill="#ffffff"');
    expect(svg({ head: 'none', tail: 'none', dashed: false })).not.toContain('polygon');
    // A filled diamond at the start: the line begins where the diamond ends.
    expect(svg({ head: 'none', tail: 'filledDiamond', dashed: false })).toContain('x1="22"');
    expect(svg({ label: 'eier', fromLabel: '1' })).toContain('>eier</tspan>');
  });

  it('can be double: two lines beside each other, kept when turned around', () => {
    const svg = toSvgString(renderEdge({ head: 'none', tail: 'none', double: true }, [{ x: 0, y: 0 }, { x: 100, y: 0 }]));
    expect(svg.match(/<line /g)).toHaveLength(2);
    expect(svg).toContain('y1="-2.5"');
    expect(svg).toContain('y1="2.5"');
    let d = addNode(addNode(emptyDiagram(), box(0, 0)).diagram, box(300, 0)).diagram;
    d = updateEdge(connect(d, 'n1', 'n2').diagram, 'e1', { double: true });
    expect(reverseEdge(d, 'e1').edges[0].double).toBe(true);
  });

  it('are read back from files, bad values dropped', () => {
    const d = normalizeDiagram({
      nodes: [{ id: 'n1' }, { id: 'n2', double: true, dashed: 'yes' }],
      edges: [
        { id: 'e1', from: 'n1', to: 'n2', head: 'triangle', tail: 'bogus', label: '', toLabel: 'N' },
        { id: 'e2', from: 'n2', to: 'n1', double: true },
        { id: 'e3', from: 'n2', to: 'n1', double: 'yes' },
      ],
    })!;
    expect(d.nodes[1]).toEqual({ id: 'n2', shape: 'box', x: 0, y: 0, w: 160, h: 80, text: '', double: true });
    expect(d.edges[0]).toEqual({ id: 'e1', from: 'n1', to: 'n2', head: 'triangle', toLabel: 'N' });
    expect(d.edges[1]).toEqual({ id: 'e2', from: 'n2', to: 'n1', double: true });
    expect(d.edges[2]).toEqual({ id: 'e3', from: 'n2', to: 'n1' });
  });
});

describe('text markup', () => {
  it('underlines and italicises whole lines', () => {
    expect(styledLine('_personnr_')).toEqual({ text: 'personnr', underline: 'solid', italic: false });
    expect(styledLine('__løpenr__')).toEqual({ text: 'løpenr', underline: 'dashed', italic: false });
    expect(styledLine('*Figur*')).toEqual({ text: 'Figur', italic: true });
    expect(styledLine('_*begge*_')).toEqual({ text: 'begge', underline: 'solid', italic: true });
    expect(styledLine('*__begge__*')).toEqual({ text: 'begge', underline: 'dashed', italic: true });
    expect(styledLine('a_b_c')).toEqual({ text: 'a_b_c', italic: false });
    expect(styledLine('__')).toEqual({ text: '__', italic: false });
  });

  it('switches the underline of every line', () => {
    expect(setUnderline('navn', 'solid')).toBe('_navn_');
    expect(setUnderline('_navn_\n\n*nr*', 'dashed')).toBe('__navn__\n\n__*nr*__');
    expect(setUnderline('__navn__', null)).toBe('navn');
    expect(textUnderline('_a_\n_b_')).toBe('solid');
    expect(textUnderline('_a_\n__b__')).toBeNull();
    expect(textUnderline('a')).toBeNull();
  });

  it('draws underlines as lines under the text, dashed or not', () => {
    const svg = (text: string) => toSvgString(shapeFor('ellipse').render({ id: 'n1', ...box(0, 0, text), shape: 'ellipse' }));
    expect(svg('id')).not.toContain('<line');
    expect(svg('_id_')).toContain('<line');
    expect(svg('_id_')).not.toContain('stroke-dasharray');
    expect(svg('__nr__')).toContain('stroke-dasharray="4 3"');
    expect(svg('__nr__')).toContain('>nr</tspan>');
  });
});

describe('text size', () => {
  const sizesOf = (...nodes: { shape: string; text: string; w?: number }[]) => {
    let d = emptyDiagram();
    for (const n of nodes) d = addNode(d, { ...box(0, 0, n.text), shape: n.shape, w: n.w ?? 160 }).diagram;
    return d.nodes.map((n) => fontSizes(d).get(n.id));
  };

  it('grows where the figure has room, up to a limit', () => {
    expect(sizesOf({ shape: 'box', text: 'Navn' })).toEqual([32]);
    expect(sizesOf({ shape: 'box', text: 'En ganske lang tekst her med mer' })).toEqual([16]);
    expect(sizesOf({ shape: 'class', text: 'Person' })).toEqual([undefined]);
  });

  it('is the same for figures of the same type and size', () => {
    const [a, b, c] = sizesOf({ shape: 'ellipse', text: 'Navn' }, { shape: 'ellipse', text: 'Personnummer' }, { shape: 'ellipse', text: 'Navn', w: 240 });
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(16);
    expect(a).toBeLessThan(32);
    expect(c).toBe(32);
  });

  it('draws the text at that size', () => {
    const node = { id: 'n1', ...box(0, 0, '_id_') };
    expect(toSvgString(shapeFor('box').render(node, 24))).toContain('font-size="24"');
    expect(toSvgString(shapeFor('box').render(node))).toContain('font-size="16"');
  });
});

describe('UML class', () => {
  it('splits the text into compartments at "--"', () => {
    expect(classSections('Person\n--\n- navn: String\n- alder: int\n--\n+ hils()')).toEqual([
      ['Person'],
      ['- navn: String', '- alder: int'],
      ['+ hils()'],
    ]);
    expect(classSections('Person')).toEqual([['Person'], [], []]);
    expect(classSections('«interface»\nForm\n---\n\n+ areal(): double\n')).toEqual([
      ['«interface»', 'Form'],
      ['+ areal(): double'],
      [],
    ]);
  });

  it('grows to fit its compartments', () => {
    const measure = (line: string) => line.length * 8;
    const size = shapeFor('class').fit!('Person\n--\n- navn: String\n--\n+ hils()', measure);
    // Three compartments of one line: 3 × (20.8 + 12).
    expect(size.h).toBeCloseTo(98.4);
    expect(size.w).toBe('- navn: String'.length * 8 + 20);
  });
});

describe('freehand', () => {
  const clicked = [
    { x: 100, y: 100 },
    { x: 200, y: 140 },
    { x: 300, y: 100 },
  ];

  it('stores points relative to its box, so it can move and resize', () => {
    const node = { id: 'n1', ...pathNodeFrom(clicked, false) };
    expect(node).toMatchObject({ shape: 'path', x: 100, y: 100, w: 200, h: 40 });
    expect(absolutePoints(node)).toEqual(clicked);
    expect(absolutePoints({ ...node, x: 0, w: 400 })[1]).toEqual({ x: 200, y: 140 });
  });

  it('draws a smooth curve or straight lines', () => {
    expect(curveData(clicked, false, false)).toBe('M100,100 L200,140 L300,100');
    expect(curveData(clicked, true, true)).toMatch(/^M100,100 C.* Z$/);
  });

  it('is hit near the line, not anywhere in its box', () => {
    const open = { id: 'n1', ...pathNodeFrom(clicked, false) };
    const shape = shapeFor('path');
    expect(shape.distance!(open, { x: 200, y: 132 })).toBeLessThan(10);
    expect(shape.distance!(open, { x: 200, y: 100 })).toBeGreaterThan(20);
    const closed = { ...open, closed: true };
    expect(shape.distance!(closed, { x: 200, y: 110 })).toBe(0);
  });
});

describe('straight line', () => {
  it('is a two-point freehand figure, also when level', () => {
    const node = { id: 'n1', ...pathNodeFrom([{ x: 0, y: 100 }, { x: 200, y: 100 }], false) };
    expect(node).toMatchObject({ x: 0, y: 100, w: 200, h: 1 });
    expect(absolutePoints(node)).toEqual([{ x: 0, y: 100 }, { x: 200, y: 100 }]);
    expect(shapeFor('path').distance!(node, { x: 100, y: 108 })).toBe(8);
  });
});

describe('snap points and line ends', () => {
  const node = { id: 'n1', shape: 'box', x: 0, y: 0, w: 160, h: 80, text: '' };

  it('offers corners and side middles of a box', async () => {
    const { rectAnchors } = await import('../src/diagram/shapes/common');
    expect(rectAnchors(node)).toContainEqual({ x: 160, y: 80 });
    expect(rectAnchors(node)).toContainEqual({ x: 80, y: 0 });
    expect(rectAnchors(node)).toHaveLength(8);
    expect(shapeFor('diamond').anchors!(node)).toContainEqual({ x: 160, y: 40 });
  });

  it('lets a line end where another starts', () => {
    const line = { id: 'n2', ...pathNodeFrom([{ x: 0, y: 0 }, { x: 100, y: 50 }], false) };
    expect(shapeFor('path').anchors!(line)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 50 }]);
  });

  it('draws arrow heads on open lines only', () => {
    const line = { id: 'n2', ...pathNodeFrom([{ x: 0, y: 0 }, { x: 100, y: 0 }], false), head: 'arrow' as const };
    expect(toSvgString(shapeFor('path').render(line))).toContain('polygon');
    expect(toSvgString(shapeFor('path').render({ ...line, closed: true }))).not.toContain('polygon');
  });

  it('draws a double line as a wide stroke with a paper-coloured middle', () => {
    const line = { id: 'n2', ...pathNodeFrom([{ x: 0, y: 0 }, { x: 100, y: 0 }], false), double: true };
    const svg = toSvgString(shapeFor('path').render(line));
    expect(svg).toContain('stroke-width="7"');
    expect(svg).toContain('stroke="#fbfaf7" stroke-width="3"');
  });
});

describe('Velg tool', () => {
  const context = (diagram: Diagram) => {
    const panned: [number, number][] = [];
    let selection: ToolContext['selection'] = [];
    const commits: Diagram[] = [];
    const ctx: ToolContext = {
      get diagram() {
        return commits.at(-1) ?? diagram;
      },
      get selection() {
        return selection;
      },
      grid: 20,
      tolerance: 10,
      dragThreshold: 6,
      alignTolerance: 10,
      handleSize: 14,
      commit: (next) => commits.push(next),
      select: (s) => (selection = s === null ? [] : Array.isArray(s) ? s : [s as Selection]),
      editText: () => {},
      setTool: () => {},
      nodeAt: (p) => nodeAt(commits.at(-1) ?? diagram, p, 10),
      snapPoint: (p) => ({ point: p, anchored: false }),
      edgeAt: () => null,
      refresh: () => {},
      panBy: (dx, dy) => panned.push([dx, dy]),
    };
    return { ctx, panned, commits };
  };

  it('moves the view when dragging empty space, but not on a shaky click', () => {
    const { ctx, panned } = context(twoBoxes());
    selectTool.pointerDown(ctx, { x: 1000, y: 1000 });
    selectTool.pointerMove!(ctx, { x: 1003, y: 1000 });
    expect(panned).toEqual([]);
    selectTool.pointerMove!(ctx, { x: 1050, y: 980 });
    // The point that was grabbed stays under the pointer.
    expect(panned).toEqual([[-50, 20]]);
    expect(selectTool.busy!()).toBe(false);
    selectTool.pointerUp!(ctx, { x: 1050, y: 980 });
  });

  it('counts dragging a figure as busy (the view scrolls at the edge)', () => {
    const { ctx, panned } = context(twoBoxes());
    selectTool.pointerDown(ctx, { x: 50, y: 50 });
    selectTool.pointerMove!(ctx, { x: 90, y: 50 });
    expect(selectTool.busy!()).toBe(true);
    expect(panned).toEqual([]);
    selectTool.pointerUp!(ctx, { x: 90, y: 50 });
    expect(selectTool.busy!()).toBe(false);
  });

  const ids = (sel: readonly Selection[]) => sel.map((s) => `${s.kind}:${s.id}`);

  it('Shift+click adds and takes away; a drag moves every selected figure together', () => {
    const { ctx, commits } = context(twoBoxes());
    selectTool.pointerDown(ctx, { x: 50, y: 50 });
    selectTool.pointerUp!(ctx, { x: 50, y: 50 });
    selectTool.pointerDown(ctx, { x: 450, y: 50 }, { add: true });
    selectTool.pointerUp!(ctx, { x: 450, y: 50 });
    expect(ids(ctx.selection)).toEqual(['node:n1', 'node:n2']);

    // Plain drag on one of them moves both by the same (grid-snapped) amount.
    selectTool.pointerDown(ctx, { x: 50, y: 50 });
    selectTool.pointerMove!(ctx, { x: 90, y: 110 });
    selectTool.pointerUp!(ctx, { x: 90, y: 110 });
    expect(commits.at(-1)!.nodes.map((n) => [n.x, n.y])).toEqual([[40, 60], [340, 60]]);
    expect(ctx.selection).toHaveLength(2);

    // A plain click (no drag) on one of the group picks just that one.
    selectTool.pointerDown(ctx, { x: 470, y: 90 });
    selectTool.pointerUp!(ctx, { x: 470, y: 90 });
    expect(ids(ctx.selection)).toEqual(['node:n2']);
  });

  it('Marker: clicks toggle without keys, and dragging empty space marks an area', () => {
    const { ctx, panned } = context(twoBoxes());
    markTool.pointerDown(ctx, { x: 50, y: 50 });
    markTool.pointerUp!(ctx, { x: 50, y: 50 });
    markTool.pointerDown(ctx, { x: 450, y: 50 });
    markTool.pointerUp!(ctx, { x: 450, y: 50 });
    expect(ids(ctx.selection)).toEqual(['node:n1', 'node:n2']);
    markTool.pointerDown(ctx, { x: 50, y: 50 });
    markTool.pointerUp!(ctx, { x: 50, y: 50 });
    expect(ids(ctx.selection)).toEqual(['node:n2']);

    ctx.select(null);
    markTool.pointerDown(ctx, { x: -20, y: -20 });
    markTool.pointerMove!(ctx, { x: 500, y: 30 });
    expect(markTool.busy!()).toBe(true);
    markTool.pointerUp!(ctx, { x: 500, y: 30 });
    expect(panned).toEqual([]);
    // Both figures and the line between them.
    expect(ids(ctx.selection)).toEqual(['node:n1', 'node:n2', 'edge:e1']);
  });

  it('Esc while marking an area puts the old selection back', () => {
    const { ctx } = context(twoBoxes());
    ctx.select({ kind: 'node', id: 'n2' });
    selectTool.pointerDown(ctx, { x: -20, y: -20 }, { add: true });
    selectTool.pointerMove!(ctx, { x: 30, y: 30 });
    expect(ids(ctx.selection)).toEqual(['node:n2', 'node:n1']);
    expect(selectTool.cancel!(ctx)).toBe(true);
    expect(ids(ctx.selection)).toEqual(['node:n2']);
  });
});

describe('several figures', () => {
  it('moves, finds in a rectangle and finds the lines between', () => {
    const d = twoBoxes();
    const moved = moveNodes(d, ['n1', 'n2'], 20, -40);
    expect(moved.nodes.map((n) => [n.x, n.y])).toEqual([[20, -40], [320, -40]]);
    expect(moveNodes(d, ['n1'], 0, 0)).toBe(d);
    expect(nodesInRect(d, { x: 200, y: 100 }, { x: 150, y: 70 }).map((n) => n.id)).toEqual(['n1']);
    expect(nodesInRect(d, { x: 170, y: 0 }, { x: 290, y: 80 })).toEqual([]);
    expect(edgesBetween(d, ['n1']).length).toBe(0);
    expect(edgesBetween(d, ['n1', 'n2']).map((e) => e.id)).toEqual(['e1']);
  });
});

describe('lining up', () => {
  // A at (0,0) 160×80; an ellipse of 120×60 dragged near A's middle line.
  const d = addNode(emptyDiagram(), box(0, 0, 'A')).diagram;
  const options = { grid: 20, tolerance: 10 };

  it('puts the middle on another figure’s middle when close, else on the grid', () => {
    expect(alignMove(d, { x: 300, y: 13, w: 120, h: 60 }, options)).toEqual({ x: 300, y: 10 });
    // Far from any line of A: just the grid.
    expect(alignMove(d, { x: 300, y: 147, w: 120, h: 60 }, options)).toEqual({ x: 300, y: 140 });
    // Tolerance 0: only exact matches, otherwise the grid.
    expect(alignMove(d, { x: 300, y: 13, w: 120, h: 60 }, { ...options, tolerance: 0 })).toEqual({ x: 300, y: 20 });
  });

  it('lines up edges when resizing', () => {
    const d2 = addNode(d, box(300, 200)).diagram;
    // B's bottom edge dragged near A's middle (y = 40) – but that's above B, so the minimum wins.
    expect(alignResize(d2, d2.nodes[1], { x: 465, y: 283 }, { ...options, min: 40 })).toEqual({ w: 160, h: 80 });
    expect(alignResize(d2, d2.nodes[1], { x: 453, y: 291 }, { ...options, min: 40 })).toEqual({ w: 160, h: 100 });
  });

  it('shows guides through the figures that line up', () => {
    const guides = guidesFor(d, { x: 300, y: 10, w: 120, h: 60 });
    expect(guides).toEqual([{ x1: 0, y1: 40, x2: 420, y2: 40 }]);
    expect(guidesFor(d, { x: 300, y: 300, w: 120, h: 60 })).toEqual([]);
  });

  it('ignores open lines and the figure itself', () => {
    const withLine = addNode(d, { ...pathNodeFrom([{ x: 0, y: 47 }, { x: 100, y: 47 }], false) }).diagram;
    expect(alignMove(withLine, { x: 300, y: 31, w: 120, h: 30 }, options)).toEqual({ x: 300, y: 25 });
    expect(guidesFor(d, d.nodes[0], d.nodes[0].id)).toEqual([]);
  });
});

describe('fastened line ends', () => {
  // Box A at (0,0) 160×80 and box B at (300,0); a line from A's right middle to B's left middle.
  const start = (): Diagram => {
    let d = addNode(emptyDiagram(), box(0, 0, 'A')).diagram;
    d = addNode(d, box(300, 0, 'B')).diagram;
    const line = addNode(d, { ...pathNodeFrom([{ x: 160, y: 40 }, { x: 300, y: 40 }], false), head: 'arrow' }).diagram;
    return settleAnchors(d, line);
  };
  const ends = (d: Diagram) => absolutePoints(d.nodes[2]);

  it('fasten to the points they were drawn on', () => {
    const d = start();
    expect(d.nodes[2].startAt).toEqual({ node: 'n1', anchor: 4, out: { x: 1, y: 0 } });
    expect(d.nodes[2].endAt).toEqual({ node: 'n2', anchor: 3, out: { x: -1, y: 0 } });
  });

  it('follow the figure when it moves or grows', () => {
    let d = start();
    d = settleAnchors(d, updateNode(d, 'n2', { x: 400, y: 100 }));
    expect(ends(d)).toEqual([{ x: 160, y: 40 }, { x: 400, y: 140 }]);
    d = settleAnchors(d, updateNode(d, 'n1', { h: 120 }));
    expect(ends(d)).toEqual([{ x: 160, y: 60 }, { x: 400, y: 140 }]);
    expect(d.nodes[2].head).toBe('arrow');
  });

  it('come loose when the line itself is moved, and fasten where they land', () => {
    let d = start();
    const line = d.nodes[2];
    d = settleAnchors(d, updateNode(d, line.id, { y: line.y + 100 }));
    expect(d.nodes[2].startAt).toBeUndefined();
    expect(d.nodes[2].endAt).toBeUndefined();
    d = settleAnchors(d, updateNode(d, 'n1', { x: -100 }));
    expect(ends(d)).toEqual([{ x: 160, y: 140 }, { x: 300, y: 140 }]);
    // Back onto A's bottom-right corner.
    d = settleAnchors(d, updateNode(d, line.id, { x: 60, y: 80 }));
    expect(d.nodes[2].startAt).toEqual({ node: 'n1', anchor: 7, out: { x: 1, y: 1 } });
  });

  it('stay where they are when the figure is deleted', () => {
    const d = removeNodes(start(), ['n2']);
    expect(d.nodes[1].startAt).toEqual({ node: 'n1', anchor: 4, out: { x: 1, y: 0 } });
    expect(d.nodes[1].endAt).toBeUndefined();
    expect(absolutePoints(d.nodes[1])).toEqual([{ x: 160, y: 40 }, { x: 300, y: 40 }]);
  });

  it('chain: a line fastened to another line’s end follows it too', () => {
    let d = start();
    const second = addNode(d, pathNodeFrom([{ x: 300, y: 40 }, { x: 300, y: 200 }], false)).diagram;
    d = settleAnchors(d, second);
    // Fastened to box B (figures win over the line ending at the same point).
    expect(d.nodes[3].startAt).toEqual({ node: 'n2', anchor: 3, out: { x: -1, y: 0 } });
    d = settleAnchors(d, updateNode(d, 'n2', { y: 40 }));
    expect(absolutePoints(d.nodes[3])[0]).toEqual({ x: 300, y: 80 });
    expect(ends(d)[1]).toEqual({ x: 300, y: 80 });
  });

  it('fasten to the end or the corner of a line with a corner', () => {
    // A free line from (500,0) to (600,100), sideways first: its corner is at (600,0).
    let d = addNode(emptyDiagram(), { ...pathNodeFrom([{ x: 500, y: 0 }, { x: 600, y: 100 }], false), route: 'hv' }).diagram;
    d = settleAnchors(d, addNode(d, pathNodeFrom([{ x: 600, y: 100 }, { x: 700, y: 100 }], false)).diagram);
    d = settleAnchors(d, addNode(d, pathNodeFrom([{ x: 600, y: 0 }, { x: 700, y: 0 }], false)).diagram);
    // The ends keep their numbers; the corner comes after them.
    expect(d.nodes[1].startAt).toEqual({ node: 'n1', anchor: 1 });
    expect(d.nodes[2].startAt).toEqual({ node: 'n1', anchor: 2 });
    d = settleAnchors(d, updateNode(d, 'n1', { x: 520 }));
    expect(absolutePoints(d.nodes[1])[0]).toEqual({ x: 620, y: 100 });
    expect(absolutePoints(d.nodes[2])[0]).toEqual({ x: 620, y: 0 });
  });

  it('with corners, go straight out of the figure before turning', () => {
    // From A's right middle (160,40) to B's left middle, B moved down: out of A, across, into B.
    let d = start();
    d = settleAnchors(d, updateNode(d, 'n3', { route: 'vh' }));
    d = settleAnchors(d, updateNode(d, 'n2', { y: 100 }));
    const line = shapeFor('path').anchors!(d.nodes[2]);
    expect(toSvgString(shapeFor('path').render(d.nodes[2]))).toContain('d="M160,40 L180,40 L180,140 L300,140"');
    expect(line.slice(0, 2)).toEqual([{ x: 160, y: 40 }, { x: 300, y: 140 }]);
    d = settleAnchors(d, updateNode(d, 'n3', { route: 'hv' }));
    expect(toSvgString(shapeFor('path').render(d.nodes[2]))).toContain('d="M160,40 L280,40 L280,140 L300,140"');
  });

  it('are kept in files, dangling ones dropped', () => {
    const d = start();
    expect(parseDiagramSvg(exportSvg(d))!.nodes[2]).toMatchObject({ startAt: { node: 'n1', anchor: 4, out: { x: 1, y: 0 } }, endAt: { node: 'n2', anchor: 3, out: { x: -1, y: 0 } } });
    const bad = { ...d, nodes: d.nodes.map((n, i) => (i === 2 ? { ...n, startAt: { node: 'zz', anchor: 1 }, endAt: { node: 'n2', anchor: -1 } } : n)) };
    expect(normalizeDiagram(bad)!.nodes[2]).not.toHaveProperty('startAt');
    expect(normalizeDiagram(bad)!.nodes[2]).not.toHaveProperty('endAt');
  });
});
