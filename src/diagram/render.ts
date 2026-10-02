/**
 * Diagram → SVG tree. Used for both the canvas and the saved file.
 */
import { renderEdge } from './edges';
import { center, findNode, type Diagram, type DiagramEdge, type Point } from './model';
import { drawingStyle } from './shapes/common';
import { shapeFor } from './shapes';
import type { SvgNode } from './svg';

/** Start and end of a line: where the line between the centres crosses each outline. */
export function edgeEnds(d: Diagram, edge: DiagramEdge): { a: Point; b: Point } | null {
  const from = findNode(d, edge.from);
  const to = findNode(d, edge.to);
  if (!from || !to) return null;
  return { a: shapeFor(from.shape).boundary(from, center(to)), b: shapeFor(to.shape).boundary(to, center(from)) };
}

export function renderDiagram(d: Diagram): SvgNode[] {
  const nodes = d.nodes.map((n) => {
    const el = shapeFor(n.shape).render(n);
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
