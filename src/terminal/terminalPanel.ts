/**
 * The terminal panel below the editor (desktop only). Each tab is a program
 * in a pseudo terminal: a shell, or a program the editor started (run in
 * terminal, debugging), which gets its own reusable tab.
 *
 * Terminal emulation is xterm.js, loaded the first time a terminal opens.
 */
import type { FitAddon } from '@xterm/addon-fit';
import type { ITheme, Terminal } from '@xterm/xterm';
import { isAppKeyInTerminal } from '../commands/keys';
import { formatKey, keyFor } from '../commands/registry';
import { platform, type Pty } from '../platform';
import { getSettings, onSettingsChange, updateSettings } from '../settings';
import { showContextMenu } from '../ui/contextMenu';

export type TerminalKind = 'shell' | 'run' | 'debug';

export interface ProgramOptions {
  title: string;
  program: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | null>;
}

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const icons: Record<TerminalKind | 'add' | 'maximize' | 'restore' | 'hide', string> = {
  shell: svg('<path d="m5 8 4 4-4 4M12 17h7"/>'),
  run: svg('<path d="M7 5v14l11-7z" fill="currentColor" stroke="none"/>'),
  debug: svg('<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M9 8a3 3 0 0 1 6 0M12 12v8M3 13h4M17 13h4M4 7l3 2M20 7l-3 2M4 20l3-2M20 20l-3-2"/>'),
  add: svg('<path d="M12 5v14M5 12h14"/>'),
  maximize: svg('<path d="m6 15 6-6 6 6"/>'),
  restore: svg('<path d="m6 9 6 6 6-6"/>'),
  hide: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
};

type Xterm = { Terminal: typeof Terminal; FitAddon: typeof FitAddon };
let xtermModule: Promise<Xterm> | null = null;
function loadXterm(): Promise<Xterm> {
  xtermModule ??= Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
    import('@xterm/xterm/css/xterm.css'),
  ]).then(([xterm, fit]) => ({ Terminal: xterm.Terminal, FitAddon: fit.FitAddon }));
  return xtermModule;
}

/** Terminal colours from the CSS variables (styles.css), so they follow the theme. */
function themeFromCss(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const ansi = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;
  const theme: ITheme = {
    background: v('--bg'),
    foreground: v('--fg'),
    cursor: v('--accent'),
    cursorAccent: v('--bg'),
    selectionBackground: v('--selection'),
  };
  for (const name of ansi) {
    const bright = `bright${name[0].toUpperCase()}${name.slice(1)}` as keyof ITheme;
    (theme as Record<string, string>)[name] = v(`--term-${name}`);
    (theme as Record<string, string>)[bright] = v(`--term-bright-${name}`);
  }
  return theme;
}

/** "powershell.exe" -> "PowerShell". */
function shellName(program: string): string {
  const base = program.split(/[\\/]/).pop()!.replace(/\.exe$/i, '');
  if (/^(powershell|pwsh)$/i.test(base)) return 'PowerShell';
  if (/^cmd$/i.test(base)) return 'Kommandolinje';
  if (/^bash$/i.test(base)) return 'Bash';
  return base;
}

const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

export class TerminalTab {
  readonly element = document.createElement('div');
  title: string;
  pty: Pty | null = null;
  running = false;
  /** Bumped per started process, so a late exit from an old one is ignored. */
  private generation = 0;
  private exitListeners = new Set<(code: number | null) => void>();
  private term!: Terminal;
  private fitAddon!: FitAddon;

  constructor(
    readonly kind: TerminalKind,
    title: string,
    private panel: TerminalPanel,
  ) {
    this.title = title;
    this.element.className = 'terminal-view';
  }

  /** Create the xterm instance (the element must be in the page and visible). */
  async init(): Promise<void> {
    const { Terminal, FitAddon } = await loadXterm();
    const settings = getSettings();
    this.term = new Terminal({
      fontFamily: settings.monoFontFamily,
      fontSize: settings.terminal.fontSize,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 5000,
      // Keeps every ANSI colour readable on both light and dark backgrounds.
      minimumContrastRatio: 4.5,
      theme: themeFromCss(),
      windowsPty: { backend: 'conpty', buildNumber: 22000 },
    });
    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(this.element);
    this.fit();

    this.term.onData((data) => {
      if (this.running) this.pty?.write(data);
    });
    this.term.onResize(({ cols, rows }) => this.pty?.resize(cols, rows));
    this.term.attachCustomKeyEventHandler((e) => this.handleKey(e));
    this.element.addEventListener('contextmenu', (e) => this.showMenu(e));
  }

