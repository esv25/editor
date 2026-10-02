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

export const lineHeight = drawingStyle.fontSize * drawingStyle.lineHeight;

const icon = (body: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
export { icon as shapeIcon };

export interface StyledLine {
  text: string;
  underline: boolean;
  italic: boolean;
}

/**
 * Simple per-line markup, typed like Markdown: `_nøkkel_` is underlined (ER
 * keys, static members), `*Abstrakt*` is italic.
 */
export function styledLine(line: string): StyledLine {
  let text = line.trim();
  let underline = false;
  let italic = false;
  for (let changed = true; changed && text.length > 2; ) {
    changed = false;
    if (/^_.+_$/.test(text)) {
      underline = true;
      text = text.slice(1, -1);
      changed = true;
    } else if (/^\*.+\*$/.test(text)) {
      italic = true;
      text = text.slice(1, -1);
      changed = true;
    }
  }
  return { text, underline, italic };
}

/** One <tspan> for a line, with its markup applied. */
export function tspan(line: string, x: number, y: number, extra: SvgNode['attrs'] = {}): SvgNode {
  const styled = styledLine(line);
  return h(
    'tspan',
    {
      x,
      y,
      'text-decoration': styled.underline ? 'underline' : undefined,
      'font-style': styled.italic ? 'italic' : undefined,
      ...extra,
    },
    [],
    styled.text || ' ',
  );
}

export const textAttrs = {
  'font-family': drawingStyle.font,
  'font-size': drawingStyle.fontSize,
  fill: drawingStyle.text,
};

/** The node's text, centred, one <tspan> per line. */
export function label(node: DiagramNode): SvgNode[] {
  if (!node.text) return [];
  const lines = node.text.split('\n');
  const c = center(node);
  const firstY = c.y - ((lines.length - 1) * lineHeight) / 2;
  return [
    h(
      'text',
      { x: c.x, y: firstY, 'text-anchor': 'middle', 'dominant-baseline': 'central', ...textAttrs },
      lines.map((line, i) => tspan(line, c.x, firstY + i * lineHeight)),
    ),
  ];
}

/** Stroke and fill of an outline (dashed if the node says so). */
export function outline(node: DiagramNode): SvgNode['attrs'] {
  return {
    stroke: drawingStyle.stroke,
    'stroke-width': drawingStyle.strokeWidth,
    fill: drawingStyle.fill,
    'stroke-dasharray': node.dashed ? '8 5' : undefined,
  };
}

/** The same outline again, without fill (the inner line of a double outline). */
export function innerOutline(node: DiagramNode): SvgNode['attrs'] {
  return { ...outline(node), fill: 'none' };
}

/** Gap between the two lines of a double outline. */
export const DOUBLE_GAP = 5;

/** Boundary point on the node's bounding rectangle, toward `p`. */
export function rectBoundary(node: DiagramNode, p: Point): Point {
  const c = center(node);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const scale = Math.min(dx === 0 ? Infinity : node.w / 2 / Math.abs(dx), dy === 0 ? Infinity : node.h / 2 / Math.abs(dy));
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}
