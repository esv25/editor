/**
 * What all figures share: colours and fonts of the saved drawing (fixed, so
 * the file looks the same everywhere), text layout, and outline geometry.
 */
import { center, type DiagramNode, type Point } from '../model';
import { h, type SvgNode } from '../svg';

export const drawingStyle = {
  paper: '#fbfaf7',
  stroke: '#2b2a28',
  fill: '#ffffff',
  text: '#2b2a28',
  strokeWidth: 2,
  font: '"Segoe UI", system-ui, sans-serif',
  fontSize: 16,
  lineHeight: 1.3,
};

const icon = (body: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
export { icon as shapeIcon };

/** The node's text, centred, one <tspan> per line. */
export function label(node: DiagramNode): SvgNode[] {
  if (!node.text) return [];
  const lines = node.text.split('\n');
  const lineHeight = drawingStyle.fontSize * drawingStyle.lineHeight;
  const c = center(node);
  const firstY = c.y - ((lines.length - 1) * lineHeight) / 2;
  return [
    h(
      'text',
      {
        x: c.x,
        y: firstY,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'font-family': drawingStyle.font,
        'font-size': drawingStyle.fontSize,
        fill: drawingStyle.text,
      },
      lines.map((line, i) => h('tspan', { x: c.x, y: firstY + i * lineHeight }, [], line || ' ')),
    ),
  ];
}

export const outline = { stroke: drawingStyle.stroke, 'stroke-width': drawingStyle.strokeWidth, fill: drawingStyle.fill };

/** Boundary point on the node's bounding rectangle, toward `p`. */
export function rectBoundary(node: DiagramNode, p: Point): Point {
  const c = center(node);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const scale = Math.min(dx === 0 ? Infinity : node.w / 2 / Math.abs(dx), dy === 0 ? Infinity : node.h / 2 / Math.abs(dy));
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}
