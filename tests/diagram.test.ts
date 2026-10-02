import { describe, expect, it } from 'vitest';
import { exportSvg, isDiagramPath, parseDiagramSvg } from '../src/diagram/fileFormat';
import { History } from '../src/diagram/history';
import {
  addNeighbor,
  addNode,
  connect,
  emptyDiagram,
  nodeAt,
  normalizeDiagram,
  removeNodes,
  snap,
  type Diagram,
} from '../src/diagram/model';
import { edgeEnds } from '../src/diagram/render';
import { shapeFor } from '../src/diagram/shapes';

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
    expect(d.edges).toEqual([{ id: 'e1', from: 'n1', to: 'n2' }]);
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
    expect(edgeEnds(d, d.edges[0])).toEqual({ a: { x: 160, y: 40 }, b: { x: 300, y: 40 } });
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
