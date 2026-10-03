/**
 * The debug view in the sidebar while a debug session runs: buttons
 * (continue, step, step back, stop), highlighted variables, variables,
 * call stack and watched expressions. Big click targets; everything also has
 * a keyboard shortcut.
 */
import type { EditorView } from '@codemirror/view';
import { describeCommand, formatKey, keyFor, runCommand } from '../commands/registry';
import type { DebugController } from '../debug/controller';
import { isNameChain, variableKey } from '../debug/history';
import { samePath, type Variable } from '../debug/types';

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
export const debugIcons = {
  start: svg('<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M9 8a3 3 0 0 1 6 0M12 12v8M3 13h4M17 13h4M4 7l3 2M20 7l-3 2M4 20l3-2M20 20l-3-2"/>'),
  continue: svg('<path d="M6 5v14l12-7z" fill="currentColor"/>'),
  pause: svg('<path d="M8 5v14M16 5v14" stroke-width="3"/>'),
  stepBack: svg('<path d="M20 13a8 8 0 0 0-15-4"/><path d="M4 4v5h5"/><circle cx="12" cy="19" r="2" fill="currentColor"/>'),
  stepOver: svg('<path d="M4 13a8 8 0 0 1 15-4"/><path d="M20 4v5h-5"/><circle cx="12" cy="19" r="2" fill="currentColor"/>'),
  stepInto: svg('<path d="M12 3v11"/><path d="m7 10 5 5 5-5"/><circle cx="12" cy="20" r="2" fill="currentColor"/>'),
  stepOut: svg('<path d="M12 16V4"/><path d="m7 8 5-5 5 5"/><circle cx="12" cy="20" r="2" fill="currentColor"/>'),
  present: svg('<path d="M5 5v14l10-7z" fill="currentColor"/><path d="M19 5v14" stroke-width="3"/>'),
  restart: svg('<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>'),
};

const STAR = 'M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z';
const starIcon = (filled: boolean) => svg(`<path d="${STAR}"${filled ? ' fill="currentColor"' : ''}/>`);

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
  if (c.inPast) return 'Tilbakeblikk';
  if (c.finished) return 'Programmet er ferdig';
  const reason = c.stop?.reason;
  if (reason === 'exception') return 'Stoppet: feil i programmet';
  if (reason === 'breakpoint') return 'Stoppet ved stoppunkt';
  if (reason === 'entry') return 'Stoppet ved start';
  return reason === 'pause' ? 'Satt på pause' : 'Stoppet';
}

