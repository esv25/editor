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

/** How a line of text is underlined: `_solid_` or `__dashed__` (ER: key and partial key). */
export type Underline = 'solid' | 'dashed';

export interface StyledLine {
  text: string;
  underline?: Underline;
  italic: boolean;
}

/**
 * Simple per-line markup, typed like Markdown: `_nøkkel_` is underlined (ER
 * keys, static members), `__delnøkkel__` has a dashed underline (partial key
 * of a weak entity), `*Abstrakt*` is italic.
 */
export function styledLine(line: string): StyledLine {
  let text = line.trim();
  let underline: Underline | undefined;
  let italic = false;
  for (let changed = true; changed && text.length > 2; ) {
    changed = false;
    if (/^__.+__$/.test(text)) {
      underline ??= 'dashed';
      text = text.slice(2, -2);
      changed = true;
    } else if (/^_.+_$/.test(text)) {
      underline ??= 'solid';
      text = text.slice(1, -1);
      changed = true;
    } else if (/^\*.+\*$/.test(text)) {
      italic = true;
      text = text.slice(1, -1);
      changed = true;
    }
  }
  return underline ? { text, underline, italic } : { text, italic };
}

/** The line written back with the given markup (inverse of `styledLine`). */
export function markupLine({ text, underline, italic }: StyledLine): string {
  if (!text) return text;
  const inner = italic ? `*${text}*` : text;
  return underline === 'solid' ? `_${inner}_` : underline === 'dashed' ? `__${inner}__` : inner;
}

/** How the text's non-empty lines are underlined: the same for all, or null if mixed/none. */
export function textUnderline(text: string): Underline | null {
  const kinds = new Set(text.split('\n').filter((l) => l.trim()).map((l) => styledLine(l).underline));
  const [only] = kinds;
  return kinds.size === 1 && only ? only : null;
}

/** Every non-empty line underlined the given way (null: no underline). */
export function setUnderline(text: string, underline: Underline | null): string {
  return text
    .split('\n')
    .map((line) => (line.trim() ? markupLine({ ...styledLine(line), underline: underline ?? undefined }) : line))
    .join('\n');
}

let measureContext: CanvasRenderingContext2D | null | undefined;

/** Width of a line of text in the drawing's font (estimated where there's no canvas, as in tests). */
export function measureText(text: string, bold = false, italic = false): number {
  if (measureContext === undefined) {
    measureContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  if (!measureContext) return text.length * drawingStyle.fontSize * 0.55;
  measureContext.font = `${italic ? 'italic ' : ''}${bold ? '600 ' : ''}${drawingStyle.fontSize}px ${drawingStyle.font}`;
  return measureContext.measureText(text).width;
}

export const textAttrs = {
  'font-family': drawingStyle.font,
  'font-size': drawingStyle.fontSize,
  fill: drawingStyle.text,
};

export interface TextLine {
  line: string;
  x: number;
  /** Middle of the line (the text uses `dominant-baseline: central`). */
  y: number;
  bold?: boolean;
}

/**
 * Lines of text as one <text> with a <tspan> each, plus their underlines.
 * Underlines are drawn as lines of their own rather than `text-decoration`,
 * so dashed ones look the same in every program that shows the file.
 */
export function textBlock(lines: TextLine[], anchor: 'middle' | 'start'): SvgNode[] {
  if (!lines.length) return [];
  const underlines: SvgNode[] = [];
  const spans = lines.map(({ line, x, y, bold }) => {
    const styled = styledLine(line);
    if (styled.underline && styled.text) {
      const w = measureText(styled.text, bold, styled.italic);
      const x1 = anchor === 'middle' ? x - w / 2 : x;
      const uy = y + drawingStyle.fontSize * 0.5;
      underlines.push(
        h('line', {
          x1,
          y1: uy,
          x2: x1 + w,
          y2: uy,
          stroke: drawingStyle.text,
          'stroke-width': 1.5,
          'stroke-dasharray': styled.underline === 'dashed' ? '4 3' : undefined,
        }),
      );
    }
    return h(
      'tspan',
      { x, y, 'font-style': styled.italic ? 'italic' : undefined, 'font-weight': bold ? 600 : undefined },
      [],
      styled.text || ' ',
    );
  });
  return [h('text', { 'text-anchor': anchor, 'dominant-baseline': 'central', ...textAttrs }, spans), ...underlines];
}

/** The node's text, centred, one <tspan> per line. */
export function label(node: DiagramNode): SvgNode[] {
  if (!node.text) return [];
  const lines = node.text.split('\n');
  const c = center(node);
  const firstY = c.y - ((lines.length - 1) * lineHeight) / 2;
  return textBlock(lines.map((line, i) => ({ line, x: c.x, y: firstY + i * lineHeight })), 'middle');
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

/** Corners and side middles of the node's box: where lines snap to. */
export function rectAnchors(n: DiagramNode): Point[] {
  const [x0, x1, x2] = [n.x, n.x + n.w / 2, n.x + n.w];
  const [y0, y1, y2] = [n.y, n.y + n.h / 2, n.y + n.h];
  return [
    { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x2, y: y0 },
    { x: x0, y: y1 }, { x: x2, y: y1 },
    { x: x0, y: y2 }, { x: x1, y: y2 }, { x: x2, y: y2 },
  ];
}

/** The four points where the outline meets the box's middle lines (ellipse, rhombus). */
export function sideAnchors(n: DiagramNode): Point[] {
  return [
    { x: n.x + n.w / 2, y: n.y },
    { x: n.x + n.w, y: n.y + n.h / 2 },
    { x: n.x + n.w / 2, y: n.y + n.h },
    { x: n.x, y: n.y + n.h / 2 },
  ];
}

/** Boundary point on the node's bounding rectangle, toward `p`. */
export function rectBoundary(node: DiagramNode, p: Point): Point {
  const c = center(node);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const scale = Math.min(dx === 0 ? Infinity : node.w / 2 / Math.abs(dx), dy === 0 ? Infinity : node.h / 2 / Math.abs(dy));
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}
