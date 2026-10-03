/**
 * The drawing surface: shows the diagram on a dotted grid, turns pointer and
 * keys into tool actions, and keeps undo history. Tools (tools/) decide what
 * a click means; figures (shapes/) decide how things look.
 */
import { getSettings } from '../settings';
import { History } from './history';
import {
  addNeighbor,
  bounds,
  distanceToRect,
  distanceToSegment,
  findNode,
  nodeAt,
  removeEdges,
  removeNodes,
  reverseEdge,
  snap,
  updateEdge,
  updateNode,
  type Diagram,
  type DiagramEdge,
  type DiagramNode,
  type Direction,
  type Point,
} from './model';
import { edgeEnds, renderDiagram } from './render';
import { shapeFor, type Measure } from './shapes';
import { drawingStyle, lineHeight, rectAnchors, styledLine } from './shapes/common';
import { h, toDom, type SvgNode } from './svg';
import { arrowSource, newEdgeStyle } from './tools/arrow';
import { selectTool } from './tools/select';
import { toolFor, toolKey, tools, type Selection, type Tool, type ToolContext } from './tools';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

export interface CanvasOptions {
  /** The drawing changed (save it). */
  onChange(diagram: Diagram): void;
  /** Tool, selection, zoom or hint changed (update the toolbar). */
  onStateChange(): void;
  /** Ctrl+S. */
  onSave(): void;
}

export class DiagramCanvas {
  diagram: Diagram;
  selection: Selection | null = null;
  tool: Tool = selectTool;
  zoom = 1;
  private pan: Point = { x: -40, y: -40 };
  private pointer: Point | null = null;
  private history = new History();
  private svg: SVGSVGElement;
  private gridRect: SVGRectElement;
  private content: SVGGElement;
  private overlay: SVGGElement;
  private editing: {
    textarea: HTMLTextAreaElement;
    place: () => { x: number; y: number; w: number; h: number } | null;
    multiline: boolean;
    finish: (save: boolean) => void;
  } | null = null;
  private frame = 0;
  private measure = document.createElement('canvas').getContext('2d')!;

