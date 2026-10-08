/**
 * Diagram → SVG tree. Used for both the canvas and the saved file.
 */
import { renderEdge } from './edges';
import { findNode, type Diagram, type DiagramEdge, type Point } from './model';
import { textScale } from './textSize';
import { routeBetween, simplify } from './routing';
import { drawingStyle, MAX_TEXT_SCALE, textExtent } from './shapes/common';
import { shapeFor } from './shapes';
import type { SvgNode } from './svg';

/**
 * The points a line goes through, from where it leaves one outline to where it
 * meets the other. Straight: along the line between the centres. With corners:
 * the first and last pieces still head for the centres, so the ends land on
 * the outlines.
 */
export function edgePoints(d: Diagram, edge: DiagramEdge): Point[] | null {
  const from = findNode(d, edge.from);
  const to = findNode(d, edge.to);
  if (!from || !to) return null;
  const way = routeBetween(from, to, edge.route);
  const first = shapeFor(from.shape).boundary(from, way[1]);
  const last = shapeFor(to.shape).boundary(to, way[way.length - 2]);
  return simplify([first, ...way.slice(1, -1), last]);
}

/**
 * Font size of each figure's text: the drawing's text size, or larger where
 * the figure has room (up to `MAX_TEXT_SCALE` times that), so short texts are easy to
 * read even when the drawing is printed small. Figures without a
 * `textRoom` just follow the drawing's text size.
 */
export function fontSizes(d: Diagram): Map<string, number> {
  const base = textScale(d);
  const max = MAX_TEXT_SCALE * base;
  const sizes = new Map<string, number>();
  for (const n of d.nodes) {
    if (!n.text.trim()) continue;
    const room = shapeFor(n.shape).textRoom;
    if (!room) {
      if (base !== 1) sizes.set(n.id, Math.floor(drawingStyle.fontSize * base));
      continue;
    }
    const { w, h } = textExtent(n.text);
    sizes.set(n.id, Math.floor(drawingStyle.fontSize * Math.min(max, Math.max(base, room(n, w, h)))));
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
    const points = edgePoints(d, edge);
    if (points) edges.push(renderEdge(edge, points, drawingStyle.stroke, { 'data-edge': edge.id }, textScale(d)));
  }
  // Lines on top, so their ends are never hidden by a figure.
  return [...nodes, ...edges];
}
