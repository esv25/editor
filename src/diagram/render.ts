/**
 * Diagram → SVG tree. Used for both the canvas and the saved file.
 */
import { renderEdge } from './edges';
import { center, findNode, type Diagram, type DiagramEdge, type DiagramNode, type Point } from './model';
import { drawingStyle, MAX_TEXT_SCALE, textExtent } from './shapes/common';
import { shapeFor } from './shapes';
import type { SvgNode } from './svg';

/** Start and end of a line: where the line between the centres crosses each outline. */
export function edgeEnds(d: Diagram, edge: DiagramEdge): { a: Point; b: Point } | null {
  const from = findNode(d, edge.from);
  const to = findNode(d, edge.to);
  if (!from || !to) return null;
  return { a: shapeFor(from.shape).boundary(from, center(to)), b: shapeFor(to.shape).boundary(to, center(from)) };
}

/**
 * Font size of each figure's text: larger than normal where the figure has
 * room (up to `MAX_TEXT_SCALE`). Figures of the same type and size share the
 * smallest of their sizes, so the texts of equal figures match.
 */
export function fontSizes(d: Diagram): Map<string, number> {
  const scales = new Map<string, number>();
  const groups = new Map<string, number>();
  const group = (n: DiagramNode) => `${n.shape} ${n.w} ${n.h} ${!!n.double}`;
  for (const n of d.nodes) {
    const room = shapeFor(n.shape).textRoom;
    if (!room || !n.text.trim()) continue;
    const { w, h } = textExtent(n.text);
    const scale = Math.min(MAX_TEXT_SCALE, Math.max(1, room(n, w, h)));
    scales.set(n.id, scale);
    groups.set(group(n), Math.min(groups.get(group(n)) ?? Infinity, scale));
  }
  const sizes = new Map<string, number>();
  for (const n of d.nodes) {
    if (scales.has(n.id)) sizes.set(n.id, Math.floor(drawingStyle.fontSize * groups.get(group(n))!));
  }
  return sizes;
}

export function renderDiagram(d: Diagram): SvgNode[] {
  const sizes = fontSizes(d);
  const nodes = d.nodes.map((n) => {
    const el = shapeFor(n.shape).render(n, sizes.get(n.id));
    return { ...el, attrs: { ...el.attrs, 'data-node': n.id } };
  });
  const edges: SvgNode[] = [];
  for (const edge of d.edges) {
    const ends = edgeEnds(d, edge);
    if (ends) edges.push(renderEdge(edge, ends.a, ends.b, drawingStyle.stroke, { 'data-edge': edge.id }));
  }
  // Lines on top, so their ends are never hidden by a figure.
  return [...nodes, ...edges];
}