  private handleKey(e: KeyboardEvent): boolean {
    if (e.type !== 'keydown') return true;
    // Function keys (debugging), tab switching and Ctrl+J belong to the app.
    if (isAppKeyInTerminal(e)) return false;
    const ctrlOnly = e.ctrlKey && !e.altKey && !e.metaKey;
    const key = e.key.toLowerCase();
    // Ctrl+C copies when text is selected (otherwise it stops the program, as usual).
    if (ctrlOnly && key === 'c' && (e.shiftKey || this.term.hasSelection())) {
      e.preventDefault();
      this.copy();
      return false;
    }
    // Ctrl+V: let the browser paste; xterm picks up the paste event.
    if (ctrlOnly && key === 'v') return false;
    return true;
  }

  private copy(): void {
    const text = this.term.getSelection();
    if (text) void navigator.clipboard.writeText(text).catch(() => {});
    this.term.clearSelection();
  }

  private async paste(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (text) this.term.paste(text);
    } catch {
      this.print('Lim inn med Ctrl+V', 'dim');
    }
    this.term.focus();
  }

  private showMenu(e: MouseEvent): void {
    showContextMenu(e, [
      { label: 'Kopier', action: () => this.copy(), disabled: !this.term.hasSelection() },
      { label: 'Lim inn', action: () => void this.paste(), disabled: !this.running },
      { label: 'Merk alt', action: () => this.term.selectAll() },
      { label: 'Tøm', action: () => this.term.clear() },
      'separator',
      ...(this.running ? [{ label: 'Stopp programmet', action: () => this.kill() }] : []),
      { label: 'Lukk terminalen', action: () => this.panel.close(this) },
    ]);
  }

  /** Start a program in this tab (stopping whatever ran here before). */
  async start(options: ProgramOptions): Promise<Pty> {
    const generation = ++this.generation;
    if (this.running) this.pty?.kill();
    this.running = false;
    this.pty = null;
    if (generation > 1) this.term.reset();
    this.fit();
    const processes = platform.processes!;
    try {
      this.pty = await processes.spawnPty(
        { ...options, cols: this.term.cols, rows: this.term.rows },
        {
          onData: (data) => {
            if (generation === this.generation) this.term.write(data);
          },
          onExit: (code) => {
            if (generation !== this.generation) return;
            this.running = false;
            for (const fn of this.exitListeners) fn(code);
            this.panel.exited(this, code);
          },
        },
      );
    } catch (err) {
      this.print(String(err), 'error');
      throw err;
    }
    this.running = true;
    this.panel.render();
    return this.pty;
  }

  /** Called with the exit code whenever the program in this tab ends. */
  onExit(fn: (code: number | null) => void): () => void {
    this.exitListeners.add(fn);
    return () => this.exitListeners.delete(fn);
  }

  /** A message from the editor (not from the program). */
  print(text: string, style: 'dim' | 'error' = 'dim'): void {
    const color = style === 'error' ? RED : DIM;
    this.term.write(`\r\n${color}${text.replace(/\r?\n/g, '\r\n')}${RESET}\r\n`);
  }

  /** Raw output from the debugger etc. */
  write(text: string): void {
    this.term.write(text.replace(/\r?\n/g, '\r\n'));
  }

  kill(): void {
    if (this.running) this.pty?.kill();
  }

  fit(): void {
    if (!this.term || this.element.offsetParent === null) return;
    try {
      this.fitAddon.fit();
    } catch {
      // Not measurable yet.
    }
  }

  focus(): void {
    this.term?.focus();
  }

  setTheme(): void {
    if (this.term) this.term.options.theme = themeFromCss();
  }

  applySettings(): void {
    if (!this.term) return;
    const settings = getSettings();
    this.term.options.fontFamily = settings.monoFontFamily;
    this.term.options.fontSize = settings.terminal.fontSize;
    this.fit();
  }

  dispose(): void {
    this.generation++;
    this.kill();
    this.exitListeners.clear();
    this.term?.dispose();
    this.element.remove();
  }
}

