/**
 * The math panel: big buttons for every symbol and template, by topic,
 * with a search. Clicking inserts into the open formula (or starts one at
 * the cursor). «Mine» holds the user's favourites and own shortcuts.
 * Right click a button: add to «Mine», or make a shortcut for it.
 *
 * Buttons don't take focus, so the formula being edited stays open.
 */
import katex from 'katex';
import { trust } from '../features/math/render';
import type { EditorView } from '@codemirror/view';
import { categories, itemsById, previewLatex, searchItems, TYPED, type MathItem } from '../features/math/catalog';
import { activeShortcuts, describeKeys, insertMath, registerFocusZone, setSymbolMenu } from '../features/math';
import { getSettings, updateSettings, type Settings } from '../settings';
import { showContextMenu } from './contextMenu';
import { openShortcutEditor, openShortcutManager } from './mathShortcuts';

const MINE = 'mine';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function renderPreview(latex: string): string {
  try {
    return katex.renderToString(latex, { throwOnError: true, strict: 'ignore', trust, output: 'html' });
  } catch {
    return '';
  }
}

/** Preview HTML is the same every time: keep it. */
const previewCache = new Map<string, string>();
function preview(latex: string): string {
  let html = previewCache.get(latex);
  if (html === undefined) {
    html = renderPreview(latex);
    previewCache.set(latex, html);
  }
  return html;
}

/** Tooltip: name, what to type, and the keys. */
export function describeItem(it: MathItem, settings: Settings = getSettings()): string {
  const lines = [it.name];
  const typed: string[] = [];
  if (TYPED[it.id]) typed.push(TYPED[it.id]);
  for (const [trigger, value] of activeShortcuts()) if (value === it.latex && it.latex) typed.push(trigger);
  if (typed.length) lines.push(`Skriv: ${typed.join('  ·  ')}`);
  const keys = Object.entries(settings.math.keys).filter(([, v]) => v && v === (it.action ? '@' + it.action : it.latex));
  if (keys.length) lines.push(`Hurtigtast: ${keys.map(([k]) => describeKeys(k)).join('  ·  ')}`);
  return lines.join('\n');
}

export class MathPanel {
  private readonly tabs: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly search: HTMLInputElement;
  private enabled = true;