/** Rough type of a value, for colouring. */
function valueClass(v: Variable): string {
  const value = v.value.trim();
  if (/^(['"]).*\1$/s.test(value)) return 'str';
  if (/^-?\d[\d_.e+-]*j?$/i.test(value) || /^(True|False|true|false|None|null|undefined|NaN|-?Infinity)$/.test(value)) return 'num';
  return '';
}

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** "Navn (F10)" with the user's own shortcut for the command. */
function withKey(text: string, id: string): string {
  const key = keyFor(id);
  return key ? `${text} (${formatKey(key)})` : text;
}

export class DebugPanel {
  /** Expanded variables by path ("Lokale/liste/0"), kept while stepping. */
  private expanded = new Set<string>();
  /** Things open by default that the user closed. */
  private collapsed = new Set<string>();
  private evalInput = document.createElement('input');
  private renderQueued = false;
  /** Variables changed since the stop before, for this render. */
  private changed = new Set<string>();

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
    this.container.hidden = !c.visible;
    if (!c.visible) return;
    const scrollTop = this.container.scrollTop;
    this.changed = c.changedVariables();

    const header = document.createElement('div');
    header.className = 'sidebar-header';
    const title = document.createElement('h2');
    title.textContent = 'Feilsøking';
    header.append(title);

    const status = document.createElement('div');
    status.className = `debug-status ${c.status ?? 'finished'}${c.inPast ? ' past' : ''}`;
    status.textContent = `${reasonText(c)} · ${c.name}`;

    const parts: HTMLElement[] = [header, status, this.controls()];
    if (c.inPast) parts.push(this.pastBanner());
    if (c.stop?.reason === 'exception' && c.stop.text) {
      const box = document.createElement('div');
      box.className = 'debug-exception';
      box.textContent = c.stop.text;
      parts.push(box);
    }
    if (c.status === 'paused' || c.inPast) {
      if (c.pins.length) parts.push(this.heading('Fremhevet'), this.pinned());
      parts.push(this.heading('Variabler'));
      if (!c.pins.length) parts.push(this.hint(`Trykk ☆ ved en variabel for å fremheve den – eller sett markøren på den i koden og trykk ${formatKey(keyFor('debug.pin') ?? 'Shift-F9')}.`));
      parts.push(this.variables());
      parts.push(this.heading('Kallstakk'), this.stack());
    } else if (c.status === 'running') {
      parts.push(this.hint('Programmet kjører. Det stopper ved stoppunktene (røde prikker). Klikk på et linjenummer for å sette et stoppunkt.'));
    } else if (c.finished) {
      parts.push(this.finishedBox());
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
    const past = c.inPast;
    // Icon and a word on every button: the arrows alone are easy to mix up.
    const button = (id: string, icon: string, label: string, enabled: boolean, extra = '', title = describeCommand(id)) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `debug-button ${extra}`;
      b.innerHTML = icon;
      b.append(this.text('debug-button-label', label));
      b.title = title;
      b.disabled = !enabled;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => runCommand(this.getView(), id));
      row.append(b);
    };
    // First row: back and forward through the program, side by side, then continue.
    button('debug.stepBack', debugIcons.stepBack, 'Tilbake', c.canStepBack, 'wide back');
    const forward = withKey('Fram ett steg', 'debug.stepOver');
    button('debug.stepOver', debugIcons.stepOver, past ? 'Fram' : 'Neste linje', paused || past, 'wide', past ? forward : undefined);
    if (past) button('debug.continue', debugIcons.present, 'Til nå', true, 'wide primary', withKey(c.finished ? 'Til slutten' : 'Tilbake til nå', 'debug.continue'));
    else if (c.status === 'running') button('debug.pause', debugIcons.pause, 'Pause', true, 'wide');
    else button('debug.continue', debugIcons.continue, 'Fortsett', paused, 'wide primary');
    // Second row: into and out of functions, start again, stop.
    button('debug.stepInto', debugIcons.stepInto, 'Gå inn', paused && !past);
    const outTitle = paused && !past && !c.canStepOut ? `${describeCommand('debug.stepOut')} – programmet er ikke inne i en funksjon nå` : undefined;
    button('debug.stepOut', debugIcons.stepOut, 'Gå ut', c.canStepOut, '', outTitle);
    button('debug.restart', debugIcons.restart, 'På nytt', true);
    button('debug.stop', debugIcons.stop, c.finished ? 'Lukk' : 'Stopp', true, 'danger', c.finished ? withKey('Lukk feilsøkingen', 'debug.stop') : undefined);
    return row;
  }

  /** Stepping back: say clearly that this is how things were, not where the program is. */
  private pastBanner(): HTMLElement {
    const c = this.debug;
    const box = document.createElement('div');
    box.className = 'debug-past';
    const title = document.createElement('div');
    title.className = 'debug-past-title';
    title.textContent = `Tilbakeblikk – steg ${c.stepNumber} av ${c.history.length}`;
    const text = document.createElement('p');
    const now = c.presentFrame;
    const where = now ? ` på linje ${now.line}${now.path && !samePath(now.path, c.frame?.path) ? ` i ${baseName(now.path)}` : ''}` : '';
    const forward = keyFor('debug.stepOver');
    text.textContent =
      (c.finished ? 'Slik var det da (programmet er ferdig nå). ' : `Slik var det da. Programmet er ikke spolt tilbake – det står fortsatt${where}. `) +
      `Endrede variabler er markert.${forward ? ` ${formatKey(forward)} går ett steg fram.` : ''}`;
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'debug-past-button';
    back.textContent = withKey(c.finished ? 'Til slutten' : 'Tilbake til nå', 'debug.continue');
    back.addEventListener('mousedown', (e) => e.preventDefault());
    back.addEventListener('click', () => c.toPresent());
    box.append(title, text, back);
    return box;
  }

  /** The program has ended: the stops are still there to look back at. */
  private finishedBox(): HTMLElement {
    const c = this.debug;
    const n = c.history.length;
    const box = document.createElement('div');
    box.className = 'debug-past debug-finished';
    const title = document.createElement('div');
    title.className = 'debug-past-title';
    title.textContent = 'Programmet er ferdig';
    const text = document.createElement('p');
    text.textContent =
      n === 1 ? 'Du kan fortsatt gå tilbake til stoppet og se hvordan det var.' : `Du kan fortsatt gå tilbake gjennom de ${n} stoppene og se hvordan det var.`;
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'debug-past-button';
    back.textContent = withKey('Se tilbake', 'debug.stepBack');
    back.addEventListener('mousedown', (e) => e.preventDefault());
    back.addEventListener('click', () => c.stepBack());
    box.append(title, text, back);
    return box;
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

  /** Star: highlight a variable (or expression), or stop highlighting it. */
  private pinButton(expression: string): HTMLButtonElement {
    const pin = this.debug.pinFor(expression);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `debug-pin-button${pin ? ` on pin-c${pin.color}` : ''}`;
    b.innerHTML = starIcon(!!pin);
    b.title = pin ? `Ikke fremhev ${expression} lenger` : `Fremhev ${expression}`;
    b.setAttribute('aria-label', b.title);
    b.setAttribute('aria-pressed', String(!!pin));
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.debug.togglePin(expression);
    });
    return b;
  }

  /** The highlighted variables: big, in their colour, marked when they just changed. */
  private pinned(): HTMLElement {
    const c = this.debug;
    const list = document.createElement('div');
    list.className = 'debug-pinned';
    for (const { pin, result, changed } of c.pinStates()) {
      const card = document.createElement('div');
      card.className = `debug-pin-card pin-c${pin.color}${changed ? ' changed' : ''}`;
      const head = document.createElement('div');
      head.className = 'debug-pin-head';
      head.append(this.text('debug-pin-name', pin.expression));
      if (changed) head.append(this.text('debug-pin-badge', 'endret'));
      head.append(this.pinButton(pin.expression));
      const v = result?.value;
      let value: HTMLElement;
      if (v) value = this.text(`debug-pin-value ${valueClass(v)}`, v.value);
      else if (result?.error) {
        // A name that doesn't exist here (another function) isn't an error worth showing.
        value = isNameChain(pin.expression)
          ? this.text('debug-pin-value missing', 'finnes ikke her')
          : this.text('debug-pin-value error', result.error);
      } else {
        value = this.text('debug-pin-value missing', c.inPast ? 'ikke kjent ved dette steget' : 'henter …');
      }
      card.title = v ? `${pin.expression} = ${v.value}${v.type ? ` (${v.type})` : ''}` : pin.expression;
      card.append(head, value);
      list.append(card);
    }
    return list;
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
      // Earlier stops only have the variables of the function that was shown then.
      b.disabled = !frame.path || (c.inPast && i !== c.frameIndex);
      b.addEventListener('click', () => c.selectFrame(i));
      item.append(b);
      list.append(item);
    });
    return list;
  }

  private variables(): HTMLElement {
    const c = this.debug;
    const tree = document.createElement('div');
    tree.className = 'debug-vars';
    if (!c.loaded) {
      tree.append(this.hint(c.inPast ? 'Variablene ble ikke hentet ved dette steget (du gikk videre før de kom).' : 'Henter variabler …'));
      return tree;
    }
    for (const { scope, variables } of c.scopes) {
      const name = SCOPE_NAMES[scope.name] ?? scope.name;
      const path = `scope:${name}`;
      const byDefault = !scope.collapsed;
      const open = this.isOpen(path, byDefault);
      const row = this.row(0, true, open, () => this.toggle(path, byDefault));
      row.classList.add('scope');
      row.append(this.text('debug-var-name', name));
      tree.append(row);
      if (!open) continue;
      const vars = variables ?? c.childrenOf(scope.ref);
      if (vars === null) tree.append(this.loadingRow(1));
      else if (vars === undefined) tree.append(this.notFetchedRow(1));
      else if (vars.length === 0) tree.append(this.emptyRow(1));
      else for (const v of ordered(vars)) this.addVariable(tree, v, 1, `${path}/${v.name}`, scope.name);
    }
    return tree;
  }

  private addVariable(tree: HTMLElement, v: Variable, depth: number, path: string, scope?: string): void {
    const canExpand = v.ref > 0;
    const open = canExpand && this.isOpen(path);
    const row = this.row(depth, canExpand, open, () => this.toggle(path));
    if (isGroup(v)) {
      row.classList.add('group');
      row.append(this.text('debug-var-name', GROUP_NAMES[v.name]));
    } else {
      const changed = depth === 1 && scope !== undefined && this.changed.has(variableKey(scope, v.name));
      row.title = `${v.name} = ${v.value}${v.type ? ` (${v.type})` : ''}${changed ? ' – nettopp endret' : ''}`;
      row.append(this.text('debug-var-name', v.name), this.text('debug-var-sep', '='), this.text(`debug-var-value ${valueClass(v)}`, v.value));
      if (changed) row.classList.add('changed');
      // Top-level variables are highlighted by name; debugpy and Node also say how to reach the others.
      const expression = v.evaluateName ?? (scope !== undefined ? v.name : undefined);
      if (expression) {
        const pin = this.debug.pinFor(expression);
        if (pin) row.classList.add('pinned', `pin-c${pin.color}`);
        row.append(this.pinButton(expression));
      }
    }
    tree.append(row);
    if (!open) return;
    const children = this.debug.childrenOf(v.ref);
    if (children === null) tree.append(this.loadingRow(depth + 1));
    else if (children === undefined) tree.append(this.notFetchedRow(depth + 1));
    else if (children.length === 0) tree.append(this.emptyRow(depth + 1));
    else for (const child of ordered(children).slice(0, 500)) this.addVariable(tree, child, depth + 1, `${path}/${child.name}`);
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

  /** Stepping back to a stop where this wasn't opened: its contents weren't fetched then. */
  private notFetchedRow(depth: number): HTMLElement {
    const row = this.row(depth, false, false, () => {});
    row.append(this.text('debug-var-empty', '(ble ikke åpnet ved dette steget)'));
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
      else row.append(this.text('debug-var-empty', c.inPast ? 'ikke regnet ut da' : c.status === 'paused' ? 'regner ut …' : '—'));
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
      row.append(this.pinButton(expression), remove);
      tree.append(row);
      if (open && v) {
        const children = c.childrenOf(v.ref);
        if (children === null) tree.append(this.loadingRow(1));
        else if (children === undefined) tree.append(this.notFetchedRow(1));
        else for (const child of children.slice(0, 500)) this.addVariable(tree, child, 1, `${path}/${child.name}`);
      }
    }
    return tree;
  }
}