export interface TerminalPanelHost {
  /** Folder new terminals start in (the active document's). */
  cwd(): string | undefined;
  /** The panel was shown or hidden. */
  onVisibilityChange(): void;
  /** Give the focus back to the editor (when the focused terminal is hidden). */
  focusEditor(): void;
}

export class TerminalPanel {
  tabs: TerminalTab[] = [];
  active: TerminalTab | null = null;
  private byKey = new Map<string, TerminalTab>();
  private tabBar = document.createElement('div');
  private body = document.createElement('div');
  private maximizeButton = document.createElement('button');
  private hideButton: HTMLButtonElement;
  private maximized = false;

  constructor(
    private root: HTMLElement,
    private host: TerminalPanelHost,
  ) {
    this.tabBar.className = 'panel-tabs';
    this.tabBar.setAttribute('role', 'tablist');
    this.body.className = 'panel-body';

    const head = document.createElement('div');
    head.className = 'panel-head';
    const actions = document.createElement('div');
    actions.className = 'panel-actions';
    this.hideButton = this.iconButton(icons.hide, 'Skjul terminalen', () => this.hide());
    actions.append(this.iconButton(icons.add, 'Ny terminal', () => void this.newShell()), this.maximizeButton, this.hideButton);
    this.maximizeButton.className = 'panel-button';
    this.maximizeButton.type = 'button';
    this.maximizeButton.addEventListener('click', () => this.setMaximized(!this.maximized));
    head.append(this.tabBar, actions);

    const resizer = document.createElement('div');
    resizer.className = 'panel-resizer';
    resizer.title = 'Dra for å endre høyden';
    resizer.addEventListener('pointerdown', (e) => this.startResize(e));

    root.replaceChildren(resizer, head, this.body);
    this.applyHeight();
    this.setMaximized(false);

    // Fit in the next frame: resizing inside the observer callback would trigger it again.
    new ResizeObserver(() => requestAnimationFrame(() => this.active?.fit())).observe(this.body);
    // Follow light/dark theme and font settings.
    new MutationObserver(() => this.tabs.forEach((t) => t.setTheme())).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    onSettingsChange((next, prev) => {
      if (next.terminal !== prev.terminal || next.monoFontFamily !== prev.monoFontFamily) {
        this.applyHeight();
        this.tabs.forEach((t) => t.applySettings());
      }
    });
  }

