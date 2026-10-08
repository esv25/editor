/**
 * Lining figures up. While a figure is dragged, placed or resized, its edges
 * and middle jump to those of other figures when they're close
 * (`settings.diagram.alignTolerance`), otherwise to the grid. Guides – thin
 * lines through the figures that line up – show it.
 */
import { snap, type Diagram, type DiagramNode, type Point } from './model';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Guide {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface AlignOptions {
  grid: number;
  /** Drawing units; 0 = only the grid. */
  tolerance: number;
  /** The figure being moved (it doesn't line up with itself). */
  ignore?: string;
}

/** Start, middle and end of a box along one axis. */
const lines = (start: number, size: number) => [start, start + size / 2, start + size];

/** Figures to line up with: open lines don't count (you see the line, not its box). */
function targets(d: Diagram, ignore?: string): DiagramNode[] {
  return d.nodes.filter((n) => n.id !== ignore && !(n.shape === 'path' && !n.closed));
}

/**
 * One axis: something with edges at `raw + offsets` goes where one of them
 * meets one of `values` (the nearest within `tolerance`), else `raw` on the grid.
 */
export function snapAxis(raw: number, offsets: number[], values: number[], grid: number, tolerance: number): number {
  let best: number | null = null;
  for (const o of offsets) {
    for (const v of values) {
      const shift = v - (raw + o);
      if (Math.abs(shift) <= tolerance && (best === null || Math.abs(shift) < Math.abs(best))) best = shift;
    }
  }
  return best === null ? snap(raw, grid) : raw + best;
}

/** Where a box dragged to `raw` (top-left, not snapped) ends up. */
export function alignMove(d: Diagram, raw: Box, options: AlignOptions): Point {
  const others = targets(d, options.ignore);
  return {
    x: snapAxis(raw.x, [0, raw.w / 2, raw.w], others.flatMap((n) => lines(n.x, n.w)), options.grid, options.tolerance),
    y: snapAxis(raw.y, [0, raw.h / 2, raw.h], others.flatMap((n) => lines(n.y, n.h)), options.grid, options.tolerance),
  };
}

/** The size of `node` with its bottom-right corner dragged to `corner`: that edge lines up, or snaps to the grid. */
export function alignResize(d: Diagram, node: DiagramNode, corner: Point, options: AlignOptions & { min: number }): { w: number; h: number } {
  const others = targets(d, node.id);
  const right = snapAxis(corner.x - node.x, [0], others.flatMap((n) => lines(n.x - node.x, n.w)), options.grid, options.tolerance);
  const bottom = snapAxis(corner.y - node.y, [0], others.flatMap((n) => lines(n.y - node.y, n.h)), options.grid, options.tolerance);
  return { w: Math.max(options.min, right), h: Math.max(options.min, bottom) };
}

/** Lines through `box` and every figure sharing one of its edges or middles. */
export function guidesFor(d: Diagram, box: Box, ignore?: string): Guide[] {
  const others = targets(d, ignore);
  const guides: Guide[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  for (const x of lines(box.x, box.w)) {
    const hits = others.filter((n) => lines(n.x, n.w).some((v) => near(v, x)));
    if (!hits.length) continue;
    const all = [box, ...hits];
    guides.push({ x1: x, y1: Math.min(...all.map((n) => n.y)), x2: x, y2: Math.max(...all.map((n) => n.y + n.h)) });
  }
  for (const y of lines(box.y, box.h)) {
    const hits = others.filter((n) => lines(n.y, n.h).some((v) => near(v, y)));
    if (!hits.length) continue;
    const all = [box, ...hits];
    guides.push({ x1: Math.min(...all.map((n) => n.x)), y1: y, x2: Math.max(...all.map((n) => n.x + n.w)), y2: y });
  }
  return guides;
}
