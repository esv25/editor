/**
 * The debug view in the sidebar while a debug session runs: buttons
 * (continue, step, stop), call stack, variables and watched expressions.
 * Big click targets; everything also has a keyboard shortcut.
 */
import type { EditorView } from '@codemirror/view';
import { describeCommand, runCommand } from '../commands/registry';
import type { DebugController } from '../debug/controller';
import type { Variable } from '../debug/types';

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
export const debugIcons = {
  start: svg('<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M9 8a3 3 0 0 1 6 0M12 12v8M3 13h4M17 13h4M4 7l3 2M20 7l-3 2M4 20l3-2M20 20l-3-2"/>'),
  continue: svg('<path d="M6 5v14l12-7z" fill="currentColor"/>'),
  pause: svg('<path d="M8 5v14M16 5v14" stroke-width="3"/>'),
  stepOver: svg('<path d="M4 13a8 8 0 0 1 15-4"/><path d="M20 4v5h-5"/><circle cx="12" cy="19" r="2" fill="currentColor"/>'),
  stepInto: svg('<path d="M12 3v11"/><path d="m7 10 5 5 5-5"/><circle cx="12" cy="20" r="2" fill="currentColor"/>'),
  stepOut: svg('<path d="M12 16V4"/><path d="m7 8 5-5 5 5"/><circle cx="12" cy="20" r="2" fill="currentColor"/>'),
  restart: svg('<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>'),
};

const SCOPE_NAMES: Record<string, string> = { Locals: 'Lokale', Globals: 'Globale' };

/** Groups debugpy puts among the variables; shown last, in Norwegian. */
const GROUP_NAMES: Record<string, string> = {
  'special variables': 'spesielle variabler',
  'function variables': 'funksjoner',
  'class variables': 'klassevariabler',
  'protected variables': 'skjulte variabler',
};
const isGroup = (v: Variable) => v.value === '' && v.ref > 0 && v.name in GROUP_NAMES;

/** Ordinary variables first, debugpy's groups last. */
const ordered = (vars: Variable[]) => [...vars.filter((v) => !isGroup(v)), ...vars.filter(isGroup)];

function reasonText(c: DebugController): string {
  if (c.status === 'starting') return 'Starter …';
  if (c.status === 'running') return 'Kjører …';
  const reason = c.stop?.reason;
  if (reason === 'exception') return 'Stoppet: feil i programmet';
  if (reason === 'breakpoint') return 'Stoppet ved stoppunkt';
  if (reason === 'entry') return 'Stoppet ved start';
  return c.lastAction === 'pause' ? 'Satt på pause' : 'Stoppet';
}