  constructor(
    private readonly root: HTMLElement,
    private readonly getView: () => EditorView,
  ) {
    registerFocusZone(root);
    // Right click on a symbol in a formula: make a shortcut for it.
    setSymbolMenu((e, choices) =>
      showContextMenu(e, [
        ...choices.map((c) => {
          const general = c.name === 'hele formelen' || c.name === 'det markerte';
          return {
            label: general ? `Lag hurtigtast for ${c.name} …` : `Lag hurtigtast for «${c.name}» …`,
            action: () => openShortcutEditor({ getView: this.getView, latex: c.latex, name: general ? '' : capitalize(c.name) }),
          };
        }),
        'separator' as const,
        { label: 'Alle hurtigtaster …', action: () => openShortcutManager(this.getView) },
      ]),
    );
    root.replaceChildren();
    const head = document.createElement('div');
    head.className = 'mp-head';
    this.tabs = document.createElement('div');
    this.tabs.className = 'mp-tabs';
    this.tabs.setAttribute('role', 'tablist');
    this.search = document.createElement('input');
    this.search.className = 'mp-search';
    this.search.type = 'search';
    this.search.placeholder = 'Søk: brøk, rot, pil …';
    this.search.setAttribute('aria-label', 'Søk etter symbol');
    this.search.addEventListener('input', () => this.renderItems());
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = searchItems(this.search.value, 1)[0];
        if (first) this.insert(first);
        e.preventDefault();
      } else if (e.key === 'Escape') {
        this.search.value = '';
        this.renderItems();
        this.getView().focus();
      }
    });
    const keys = this.headButton('Hurtigtaster', 'Se og lag hurtigtaster for matte', () => openShortcutManager(this.getView));
    keys.classList.add('mp-keys');
    const close = this.headButton('×', 'Skjul mattepanelet', () => updateSettings({ math: { palette: false } }));
    close.classList.add('mp-close');
    // Search and buttons in a column of their own, so the tabs form an even grid.
    const tools = document.createElement('div');
    tools.className = 'mp-tools';
    const buttons = document.createElement('div');
    buttons.className = 'mp-tool-buttons';
    buttons.append(keys, close);
    tools.append(this.search, buttons);
    head.append(this.tabs, tools);
    this.grid = document.createElement('div');
    this.grid.className = 'mp-grid';
    root.append(head, this.grid);
    this.update(getSettings());
  }

  private headButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mp-head-button';
    b.textContent = label;
    b.title = title;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', onClick);
    return b;
  }

  /** Only Markdown documents have formulas. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.root.hidden = !enabled || !getSettings().math.palette;
  }

  update(settings: Settings): void {
    this.root.hidden = !this.enabled || !settings.math.palette;
    if (this.root.hidden) return;
    this.renderTabs(settings);
    this.renderItems();
  }

  private renderTabs(settings: Settings): void {
    const active = settings.math.paletteTab;
    const tabs = [
      { id: MINE, name: 'Mine favoritter og egne hurtigtaster', short: 'Mine' },
      ...categories.map((c) => ({ id: c.id, name: c.name, short: c.short })),
    ];
    this.tabs.replaceChildren(
      ...tabs.map((t) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `mp-tab${t.id === active && !this.search.value ? ' active' : ''}`;
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(t.id === active));
        b.textContent = t.short;
        b.title = t.name;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
          this.search.value = '';
          updateSettings({ math: { paletteTab: t.id } });
        });
        return b;
      }),
    );
  }

  private renderItems(): void {
    const settings = getSettings();
    const query = this.search.value.trim();
    this.tabs.querySelectorAll('.mp-tab').forEach((b, i) => {
      const id = i === 0 ? MINE : categories[i - 1].id;
      b.classList.toggle('active', !query && id === settings.math.paletteTab);
    });
    this.grid.replaceChildren();
    if (query) {
      const found = searchItems(query, 60);
      if (!found.length) this.grid.append(this.note(`Fant ingenting for «${query}».`));
      for (const it of found) this.grid.append(this.button(it));
      return;
    }
    if (settings.math.paletteTab === MINE) {
      this.renderMine(settings);
      return;
    }
    const category = categories.find((c) => c.id === settings.math.paletteTab) ?? categories[0];
    for (const it of category.items) this.grid.append(this.button(it));
  }

  /** Favourites, then the user's own shortcuts (as buttons too). */
  private renderMine(settings: Settings): void {
    const favorites = settings.math.favorites.map((id) => itemsById.get(id)).filter((it): it is MathItem => !!it);
    for (const it of favorites) this.grid.append(this.button(it));
    const own: MathItem[] = [];
    const seen = new Set(favorites.map((f) => f.latex));
    const entries = [...Object.entries(settings.math.keys), ...Object.entries(settings.math.shortcuts)];
    for (const [trigger, latex] of entries) {
      if (!latex || latex.startsWith('@') || seen.has(latex)) continue;
      seen.add(latex);
      own.push({ id: `own:${trigger}`, name: settings.math.names[trigger] || 'Egen hurtigtast', latex });
    }
    for (const it of own) this.grid.append(this.button(it));
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'mp-item mp-add';
    add.textContent = '+ Ny hurtigtast';
    add.title = 'Lag en hurtigtast som skriver akkurat det du vil';
    add.addEventListener('mousedown', (e) => e.preventDefault());
    add.addEventListener('click', () => openShortcutEditor({ getView: this.getView }));
    this.grid.append(add);
    if (!favorites.length && !own.length) {
      this.grid.append(this.note('Høyreklikk et symbol i en annen fane og velg «Legg til i Mine».'));
    }
  }

  private note(text: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'mp-note';
    p.textContent = text;
    return p;
  }

  private button(it: MathItem): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `mp-item${it.action ? ' mp-action' : ''}`;
    b.title = describeItem(it);
    b.setAttribute('aria-label', it.name);
    const html = preview(previewLatex(it));
    if (html) b.innerHTML = html;
    else b.textContent = it.name;
    // Don't take focus: the formula being edited stays open.
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => this.insert(it));
    b.addEventListener('contextmenu', (e) => this.menu(e, it));
    return b;
  }

  private insert(it: MathItem): void {
    insertMath(this.getView(), it);
  }

  private menu(e: MouseEvent, it: MathItem): void {
    const settings = getSettings();
    const isFavorite = settings.math.favorites.includes(it.id);
    const own = it.id.startsWith('own:');
    showContextMenu(e, [
      ...(own
        ? []
        : [
            isFavorite
              ? {
                  label: 'Fjern fra Mine',
                  action: () => updateSettings({ math: { favorites: settings.math.favorites.filter((id) => id !== it.id) } }),
                }
              : {
                  label: 'Legg til i Mine',
                  action: () => updateSettings({ math: { favorites: [...settings.math.favorites, it.id] } }),
                },
          ]),
      {
        label: own ? 'Endre hurtigtasten …' : 'Lag hurtigtast for denne …',
        action: () =>
          openShortcutEditor({
            getView: this.getView,
            latex: it.action ? '@' + it.action : it.latex,
            name: own ? it.name : it.name,
            edit: own ? it.id.slice(4) : undefined,
          }),
      },
      'separator',
      { label: 'Alle hurtigtaster …', action: () => openShortcutManager(this.getView) },
    ]);
  }
}
