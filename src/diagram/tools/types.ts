import type { Diagram, DiagramEdge, DiagramNode, Point } from '../model';
import type { SvgNode } from '../svg';

export interface Selection {
  kind: 'node' | 'edge';
  id: string;
}

export const sameItem = (a: Selection, b: Selection) => a.kind === b.kind && a.id === b.id;

/** Keys held when the button went down. */
export interface PointerKeys {
  /** Shift or Ctrl: add to (or take from) the selection instead of replacing it. */
  add: boolean;
}

/** What a tool can see and do. Provided by the canvas. */
export interface ToolContext {
  readonly diagram: Diagram;
  /** Everything selected (figures and lines); empty when nothing is. */
  readonly selection: readonly Selection[];
  readonly grid: number;
  /** How far from a figure a click still counts as hitting it (drawing units). */
  readonly tolerance: number;
  /** How far (drawing units) a press must move before it counts as a drag. */
  readonly dragThreshold: number;
  /** How close (drawing units) edges must come to line up with another figure's (see align.ts). */
  readonly alignTolerance: number;
  /** Size of on-screen handles in drawing units (so they stay the same size when zooming). */
  readonly handleSize: number;
  /** Replace the drawing (undoable, saved). */
  commit(next: Diagram): void;
  /** Replace the selection: one item, several, or nothing. */
  select(selection: Selection | readonly Selection[] | null): void;
  /** Start typing the text of a figure. */
  editText(nodeId: string): void;
  setTool(id: string): void;
  nodeAt(p: Point): DiagramNode | null;
  /**
   * Where a line point clicked at `p` goes: a nearby corner or side middle of a
   * figure (`anchored`), else half the grid.
   */
  snapPoint(p: Point): { point: Point; anchored: boolean };
  edgeAt(p: Point): DiagramEdge | null;
  /** Something in the tool's own state changed: redraw and update the hint. */
  refresh(): void;
  /** Move the view by this much (drawing units): what was at (x, y) is now at (x − dx, y − dy) on screen. */
  panBy(dx: number, dy: number): void;
}

export interface Preview {
  /** Show this instead of the real drawing (e.g. a figure being moved). */
  diagram?: Diagram;
  /** Extra things on top (ghosts, the arrow being drawn). */
  overlay?: SvgNode[];
  /** Don't highlight the figure under the pointer. */
  noHover?: boolean;
}

/**
 * A tool decides what clicks and drags do. Velg moves and resizes by drag and
 * drop; line tools are click–click (start, end). To add one: create tools/<name>.ts and list it in tools/index.ts.
 */
export interface Tool {
  id: string;
  name: string;
  icon: string;
  key: string;
  /** What to do next, shown in the hint bar. */
  hint(ctx: ToolContext): string;
  pointerDown(ctx: ToolContext, p: Point, keys?: PointerKeys): void;
  /** The pointer moved with the button held (after pointerDown). */
  pointerMove?(ctx: ToolContext, p: Point): void;
  /** The button was released (drag and drop ends here). */
  pointerUp?(ctx: ToolContext, p: Point): void;
  preview?(ctx: ToolContext, pointer: Point | null): Preview;
  /** Enter. Return true if the tool finished something of its own (else: edit the selection's text). */
  finish?(ctx: ToolContext): boolean;
  /** Esc. Return true if the tool cancelled something of its own (else: back to Velg). */
  cancel?(ctx: ToolContext): boolean;
  /** The tool is being switched away from. */
  reset?(): void;
  /**
   * Something is half done (a figure being dragged, a line between its
   * clicks): the view then scrolls when the pointer rests near its edge.
   */
  busy?(): boolean;
}