/** Rough type of a value, for colouring. */
function valueClass(v: Variable): string {
  const value = v.value.trim();
  if (/^(['"]).*\1$/s.test(value)) return 'str';
  if (/^-?\d[\d_.e+-]*j?$/i.test(value) || /^(True|False|true|false|None|null|undefined|NaN|-?Infinity)$/.test(value)) return 'num';
  return '';
}

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export class DebugPanel {
  /** Expanded variables by path ("Lokale/liste/0"), kept while stepping. */
  private expanded = new Set<string>();
  /** Things open by default that the user closed. */
  private collapsed = new Set<string>();
  private children = new Map<number, Variable[]>();
  private loading = new Set<number>();
  private childrenStop = -1;
  private evalInput = document.createElement('input');
  private renderQueued = false;

  constructor(
    private container: HTMLElement,
    private debug: DebugController,
    private getView: () => EditorView,
  ) {
    this.evalInput.type = 'text';
    this.evalInput.className = 'debug-eval';
    this.evalInput.placeholder = 'Skriv et uttrykk + Enter';
    this.evalInput.spellcheck = false;
    this.evalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        debug.addWatch(this.evalInput.value);
        this.evalInput.value = '';
      } else if (e.key === 'Escape') {
        this.getView().focus();
      }
    });
    debug.onChange(() => this.queueRender());
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
    this.container.hidden = !c.active;
    if (!c.active) return;
    if (this.childrenStop !== c.stopId) {
      this.children.clear();
      this.loading.clear();
      this.childrenStop = c.stopId;
    }
    const scrollTop = this.container.scrollTop;

    const header = document.createElement('div');
    header.className = 'sidebar-header';
    const title = document.createElement('h2');
    title.textContent = 'Feilsøking';
    header.append(title);

    const status = document.createElement('div');
    status.className = `debug-status ${c.status}`;
    status.textContent = `${reasonText(c)} · ${c.name}`;

    const parts: HTMLElement[] = [header, status, this.controls()];
    if (c.stop?.reason === 'exception' && c.stop.text) {
      const box = document.createElement('div');
      box.className = 'debug-exception';
      box.textContent = c.stop.text;
      parts.push(box);
    }
    if (c.status === 'paused') {
      parts.push(this.heading('Variabler'), this.variables());
      parts.push(this.heading('Kallstakk'), this.stack());
    } else if (c.status === 'running') {
      parts.push(this.hint('Programmet kjører. Det stopper ved stoppunktene (røde prikker). Klikk på et linjenummer for å sette et stoppunkt.'));
    }
    parts.push(this.heading('Uttrykk'), this.evalInput, this.watches());
    const focused = document.activeElement === this.evalInput;
    this.container.replaceChildren(...parts);
    if (focused) this.evalInput.focus();
    this.container.scrollTop = scrollTop;
  }

  private controls(): HTMLElement {
    const c = this.debug;
    const row = document.createElement('div');
    row.className = 'debug-controls';
    const paused = c.status === 'paused';
    const button = (id: string, icon: string, enabled: boolean, extra = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `debug-button ${extra}`;
      b.innerHTML = icon;
      b.title = describeCommand(id);
      b.setAttribute('aria-label', b.title);
      b.disabled = !enabled;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => runCommand(this.getView(), id));
      row.append(b);
    };
    if (paused) button('debug.continue', debugIcons.continue, true, 'primary');
    else button('debug.pause', debugIcons.pause, c.status === 'running');
    button('debug.stepOver', debugIcons.stepOver, paused);
    button('debug.stepInto', debugIcons.stepInto, paused);
    button('debug.stepOut', debugIcons.stepOut, paused);
    button('debug.restart', debugIcons.restart, true);
    button('debug.stop', debugIcons.stop, true, 'danger');
    return row;
  }

  private heading(text: string): HTMLElement {
    const h = document.createElement('h3');
    h.className = 'debug-heading';
    h.textContent = text;
    return h;
  }

  private hint(text: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'sidebar-hint';
    p.textContent = text;
    return p;
  }

  private stack(): HTMLElement {
    const c = this.debug;
    const list = document.createElement('ol');
    list.className = 'debug-stack';
    c.frames.forEach((frame, i) => {
      const item = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `debug-frame${i === c.frameIndex ? ' active' : ''}${frame.path ? '' : ' external'}`;
      const name = document.createElement('span');
      name.className = 'debug-frame-name';
      name.textContent = frame.name;
      const where = document.createElement('span');
      where.className = 'debug-frame-where';
      where.textContent = frame.path ? `${baseName(frame.path)}:${frame.line}` : '';
      b.title = frame.path ? `${frame.path}, linje ${frame.line}` : frame.name;
      b.append(name, where);
      b.disabled = !frame.path;
      b.addEventListener('click', () => c.selectFrame(i));
      item.append(b);
      list.append(item);
    });
    return list;
  }

  private variables(): HTMLElement {
    const tree = document.createElement('div');
    tree.className = 'debug-vars';
    const { scopes } = this.debug;
    if (scopes.length === 0) {
      tree.append(this.hint('Henter variabler …'));
      return tree;
    }
    for (const { scope, variables } of scopes) {
      const name = SCOPE_NAMES[scope.name] ?? scope.name;
      const path = `scope:${name}`;
      const byDefault = !scope.collapsed;
      const open = this.isOpen(path, byDefault);
      const row = this.row(0, true, open, () => this.toggle(path, byDefault));
      row.classList.add('scope');
      row.append(this.text('debug-var-name', name));
      tree.append(row);
      if (!open) continue;
      const vars = variables ?? this.childrenOf(scope.ref);
      if (!vars) tree.append(this.loadingRow(1));
      else if (vars.length === 0) tree.append(this.emptyRow(1));
      else for (const v of ordered(vars)) this.addVariable(tree, v, 1, `${path}/${v.name}`);
    }
    return tree;
  }

  private addVariable(tree: HTMLElement, v: Variable, depth: number, path: string): void {
    const canExpand = v.ref > 0;
    const open = canExpand && this.isOpen(path);
    const row = this.row(depth, canExpand, open, () => this.toggle(path));
    if (isGroup(v)) {
      row.classList.add('group');
      row.append(this.text('debug-var-name', GROUP_NAMES[v.name]));
    } else {
      row.title = `${v.name} = ${v.value}${v.type ? ` (${v.type})` : ''}`;
      row.append(this.text('debug-var-name', v.name), this.text('debug-var-sep', '='), this.text(`debug-var-value ${valueClass(v)}`, v.value));
    }
    tree.append(row);
    if (!open) return;
    const children = this.childrenOf(v.ref);
    if (!children) tree.append(this.loadingRow(depth + 1));
    else if (children.length === 0) tree.append(this.emptyRow(depth + 1));
    else for (const child of ordered(children).slice(0, 500)) this.addVariable(tree, child, depth + 1, `${path}/${child.name}`);
  }

  /** Cached children, or null while they're fetched. */
  private childrenOf(ref: number): Variable[] | null {
    const cached = this.children.get(ref);
    if (cached) return cached;
    if (!this.loading.has(ref)) {
      this.loading.add(ref);
      const stopId = this.debug.stopId;
      void this.debug.children(ref).then((vars) => {
        if (stopId !== this.debug.stopId) return;
        this.children.set(ref, vars);
        this.queueRender();
      });
    }
    return null;
  }

  private row(depth: number, canExpand: boolean, open: boolean, onToggle: () => void): HTMLElement {
    const row = document.createElement('div');
    row.className = `debug-var${canExpand ? ' expandable' : ''}`;
    row.style.paddingLeft = `${depth * 14 + 4}px`;
    const chevron = document.createElement('span');
    chevron.className = `debug-chevron${open ? ' open' : ''}`;
    chevron.textContent = canExpand ? '▸' : '';
    row.append(chevron);
    if (canExpand) {
      row.setAttribute('role', 'button');
      row.setAttribute('aria-expanded', String(open));
      row.addEventListener('click', onToggle);
    }
    return row;
  }

  private loadingRow(depth: number): HTMLElement {
    const row = this.row(depth, false, false, () => {});
    row.append(this.text('debug-var-empty', 'henter …'));
    return row;
  }

  private emptyRow(depth: number): HTMLElement {
    const row = this.row(depth, false, false, () => {});
    row.append(this.text('debug-var-empty', '(tom)'));
    return row;
  }

  private text(className: string, text: string): HTMLElement {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  }

  private isOpen(path: string, byDefault = false): boolean {
    return byDefault ? !this.collapsed.has(path) : this.expanded.has(path);
  }

  private toggle(path: string, byDefault = false): void {
    const set = byDefault ? this.collapsed : this.expanded;
    if (set.has(path)) set.delete(path);
    else set.add(path);
    this.render();
  }

  private watches(): HTMLElement {
    const c = this.debug;
    const tree = document.createElement('div');
    tree.className = 'debug-vars debug-watches';
    if (c.watches.length === 0) {
      tree.append(this.hint('Uttrykk du skriver her, regnes ut hver gang programmet stopper.'));
      return tree;
    }
    for (const expression of c.watches) {
      const result = c.watchResults.find((r) => r.expression === expression);
      const path = `watch:${expression}`;
      const v = result?.value;
      const canExpand = !!v && v.ref > 0;
      const open = canExpand && this.isOpen(path);
      const row = this.row(0, canExpand, open, () => this.toggle(path));
      row.append(this.text('debug-var-name', expression), this.text('debug-var-sep', '='));
      if (result?.error) row.append(this.text('debug-var-value error', result.error));
      else if (v) row.append(this.text(`debug-var-value ${valueClass(v)}`, v.value));
      else row.append(this.text('debug-var-empty', c.status === 'paused' ? 'regner ut …' : '—'));
      row.title = result?.error ?? (v ? `${expression} = ${v.value}` : expression);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'debug-watch-remove';
      remove.textContent = '✕';
      remove.title = 'Fjern uttrykket';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        c.removeWatch(expression);
      });
      row.append(remove);
      tree.append(row);
      if (open && v) {
        const children = this.childrenOf(v.ref);
        if (!children) tree.append(this.loadingRow(1));
        else for (const child of children.slice(0, 500)) this.addVariable(tree, child, 1, `${path}/${child.name}`);
      }
    }
    return tree;
  }
}
