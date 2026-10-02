/**
 * Diagram → SVG tree. Used for both the canvas and the saved file.
 */
import { center, findNode, type Diagram, type DiagramEdge, type Point } from './model';
import { drawingStyle } from './shapes/common';
import { shapeFor } from './shapes';
import { h, type SvgNode } from './svg';

/** Start and end of an arrow: where the line between the centres crosses each outline. */
export function edgeEnds(d: Diagram, edge: DiagramEdge): { a: Point; b: Point } | null {
  const from = findNode(d, edge.from);
  const to = findNode(d, edge.to);
  if (!from || !to) return null;
  return { a: shapeFor(from.shape).boundary(from, center(to)), b: shapeFor(to.shape).boundary(to, center(from)) };
}

/** A line from a to b with an arrow head at b. */
export function arrow(a: Point, b: Point, color: string = drawingStyle.stroke, extra: SvgNode['attrs'] = {}): SvgNode {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const size = 12;
  const spread = Math.PI / 7;
  const p1 = { x: b.x - size * Math.cos(angle - spread), y: b.y - size * Math.sin(angle - spread) };
  const p2 = { x: b.x - size * Math.cos(angle + spread), y: b.y - size * Math.sin(angle + spread) };
  // The line stops at the head's base so its end doesn't poke through the tip.
  const base = { x: b.x - size * 0.8 * Math.cos(angle), y: b.y - size * 0.8 * Math.sin(angle) };
  return h('g', extra, [
    h('line', { x1: a.x, y1: a.y, x2: base.x, y2: base.y, stroke: color, 'stroke-width': drawingStyle.strokeWidth, 'stroke-linecap': 'round' }),
    h('polygon', { points: `${b.x},${b.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`, fill: color, stroke: color, 'stroke-width': 1, 'stroke-linejoin': 'round' }),
  ]);
}

export function renderDiagram(d: Diagram): SvgNode[] {
  const nodes = d.nodes.map((n) => {
    const el = shapeFor(n.shape).render(n);
    return { ...el, attrs: { ...el.attrs, 'data-node': n.id } };
  });
  const edges: SvgNode[] = [];
  for (const edge of d.edges) {
    const ends = edgeEnds(d, edge);
    if (ends) edges.push(arrow(ends.a, ends.b, drawingStyle.stroke, { 'data-edge': edge.id }));
  }
  // Arrows on top, so their heads are never hidden by a figure.
  return [...nodes, ...edges];
}