  constructor(
    private root: HTMLElement,
    diagram: Diagram,
    private options: CanvasOptions,
  ) {
    this.diagram = diagram;
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.classList.add('dg-svg');
    const grid = getSettings().diagram.grid;
    this.svg.append(
      toDom(
        h('defs', {}, [
          h('pattern', { id: 'dg-grid', width: grid, height: grid, patternUnits: 'userSpaceOnUse' }, [
            h('circle', { cx: 0, cy: 0, r: 1.3, class: 'dg-grid-dot' }),
          ]),
        ]),
      ),
    );
    this.gridRect = document.createElementNS(SVG_NS, 'rect');
    this.gridRect.setAttribute('fill', 'url(#dg-grid)');
    this.content = document.createElementNS(SVG_NS, 'g');
    this.overlay = document.createElementNS(SVG_NS, 'g');
    this.svg.append(this.gridRect, this.content, this.overlay);
    root.append(this.svg);

    const box = bounds(diagram);
    if (box) this.pan = { x: snap(box.x, grid) - 2 * grid, y: snap(box.y, grid) - 2 * grid };

    this.svg.addEventListener('pointermove', (e) => {
      this.pointer = this.toDrawing(e);
      if (e.buttons & 1) this.tool.pointerMove?.(this.context, this.pointer);
      this.schedule();
    });
    this.svg.addEventListener('pointerup', (e) => {
      if (e.button !== 0) return;
      this.pointer = this.toDrawing(e);
      this.tool.pointerUp?.(this.context, this.pointer);
      this.refresh();
    });
    this.svg.addEventListener('pointerleave', () => {
      this.pointer = null;
      this.schedule();
    });
    this.svg.addEventListener('pointerdown', (e) => this.pointerDown(e));
    this.svg.addEventListener('contextmenu', (e) => e.preventDefault());
    this.svg.addEventListener('dblclick', () => this.editSelection());
    this.svg.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.keyDown(e));
    new ResizeObserver(() => this.updateViewBox()).observe(root);
    this.updateViewBox();
  }

  // --- What tools see -----------------------------------------------------

  private context: ToolContext = (() => {
    const canvas = this;
    return {
      get diagram() {
        return canvas.diagram;
      },
      get selection() {
        return canvas.selection;
      },
      get grid() {
        return getSettings().diagram.grid;
      },
      get tolerance() {
        return getSettings().diagram.hitTolerance / canvas.zoom;
      },
      get dragThreshold() {
        return getSettings().diagram.dragThreshold / canvas.zoom;
      },
      get handleSize() {
        return 14 / canvas.zoom;
      },
      commit: (next) => canvas.commit(next),
      select: (selection) => canvas.select(selection),
      editText: (id) => canvas.editText(id),
      setTool: (id) => canvas.setTool(id),
      nodeAt: (p) => canvas.nodeAt(canvas.diagram, p),
      snapPoint: (p) => canvas.snapPoint(p),
      edgeAt: (p) => canvas.edgeAt(p),
      refresh: () => canvas.refresh(),
    };
  })();

  get hint(): string {
    if (this.editing?.multiline) return 'Skriv teksten · Enter: ny linje · «--» på egen linje: ny del · Ctrl+Enter eller Esc: ferdig';
    if (this.editing) return 'Skriv teksten · Enter eller Esc: ferdig · Shift+Enter: ny linje';
    return this.tool.hint(this.context);
  }

  // --- Changing things ----------------------------------------------------

  commit(next: Diagram): void {
    if (next === this.diagram) return;
    this.history.record(this.diagram);
    this.diagram = next;
    this.changed();
  }

  private changed(): void {
    const sel = this.selection;
    if (sel && !(sel.kind === 'node' ? findNode(this.diagram, sel.id) : this.diagram.edges.some((e) => e.id === sel.id))) {
      this.selection = null;
    }
    this.options.onChange(this.diagram);
    this.refresh();
  }

  undo(): void {
    this.finishEditing(true);
    const previous = this.history.undo(this.diagram);
    if (!previous) return;
    this.tool.reset?.();
    this.diagram = previous;
    this.changed();
  }

  redo(): void {
    this.finishEditing(true);
    const next = this.history.redo(this.diagram);
    if (!next) return;
    this.tool.reset?.();
    this.diagram = next;
    this.changed();
  }

  select(selection: Selection | null): void {
    this.selection = selection;
    this.refresh();
  }

  setTool(id: string): void {
    this.finishEditing(true);
    this.tool.reset?.();
    this.tool = toolFor(id);
    this.tool.reset?.();
    this.refresh();
  }

  deleteSelection(): void {
    const sel = this.selection;
    if (!sel) return;
    this.commit(sel.kind === 'node' ? removeNodes(this.diagram, [sel.id]) : removeEdges(this.diagram, [sel.id]));
  }

  /** Ctrl+arrow: a new connected figure in that direction, ready for typing. */
  addNeighbor(dir: Direction): void {
    if (this.selection?.kind !== 'node') return;
    const added = addNeighbor(this.diagram, this.selection.id, dir, getSettings().diagram.grid, newEdgeStyle());
    if (!added) return;
    this.commit(added.diagram);
    this.select({ kind: 'node', id: added.id });
    this.scrollIntoView(added.id);
    this.editText(added.id);
  }

  private nudge(dx: number, dy: number): void {
    if (this.selection?.kind !== 'node') return;
    const node = findNode(this.diagram, this.selection.id);
    if (node) this.commit(updateNode(this.diagram, node.id, { x: node.x + dx, y: node.y + dy }));
  }

  edgeAt(p: Point): DiagramEdge | null {
    const reach = (getSettings().diagram.hitTolerance * 0.75) / this.zoom;
    let best: DiagramEdge | null = null;
    let bestDistance = Infinity;
    for (const edge of this.diagram.edges) {
      const ends = edgeEnds(this.diagram, edge);
      if (!ends) continue;
      const distance = distanceToSegment(p, ends.a, ends.b);
      if (distance <= reach && distance < bestDistance) {
        best = edge;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** The figure at p, with each shape's own idea of "near" (freehand: near the line). */
  nodeAt(d: Diagram, p: Point): DiagramNode | null {
    const tolerance = getSettings().diagram.hitTolerance / this.zoom;
    return nodeAt(d, p, tolerance, (n, q) => shapeFor(n.shape).distance?.(n, q) ?? distanceToRect(q, n));
  }

  /** A line point near `p`: the closest figure corner/side middle within reach, else half the grid. */
  snapPoint(p: Point): { point: Point; anchored: boolean } {
    const reach = getSettings().diagram.hitTolerance / this.zoom;
    let best: Point | null = null;
    let bestDistance = Infinity;
    for (const n of this.diagram.nodes) {
      for (const a of shapeFor(n.shape).anchors?.(n) ?? rectAnchors(n)) {
        const distance = Math.hypot(a.x - p.x, a.y - p.y);
        if (distance <= reach && distance < bestDistance) {
          best = a;
          bestDistance = distance;
        }
      }
    }
    if (best) return { point: best, anchored: true };
    const half = getSettings().diagram.grid / 2;
    return { point: { x: snap(p.x, half), y: snap(p.y, half) }, anchored: false };
  }

  /** Enter / double click / «Skriv tekst»: edit the selected figure's or line's text. */
  editSelection(): void {
    if (this.selection?.kind === 'node') this.editText(this.selection.id);
    else if (this.selection?.kind === 'edge') this.editEdgeLabel(this.selection.id);
  }

  get selectedNode(): DiagramNode | null {
    return this.selection?.kind === 'node' ? (findNode(this.diagram, this.selection.id) ?? null) : null;
  }

  get selectedEdge(): DiagramEdge | null {
    const sel = this.selection;
    return sel?.kind === 'edge' ? (this.diagram.edges.find((e) => e.id === sel.id) ?? null) : null;
  }

  updateSelectedNode(patch: Partial<Omit<DiagramNode, 'id'>>): void {
    const node = this.selectedNode;
    if (node) this.commit(updateNode(this.diagram, node.id, patch));
  }

  updateSelectedEdge(patch: Partial<Omit<DiagramEdge, 'id' | 'from' | 'to'>>): void {
    const edge = this.selectedEdge;
    if (edge) this.commit(updateEdge(this.diagram, edge.id, patch));
  }

  reverseSelectedEdge(): void {
    const edge = this.selectedEdge;
    if (edge) this.commit(reverseEdge(this.diagram, edge.id));
  }

  // --- Text ---------------------------------------------------------------

  /** Type the text of a figure. */
  editText(nodeId: string): void {
    const node = findNode(this.diagram, nodeId);
    if (!node) return;
    const shape = shapeFor(node.shape);
    this.openTextField({
      value: node.text,
      multiline: !!shape.multiline,
      placeholder: shape.placeholder ?? '',
      align: shape.multiline ? 'left' : 'center',
      place: () => findNode(this.diagram, nodeId) ?? null,
      save: (text) => {
        const current = findNode(this.diagram, nodeId);
        if (current) this.commit(updateNode(this.diagram, nodeId, { text, ...this.fitText(current, text) }));
      },
    });
  }

  /** Type the text in the middle of a line. */
  editEdgeLabel(edgeId: string): void {
    const edge = this.diagram.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    this.openTextField({
      value: edge.label ?? '',
      multiline: false,
      placeholder: 'Tekst på linja',
      align: 'center',
      place: () => {
        const current = this.diagram.edges.find((e) => e.id === edgeId);
        const ends = current && edgeEnds(this.diagram, current);
        if (!ends) return null;
        const mid = { x: (ends.a.x + ends.b.x) / 2, y: (ends.a.y + ends.b.y) / 2 };
        return { x: mid.x - 90, y: mid.y - 20, w: 180, h: 40 };
      },
      save: (label) => this.commit(updateEdge(this.diagram, edgeId, { label: label.trim() || undefined })),
    });
  }

  private openTextField(field: {
    value: string;
    multiline: boolean;
    placeholder: string;
    align: 'left' | 'center';
    place: () => { x: number; y: number; w: number; h: number } | null;
    save: (text: string) => void;
  }): void {
    this.finishEditing(true);
    const textarea = document.createElement('textarea');
    textarea.className = 'dg-text-input';
    textarea.value = field.value;
    textarea.placeholder = field.placeholder;
    textarea.spellcheck = true;
    textarea.lang = 'nb';
    textarea.style.textAlign = field.align;
    this.root.append(textarea);

    // Esc keeps what was typed too (an accidental Esc shouldn't lose work; Ctrl+Z undoes).
    const finish = (save: boolean) => {
      if (this.editing?.textarea !== textarea) return;
      this.editing = null;
      textarea.remove();
      if (save && textarea.value !== field.value) field.save(textarea.value);
      else this.refresh();
    };
    textarea.addEventListener('keydown', (e) => {
      e.stopPropagation();
      const done = e.key === 'Escape' || (e.key === 'Enter' && (field.multiline ? e.ctrlKey || e.metaKey : !e.shiftKey));
      if (done) {
        e.preventDefault();
        finish(true);
      }
    });
    textarea.addEventListener('blur', () => finish(true));
    this.editing = { textarea, place: field.place, multiline: field.multiline, finish };
    this.positionTextarea();
    textarea.focus();
    textarea.select();
    this.refresh();
  }

  finishEditing(save: boolean): void {
    this.editing?.finish(save);
  }

  private positionTextarea(): void {
    if (!this.editing) return;
    const rect = this.editing.place();
    if (!rect) return;
    Object.assign(this.editing.textarea.style, {
      left: `${(rect.x - this.pan.x) * this.zoom}px`,
      top: `${(rect.y - this.pan.y) * this.zoom}px`,
      width: `${rect.w * this.zoom}px`,
      // Room to type more lines in a class.
      height: `${Math.max(rect.h, this.editing.multiline ? 160 : 0) * this.zoom}px`,
      fontSize: `${drawingStyle.fontSize * this.zoom}px`,
    });
  }

  /** Grow the figure (never shrink it) so the text fits, in whole grid steps. */
  private fitText(node: DiagramNode, text: string): { w: number; h: number } {
    const grid = getSettings().diagram.grid;
    const measure: Measure = (line, bold) => {
      this.measure.font = `${bold ? '600 ' : ''}${drawingStyle.fontSize}px ${drawingStyle.font}`;
      return this.measure.measureText(line).width;
    };
    const shape = shapeFor(node.shape);
    const needed = shape.fit
      ? shape.fit(text, measure)
      : {
          w: Math.max(0, ...text.split('\n').map((line) => measure(styledLine(line).text))) + 32,
          h: text.split('\n').length * lineHeight + 24,
        };
    const up = (v: number) => Math.ceil(v / grid) * grid;
    return { w: Math.max(node.w, up(needed.w)), h: Math.max(node.h, up(needed.h)) };
  }

  // --- View ---------------------------------------------------------------

  get zoomPercent(): number {
    return Math.round(this.zoom * 100);
  }

  zoomBy(factor: number, around?: { clientX: number; clientY: number }): void {
    const rect = this.svg.getBoundingClientRect();
    const screen = around ?? { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    const fixed = this.toDrawing(screen);
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    this.pan = {
      x: fixed.x - (screen.clientX - rect.left) / this.zoom,
      y: fixed.y - (screen.clientY - rect.top) / this.zoom,
    };
    this.updateViewBox();
  }

  zoomReset(): void {
    this.zoomBy(1 / this.zoom);
  }

  private scrollIntoView(nodeId: string): void {
    const node = findNode(this.diagram, nodeId);
    if (!node) return;
    const rect = this.svg.getBoundingClientRect();
    const w = rect.width / this.zoom;
    const hgt = rect.height / this.zoom;
    const margin = 40;
    if (node.x < this.pan.x + margin) this.pan.x = node.x - margin;
    if (node.y < this.pan.y + margin) this.pan.y = node.y - margin;
    if (node.x + node.w > this.pan.x + w - margin) this.pan.x = node.x + node.w - w + margin;
    if (node.y + node.h > this.pan.y + hgt - margin) this.pan.y = node.y + node.h - hgt + margin;
    this.updateViewBox();
  }

  private updateViewBox(): void {
    const rect = this.svg.getBoundingClientRect();
    const w = Math.max(1, rect.width) / this.zoom;
    const hgt = Math.max(1, rect.height) / this.zoom;
    this.svg.setAttribute('viewBox', `${this.pan.x} ${this.pan.y} ${w} ${hgt}`);
    for (const [k, v] of Object.entries({ x: this.pan.x, y: this.pan.y, width: w, height: hgt })) {
      this.gridRect.setAttribute(k, String(v));
    }
    this.positionTextarea();
    this.refresh();
  }

  private toDrawing(e: { clientX: number; clientY: number }): Point {
    const rect = this.svg.getBoundingClientRect();
    return { x: this.pan.x + (e.clientX - rect.left) / this.zoom, y: this.pan.y + (e.clientY - rect.top) / this.zoom };
  }

  // --- Input --------------------------------------------------------------

  private pointerDown(e: PointerEvent): void {
    // Right click = Esc (joysticks usually have a second button).
    if (e.button === 2) {
      e.preventDefault();
      this.escape();
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    this.finishEditing(true);
    // Keep getting moves and the release even if the pointer leaves the canvas while dragging.
    try {
      this.svg.setPointerCapture(e.pointerId);
    } catch {
      // Not a real pointer (synthetic event): nothing to capture.
    }
    const p = this.toDrawing(e);
    this.pointer = p;
    this.tool.pointerDown(this.context, p);
    this.refresh();
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.ctrlKey) {
      this.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e);
    } else {
      const dx = e.shiftKey ? e.deltaY : e.deltaX;
      const dy = e.shiftKey ? 0 : e.deltaY;
      this.pan = { x: this.pan.x + dx / this.zoom, y: this.pan.y + dy / this.zoom };
      this.updateViewBox();
    }
  }

  escape(): void {
    if (this.tool.cancel?.(this.context)) return;
    if (this.tool !== selectTool) this.setTool('select');
    else this.select(null);
  }

  private keyDown(e: KeyboardEvent): void {
    if (this.editing || (e.target instanceof HTMLElement && e.target.closest('input, textarea, select'))) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    const arrows: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    const grid = getSettings().diagram.grid;
    let handled = true;
    if (key === 'Escape') this.escape();
    else if (key === 'Delete' || key === 'Backspace') this.deleteSelection();
    else if (key === 'Enter' && this.tool.finish?.(this.context)) return e.preventDefault();
    else if (key === 'Enter' || key === 'F2') this.editSelection();
    else if (mod && key.toLowerCase() === 'z' && !e.shiftKey) this.undo();
    else if (mod && (key.toLowerCase() === 'y' || (key.toLowerCase() === 'z' && e.shiftKey))) this.redo();
    else if (mod && key.toLowerCase() === 's') this.options.onSave();
    else if (mod && arrows[key]) this.addNeighbor(arrows[key]);
    else if (arrows[key]) {
      const step = e.shiftKey ? grid * 5 : grid;
      const d = arrows[key];
      this.nudge(d === 'left' ? -step : d === 'right' ? step : 0, d === 'up' ? -step : d === 'down' ? step : 0);
    } else if (key === '+' || key === '=') this.zoomBy(1.25);
    else if (key === '-') this.zoomBy(1 / 1.25);
    else if (key === '0' && !mod) this.zoomReset();
    else if (!mod && !e.altKey && key.length === 1) {
      const tool = tools.find((t) => toolKey(t) === key.toLowerCase());
      if (tool) this.setTool(tool.id);
      else handled = false;
    } else handled = false;
    if (handled) e.preventDefault();
  }

  // --- Drawing ------------------------------------------------------------

  refresh(): void {
    this.schedule();
    this.options.onStateChange();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const preview = this.tool.preview?.(this.context, this.pointer) ?? {};
    const d = preview.diagram ?? this.diagram;
    this.content.replaceChildren(...renderDiagram(d).map(toDom));

    const marks: SvgNode[] = [];
    const pad = 5 / this.zoom;
    const outline = (id: string, cls: string) => {
      const n = findNode(d, id);
      if (n) marks.push(h('rect', { x: n.x - pad, y: n.y - pad, width: n.w + 2 * pad, height: n.h + 2 * pad, rx: 8 / this.zoom, class: cls }));
      return n;
    };
    const line = (edge: DiagramEdge, cls: string) => {
      const ends = edgeEnds(d, edge);
      if (ends) marks.push(h('line', { x1: ends.a.x, y1: ends.a.y, x2: ends.b.x, y2: ends.b.y, class: cls }));
    };

    if (!preview.noHover && this.pointer && !this.editing) {
      const node = this.nodeAt(d, this.pointer);
      if (node) outline(node.id, 'dg-hover');
      else if (this.tool === selectTool) {
        const edge = this.edgeAt(this.pointer);
        if (edge) line(edge, 'dg-hover-edge');
      }
    }
    const source = this.tool.id === 'arrow' ? arrowSource() : null;
    if (source) outline(source, 'dg-source');
    if (this.selection?.kind === 'node') {
      const n = outline(this.selection.id, 'dg-selection');
      if (n && this.tool === selectTool) {
        const s = 14 / this.zoom;
        marks.push(h('rect', { x: n.x + n.w - s / 2, y: n.y + n.h - s / 2, width: s, height: s, rx: 3 / this.zoom, class: 'dg-handle' }));
      }
    } else if (this.selection?.kind === 'edge') {
      const edge = d.edges.find((e) => e.id === this.selection!.id);
      if (edge) line(edge, 'dg-selection-edge');
    }
    marks.push(...(preview.overlay ?? []));
    this.overlay.replaceChildren(...marks.map(toDom));
  }
}