  /** Terminals need the desktop app. */
  get available(): boolean {
    return !!platform.processes;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  /** Show the panel (opening a shell if there's none) and focus the terminal. */
  async show(): Promise<void> {
    if (!this.available) return;
    this.setVisible(true);
    if (this.tabs.length === 0) await this.newShell();
    else this.active?.focus();
  }

  hide(): void {
    this.setVisible(false);
  }

  toggle(): void {
    if (this.visible) this.hide();
    else void this.show();
  }

  private setVisible(visible: boolean): void {
    if (this.root.hidden === !visible) return;
    const hadFocus = this.root.contains(document.activeElement);
    this.root.hidden = !visible;
    if (visible) {
      const key = keyFor('view.toggleTerminal');
      this.hideButton.title = `Skjul terminalen${key ? ` (${formatKey(key)})` : ''}`;
      requestAnimationFrame(() => this.active?.fit());
    } else if (hadFocus) {
      this.host.focusEditor();
    }
    this.host.onVisibilityChange();
  }

  /** A new shell tab in the active document's folder. */
  async newShell(): Promise<TerminalTab | null> {
    if (!this.available) return null;
    const { shell, shellArgs } = getSettings().terminal;
    const name = shellName(shell);
    const same = this.tabs.filter((t) => t.kind === 'shell').length;
    const tab = await this.addTab('shell', same ? `${name} ${same + 1}` : name);
    try {
      await tab.start({ title: name, program: shell, args: shellArgs, cwd: this.host.cwd() });
    } catch {
      // The error is shown in the tab.
    }
    return tab;
  }

  /**
   * Run a program in its own tab. Tabs are reused by `key` ("run", "debug"),
   * stopping what ran there before.
   */
  async runProgram(kind: TerminalKind, key: string, options: ProgramOptions): Promise<TerminalTab> {
    this.setVisible(true);
    let tab = this.byKey.get(key);
    if (tab && this.tabs.includes(tab)) {
      tab.title = options.title;
      this.activate(tab);
    } else {
      tab = await this.addTab(kind, options.title);
      this.byKey.set(key, tab);
    }
    await tab.start(options);
    return tab;
  }

  private async addTab(kind: TerminalKind, title: string): Promise<TerminalTab> {
    this.setVisible(true);
    const tab = new TerminalTab(kind, title, this);
    this.tabs.push(tab);
    this.body.append(tab.element);
    this.activate(tab);
    await tab.init();
    tab.focus();
    return tab;
  }

  activate(tab: TerminalTab): void {
    this.active = tab;
    for (const t of this.tabs) t.element.hidden = t !== tab;
    this.render();
    requestAnimationFrame(() => {
      tab.fit();
      tab.focus();
    });
  }

  close(tab: TerminalTab): void {
    const index = this.tabs.indexOf(tab);
    if (index < 0) return;
    this.tabs.splice(index, 1);
    for (const [key, t] of this.byKey) if (t === tab) this.byKey.delete(key);
    tab.dispose();
    if (this.active === tab) this.active = this.tabs[Math.min(index, this.tabs.length - 1)] ?? null;
    if (this.active) this.activate(this.active);
    else this.hide();
    this.render();
  }

  /** A program ended: shells close their tab, other programs leave their output. */
  exited(tab: TerminalTab, code: number | null): void {
    if (tab.kind === 'shell') return this.close(tab);
    const text = code === null ? 'Programmet ble stoppet' : `Programmet avsluttet med kode ${code}`;
    tab.print(`[${text}]`, code === 0 || code === null ? 'dim' : 'error');
    this.render();
  }

  render(): void {
    this.tabBar.replaceChildren(
      ...this.tabs.map((tab) => {
        const el = document.createElement('div');
        el.className = `panel-tab${tab === this.active ? ' active' : ''}${tab.running ? ' running' : ''}`;
        el.setAttribute('role', 'tab');
        el.setAttribute('aria-selected', String(tab === this.active));
        el.title = tab.running || tab.kind === 'shell' ? tab.title : `${tab.title} (avsluttet)`;
        const icon = document.createElement('span');
        icon.className = 'panel-tab-icon';
        icon.innerHTML = icons[tab.kind];
        const label = document.createElement('span');
        label.className = 'panel-tab-label';
        label.textContent = tab.title;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'tab-close';
        close.textContent = '✕';
        close.title = tab.running ? 'Stopp og lukk' : 'Lukk';
        close.addEventListener('click', (e) => {
          e.stopPropagation();
          this.close(tab);
        });
        el.append(icon, label, close);
        el.addEventListener('click', () => this.activate(tab));
        el.addEventListener('auxclick', (e) => {
          if (e.button === 1) this.close(tab);
        });
        return el;
      }),
    );
  }

  private iconButton(icon: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-button';
    button.innerHTML = icon;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', onClick);
    return button;
  }

  private setMaximized(maximized: boolean): void {
    this.maximized = maximized;
    this.root.classList.toggle('maximized', maximized);
    this.maximizeButton.innerHTML = maximized ? icons.restore : icons.maximize;
    this.maximizeButton.title = maximized ? 'Vanlig størrelse' : 'Større terminal';
    this.maximizeButton.setAttribute('aria-label', this.maximizeButton.title);
    requestAnimationFrame(() => this.active?.fit());
  }

  private applyHeight(): void {
    this.root.style.setProperty('--panel-height', `${getSettings().terminal.height}px`);
  }

  /** Drag the top edge to change the height (saved in settings). */
  private startResize(e: PointerEvent): void {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startHeight = this.root.getBoundingClientRect().height;
    const max = (this.root.parentElement?.getBoundingClientRect().height ?? 800) - 80;
    let height = startHeight;
    if (this.maximized) this.setMaximized(false);
    const move = (ev: PointerEvent) => {
      height = Math.round(Math.max(120, Math.min(max, startHeight + startY - ev.clientY)));
      this.root.style.setProperty('--panel-height', `${height}px`);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      if (height !== startHeight) updateSettings({ terminal: { height } });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }
}
