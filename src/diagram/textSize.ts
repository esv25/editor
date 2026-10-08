/**
 * The drawing's text size («Større tekst» / «Mindre tekst»). A drawing is
 * usually shown smaller than it is drawn (in a note, on paper), and its text
 * shrinks with it; a larger text size keeps it readable. Larger text needs
 * room, so figures whose text no longer fits grow – around their middle, so
 * neighbours stay where they are, and lines ending on them follow.
 */
import { fastenLooseEnds, followAnchors } from './attach';
import type { Diagram, DiagramNode } from './model';
import { shapeFor } from './shapes';
import { lineHeight, measureText, styledLine, textExtent } from './shapes/common';

/** The steps the buttons go through (times the normal size). */
export const TEXT_SIZES = [1, 1.25, 1.5, 1.75, 2];

export const textScale = (d: Diagram): number => d.textSize ?? 1;

/** The next step up (1) or down (−1), or null at the end. */
export function stepTextSize(current: number, dir: 1 | -1): number | null {
  const next = dir > 0 ? TEXT_SIZES.find((s) => s > current + 1e-9) : [...TEXT_SIZES].reverse().find((s) => s < current - 1e-9);
  return next ?? null;
}

/** The size a figure's text needs at `scale` (as `ShapeType.fit`, default: centred lines plus padding). */
export function textNeeds(node: Pick<DiagramNode, 'shape' | 'text'>, scale: number): { w: number; h: number } {
  const shape = shapeFor(node.shape);
  const measure = (line: string, bold?: boolean) => measureText(line, bold);
  if (shape.fit) return shape.fit(node.text, measure, scale);
  const lines = node.text.split('\n');
  return {
    w: Math.max(0, ...lines.map((line) => measure(styledLine(line).text))) * scale + 32,
    h: lines.length * lineHeight * scale + 24,
  };
}

/** Grow `node` around its middle, two grid steps at a time (so it stays on the grid), until its text fits at `scale`. */
export function growForText(node: DiagramNode, scale: number, grid: number): DiagramNode {
  if (!node.text.trim()) return node;
  const shape = shapeFor(node.shape);
  const wider = (n: DiagramNode) => ({ ...n, x: n.x - grid, w: n.w + 2 * grid });
  const taller = (n: DiagramNode) => ({ ...n, y: n.y - grid, h: n.h + 2 * grid });
  if (shape.textRoom) {
    const { w, h } = textExtent(node.text);
    const room = (n: DiagramNode) => shape.textRoom!(n, w, h);
    let n = node;
    // Whichever way gives the text more room (wider on a tie: text is mostly wide).
    for (let i = 0; i < 50 && room(n) < scale - 1e-9; i++) n = room(wider(n)) >= room(taller(n)) ? wider(n) : taller(n);
    return n;
  }
  if (shape.ownTool) return node;
  const needs = textNeeds(node, scale);
  let n = node;
  while (n.w < needs.w) n = wider(n);
  while (n.h < needs.h) n = taller(n);
  return n;
}

/**
 * The drawing with text `size` times the normal size. Going up, figures grow
 * where the text wouldn't fit; going down, they keep their size.
 */
export function setTextSize(d: Diagram, size: number, grid: number): Diagram {
  const { textSize: _, ...rest } = d;
  const next: Diagram = size === 1 ? rest : { ...rest, textSize: size };
  if (size <= textScale(d)) return next;
  // Lines ending on a figure's snap point keep ending on it as the figure grows.
  const fastened = fastenLooseEnds(next);
  return followAnchors({ ...fastened, nodes: fastened.nodes.map((n) => growForText(n, size, grid)) });
}
