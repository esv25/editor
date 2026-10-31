/**
 * The data structure view beside the editor while debugging: the variables of
 * each call and the objects they point to, as boxes with arrows (like Python
 * Tutor). Redrawn at every stop; what changed since the stop before is marked.
 * Placement and arrows come from debug/heapLayout.ts; this measures and draws.
 */
import type { DebugController } from '../debug/controller';
import { heapEntryKey, heapVarKey, type HeapEntry, type HeapGraph, type HeapObject, type HeapValue } from '../debug/heap';
import { frameBox, layoutHeap, objectBox, type BoxSize } from '../debug/heapLayout';
import { formatKey, keyFor } from '../commands/registry';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ZOOM_KEY = 'editor.debugHeapZoom.v1';
const ZOOMS = [0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];

/** Lists this short with nothing but values drawn in place go sideways, like an array. */
const ROW_LIST = 12;

function readZoom(): number {
  try {
    const z = Number(localStorage.getItem(ZOOM_KEY));
    return ZOOMS.includes(z) ? z : 1;
  } catch {
    return 1;
  }
}

/** Rough type of a value drawn in place, for colouring (like the variable list). */
function valueClass(text: string): string {
  if (/^(['"`]).*\1$/s.test(text)) return 'str';
  if (/^-?\d[\d_.e+-]*[jn]?$/i.test(text) || /^(True|False|true|false|None|null|undefined|NaN|-?Infinity)$/.test(text)) return 'num';
  return '';
}

const KIND_NAMES: Record<string, string> = { list: 'liste', tuple: 'tuppel', dict: 'ordbok', set: 'mengde' };

export class HeapView {
  private zoom = readZoom();
  private wide = false;
  private renderQueued = false;
  private canvas = document.createElement('div');
  private zoomLabel = document.createElement('span');

  constructor(
    private container: HTMLElement,
    private debug: DebugController,
  ) {
    container.classList.add('heap-view');
    const head = document.createElement('div');
    head.className = 'heap-head';
    const title = document.createElement('h2');
    title.textContent = 'Datastrukturer';
    const actions = document.createElement('div');
    actions.className = 'heap-actions';
    const button = (text: string, label: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'heap-button';
      b.textContent = text;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', onClick);
      return b;
    };
    this.zoomLabel.className = 'heap-zoom';
    const key = keyFor('debug.heap');
    actions.append(
      button('−', 'Mindre', () => this.setZoom(-1)),
      this.zoomLabel,
      button('+', 'Større', () => this.setZoom(1)),
      button('⇔', 'Bredere / smalere', () => {
        this.wide = !this.wide;
        this.container.classList.toggle('wide', this.wide);
      }),
      button('✕', `Lukk${key ? ` (${formatKey(key)})` : ''}`, () => debug.toggleHeap()),
    );
    head.append(title, actions);
    this.canvas.className = 'heap-scroll';
    container.append(head, this.canvas);
    debug.onChange(() => this.queueRender());
    this.render();
  }

  private setZoom(step: number): void {
    const i = ZOOMS.indexOf(this.zoom);
    this.zoom = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + step))];
    try {
      localStorage.setItem(ZOOM_KEY, String(this.zoom));
    } catch {
      // Remembered until the app closes.
    }
    this.render();
  }

  private queueRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  render(): void {
    const c = this.debug;
    this.container.hidden = !c.heapVisible;
    if (!c.heapVisible) return;
    this.zoomLabel.textContent = `${Math.round(this.zoom * 100)} %`;
    const state = c.heapState();
    if (!state) return this.message(c.status === 'paused' ? 'Henter datastrukturene …' : 'Programmet kjører');
    if (!state.graph) return this.message(state.error ?? '');
    if (state.graph.frames.every((f) => f.vars.length === 0)) return this.message('Ingen variabler ennå.');
    this.draw(state.graph, state.changed);
  }

  private message(text: string): void {
    const p = document.createElement('p');
    p.className = 'heap-message';
    p.textContent = text;
    this.canvas.replaceChildren(p);
  }

  private draw(graph: HeapGraph, changed: Set<string>): void {
    const { scrollLeft, scrollTop } = this.canvas;
    const stage = document.createElement('div');
    stage.className = 'heap-stage';
    stage.style.fontSize = `${13 * this.zoom}px`;
    const boxes = new Map<string, HTMLElement>();
    // The call selected in the stack (graph.frames has the user's calls, outermost first).
    const calls = this.debug.frames.filter((f) => f.path);
    const selected = this.debug.frame ? calls.indexOf(this.debug.frame) : 0;
    const active = selected < 0 ? -1 : graph.frames.length - 1 - selected;
    graph.frames.forEach((frame, i) => {
      const box = this.box('frame', frame.name, frame.vars.length ? '' : '(ingen variabler)');
      if (i === active) box.classList.add('active');
      frame.vars.forEach((v, n) => {
        const row = this.row(v.name, v.value, changed.has(heapVarKey(i, v.name)));
        row.dataset.entry = String(n);
        box.append(row);
      });
      boxes.set(frameBox(i), box);
    });
    for (const [id, o] of Object.entries(graph.objects)) {
      const box = this.objectBox(id, o, changed);
      if (changed.has(heapEntryKey(id))) box.classList.add('new');
      boxes.set(objectBox(id), box);
    }
    for (const box of boxes.values()) stage.append(box);
    this.canvas.replaceChildren(stage);

    // Measure, place, then draw the arrows.
    const sizes = new Map<string, BoxSize>();
    for (const [key, box] of boxes) {
      const rect = box.getBoundingClientRect();
      const dots = [...box.querySelectorAll<HTMLElement>('[data-entry]')].reduce<BoxSize['dots']>((all, el) => {
        const dot = el.querySelector('.heap-dot');
        if (dot) {
          const r = dot.getBoundingClientRect();
          all[Number(el.dataset.entry)] = { x: r.left + r.width / 2 - rect.left, y: r.top + r.height / 2 - rect.top };
        }
        return all;
      }, []);
      sizes.set(key, { w: rect.width, h: rect.height, dots });
    }
    const layout = layoutHeap(graph, sizes);
    for (const [key, r] of layout.boxes) {
      const box = boxes.get(key)!;
      box.style.transform = `translate(${r.x}px, ${r.y}px)`;
    }
    stage.style.width = `${layout.width}px`;
    stage.style.height = `${layout.height}px`;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.classList.add('heap-arrows');
    svg.setAttribute('width', String(layout.width));
    svg.setAttribute('height', String(layout.height));
    const defs = document.createElementNS(SVG_NS, 'defs');
    const marker = document.createElementNS(SVG_NS, 'marker');
    marker.id = 'heap-arrowhead';
    for (const [k, v] of Object.entries({ viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' })) marker.setAttribute(k, v);
    const head = document.createElementNS(SVG_NS, 'path');
    head.setAttribute('d', 'M0,0 L10,5 L0,10 z');
    marker.append(head);
    defs.append(marker);
    svg.append(defs);
    for (const a of layout.arrows) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', a.path);
      path.setAttribute('marker-end', 'url(#heap-arrowhead)');
      path.dataset.from = a.from;
      path.dataset.to = a.to;
      if (a.shared) path.classList.add('shared');
      svg.append(path);
    }
    stage.prepend(svg);
    // Pointing at a box shows its arrows (in and out) clearly.
    for (const [key, box] of boxes) {
      box.addEventListener('mouseenter', () => {
        for (const p of svg.querySelectorAll<SVGPathElement>('path[data-from]')) p.classList.toggle('lit', p.dataset.from === key || p.dataset.to === key);
        svg.classList.add('focus');
      });
      box.addEventListener('mouseleave', () => svg.classList.remove('focus'));
    }
    this.canvas.scrollLeft = scrollLeft;
    this.canvas.scrollTop = scrollTop;
  }

  private box(kind: string, title: string, empty = ''): HTMLElement {
    const box = document.createElement('div');
    box.className = `heap-box ${kind}`;
    const head = document.createElement('div');
    head.className = 'heap-title';
    head.textContent = title;
    box.append(head);
    if (empty) box.append(this.note(empty));
    return box;
  }

  private objectBox(id: string, o: HeapObject, changed: Set<string>): HTMLElement {
    const kindName = KIND_NAMES[o.kind];
    const title = o.kind === 'object' ? o.type : o.type === o.kind || !kindName ? (kindName ?? o.type) : `${kindName} (${o.type})`;
    const box = this.box(o.kind === 'object' ? 'object' : 'collection', title, o.size === 0 ? '(tom)' : '');
    const key = (e: HeapEntry, i: number) => heapEntryKey(id, e.label ?? String(i));
    const sideways = o.kind === 'set' || ((o.kind === 'list' || o.kind === 'tuple') && o.entries.length <= ROW_LIST && o.entries.every((e) => 'text' in e.value));
    if (sideways && o.entries.length) {
      const cells = document.createElement('div');
      cells.className = 'heap-cells';
      o.entries.forEach((e, i) => {
        const cell = document.createElement('div');
        cell.className = `heap-cell${changed.has(key(e, i)) ? ' changed' : ''}`;
        cell.dataset.entry = String(i);
        if (e.label !== undefined) cell.append(this.span('heap-index', e.label));
        cell.append(this.value(e.value));
        cells.append(cell);
      });
      box.append(cells);
    } else {
      o.entries.forEach((e, i) => {
        const row = this.row(e.label ?? '', e.value, changed.has(key(e, i)));
        row.dataset.entry = String(i);
        if (o.kind !== 'object') row.classList.add('indexed');
        box.append(row);
      });
    }
    if (o.size > o.entries.length) box.append(this.note(`… ${o.size - o.entries.length} til`));
    return box;
  }

  private row(label: string, value: HeapValue, changed: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = `heap-row${changed ? ' changed' : ''}`;
    row.append(this.span('heap-label', label), this.value(value));
    return row;
  }

  private value(value: HeapValue): HTMLElement {
    if ('ref' in value) {
      const cell = this.span('heap-value pointer', '');
      cell.append(this.span('heap-dot', ''));
      return cell;
    }
    const cell = this.span(`heap-value ${valueClass(value.text)}`, value.text);
    cell.title = value.text;
    return cell;
  }

  private note(text: string): HTMLElement {
    return this.span('heap-note', text, 'div');
  }

  private span(className: string, text: string, tag = 'span'): HTMLElement {
    const el = document.createElement(tag);
    el.className = className;
    el.textContent = text;
    return el;
  }
}
