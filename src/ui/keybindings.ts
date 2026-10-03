/**
 * «Hurtigtaster»: every command's keys, changeable (settings.keybindings),
 * plus the drawing window's tool keys (settings.diagram.toolKeys). Opened
 * from the keyboard button in the top bar, by right-clicking a toolbar
 * button, or from the math shortcut dialog.
 *
 * Changing a key: click «Endre» and press the new combination. A key that
 * something else also uses is taken over at once; a note under the row
 * offers to remove it from the other one.
 */
import { isAltGraph, keySpecFromEvent, MODIFIER_KEYS, normalizeKey } from '../commands/keys';
import { allCommands, formatKey, getCommand, keysFor, type EditorCommand } from '../commands/registry';
import { closeMathField, describeKeys } from '../features/math';
import { toolKey, tools } from '../diagram/tools';
import { getSettings, updateSettings } from '../settings';
import { openShortcutManager } from './mathShortcuts';
import { button, el, openModal } from './modal';
import type { EditorView } from '@codemirror/view';

const SECTIONS: { name: string; prefixes: string[] }[] = [
  { name: 'Skriving', prefixes: ['heading', 'format', 'list', 'task', 'codeblock.toggle', 'image', 'diagram'] },
  { name: 'Matte', prefixes: ['math'] },
  { name: 'Filer og faner', prefixes: ['file', 'tab', 'group'] },
  { name: 'Visning', prefixes: ['view', 'app'] },
  { name: 'Kode, terminal og feilsøking', prefixes: ['code', 'codeblock.run', 'debug', 'terminal'] },
];

function sectionOf(id: string): string {
  for (const s of SECTIONS) if (s.prefixes.some((p) => id === p || id.startsWith(p + '.'))) return s.name;
  return 'Annet';
}

/** Keys a drawing tool can't have: they already mean something on the canvas. */
const DIAGRAM_RESERVED = new Set(['0', '+', '-', '=']);

const sameKey = (a: string, b: string) => normalizeKey(a) === normalizeKey(b);

function defaultKeys(command: EditorCommand): string[] {
  if (!command.key) return [];
  return Array.isArray(command.key) ? command.key : [command.key];
}

function isOverridden(id: string): boolean {
  const command = getCommand(id);
  if (!command) return false;
  return keysFor(id).join(' ') !== defaultKeys(command).join(' ');
}

function keyChips(keys: string[], format: (k: string) => string = formatKey): HTMLElement {
  const box = el('span', 'kb-keys');
  if (!keys.length) box.append(el('span', 'kb-none', 'ingen'));
  for (const k of keys) box.append(el('kbd', '', format(k)));
  return box;
}

/**
 * A field that records one key press. `accept` turns the event into a key
 * spec, or returns a message saying why not.
 */
function recorder(
  accept: (e: KeyboardEvent) => string | { error: string },
  onDone: (spec: string | null) => void,
): HTMLElement {
  const box = el('div', 'sc-recorder recording kb-recorder');
  box.tabIndex = 0;
  const text = el('span', 'sc-recorded', 'Trykk tastene nå …');
  const hint = el('span', 'sc-recorder-hint', 'Esc avbryter');
  box.append(text, hint);
  let done = false;
  const finish = (spec: string | null) => {
    if (done) return;
    done = true;
    onDone(spec);
  };
  box.addEventListener('keydown', (e) => {
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
    if (plain && e.key === 'Tab') return;
    e.preventDefault();
    e.stopPropagation();
    if (plain && e.key === 'Escape') return finish(null);
    if (MODIFIER_KEYS.has(e.key)) return;
    const result = accept(e);
    if (typeof result === 'string') finish(result);
    else hint.textContent = result.error;
  });
  box.addEventListener('blur', () => finish(null));
  requestAnimationFrame(() => box.focus());
  return box;
}

function acceptCommandKey(e: KeyboardEvent): string | { error: string } {
  if (isAltGraph(e)) return { error: 'Ctrl+Alt er AltGr på norsk tastatur (for @, { og [). Velg en annen.' };
  return keySpecFromEvent(e) ?? { error: 'Begynn med Ctrl, Alt eller en F-tast – vanlige taster skriver tekst.' };
}

function acceptToolKey(e: KeyboardEvent): string | { error: string } {
  if (e.ctrlKey || e.altKey || e.metaKey) return { error: 'Bare én vanlig tast, uten Ctrl eller Alt.' };
  const key = e.key.toLowerCase();
  if (!/^[a-zæøå0-9]$/.test(key)) return { error: 'Velg en bokstav eller et tall.' };
  if (DIAGRAM_RESERVED.has(key)) return { error: '0 tilbakestiller zoomen. Velg en annen.' };
  return key;
}

export interface KeybindingsOptions {
  /** Start recording a new key for this command. */
  record?: string;
}

export function openKeybindings(getView: () => EditorView, opts: KeybindingsOptions = {}): void {
  closeMathField(null);
  const m = openModal('Hurtigtaster');
  m.dialog.classList.add('kb-dialog');

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'sc-text kb-search';
  search.placeholder = 'Søk: lagre, formel, terminal …';
  search.setAttribute('aria-label', 'Søk etter kommando');
  const list = el('div', 'kb-list');
  m.body.append(search, list);

  /** The row being recorded, and notes to show under rows after a change. */
  let recording: string | null = opts.record ?? null;
  const notes = new Map<string, HTMLElement>();

  const render = () => {
    const query = search.value.trim().toLowerCase();
    // Rebuilt after every change: stay where the user was.
    const scroll = m.body.scrollTop;
    list.replaceChildren();

    const bySection = new Map<string, EditorCommand[]>();
    for (const c of allCommands()) {
      if (query && !c.name.toLowerCase().includes(query) && !keysFor(c.id).some((k) => formatKey(k).toLowerCase().includes(query))) continue;
      const name = sectionOf(c.id);
      if (!bySection.has(name)) bySection.set(name, []);
      bySection.get(name)!.push(c);
    }
    for (const name of [...SECTIONS.map((s) => s.name), 'Annet']) {
      const commands = bySection.get(name);
      if (!commands?.length) continue;
      list.append(el('h3', 'sc-step', name));
      for (const c of commands) list.append(commandRow(c));
      if (name === 'Matte' && !query) {
        const own = button('Egne mattehurtigtaster og forkortelser …', () => {
          m.close();
          openShortcutManager(getView);
        });
        own.className = 'kb-link';
        list.append(own);
      }
    }

    const toolRows = tools.filter((t) => !query || t.name.toLowerCase().includes(query));
    if (toolRows.length) {
      list.append(el('h3', 'sc-step', 'Tegnevinduet'));
      list.append(el('p', 'sc-hint', 'Én tast velger verktøyet mens du tegner.'));
      for (const t of toolRows) list.append(toolRow(t.id, t.name, toolKey(t), t.key !== toolKey(t)));
    }
    if (!list.children.length) list.append(el('p', 'sc-hint', `Fant ingenting for «${search.value}».`));
    m.body.scrollTop = scroll;
  };

  const commandRow = (c: EditorCommand): HTMLElement => {
    const wrap = el('div', 'kb-item');
    const row = el('div', 'sc-row kb-row');
    row.append(el('span', 'kb-name', c.name));
    if (recording === c.id) {
      row.append(
        recorder(acceptCommandKey, (spec) => {
          recording = null;
          if (spec) setCommandKey(c, spec);
          render();
        }),
      );
    } else {
      const keys = keysFor(c.id);
      row.append(
        keyChips(keys),
        button('Endre', () => {
          recording = c.id;
          notes.delete(c.id);
          render();
        }),
      );
      const remove = button('Fjern', () => {
        updateSettings({ keybindings: { [c.id]: null } });
        notes.delete(c.id);
        render();
      });
      remove.disabled = !keys.length;
      const reset = button('Standard', () => {
        updateSettings({ keybindings: { [c.id]: c.key ?? null } });
        notes.delete(c.id);
        render();
      });
      reset.title = `Tilbake til ${defaultKeys(c).map(formatKey).join(' / ') || 'ingen'}`;
      reset.disabled = !isOverridden(c.id);
      row.append(remove, reset);
    }
    wrap.append(row);
    const note = notes.get(c.id);
    if (note) wrap.append(note);
    return wrap;
  };

  /** Give a command this key; note what else uses it. */
  const setCommandKey = (c: EditorCommand, spec: string) => {
    updateSettings({ keybindings: { [c.id]: [spec] } });
    const others = allCommands().filter((o) => o.id !== c.id && keysFor(o.id).some((k) => sameKey(k, spec)));
    const settings = getSettings();
    const math = Object.entries(settings.math.keys).filter(([k, v]) => v && sameKey(k.split(/\s+/)[0], spec));
    if (!others.length && !math.length) return;
    const note = el('div', 'kb-note');
    for (const o of others) {
      const line = el('p', '', `${formatKey(spec)} brukes også til «${o.name}». `);
      line.append(
        button(`Fjern den fra «${o.name}»`, () => {
          updateSettings({ keybindings: { [o.id]: keysFor(o.id).filter((k) => !sameKey(k, spec)) } });
          line.remove();
          if (!note.querySelector('p')) notes.delete(c.id);
          render();
        }),
      );
      note.append(line);
    }
    for (const [k] of math) {
      const name = settings.math.names[k] || describeKeys(k);
      const line = el('p', '', `Mattehurtigtasten «${name}» (${describeKeys(k)}) bruker samme tast og går foran. `);
      line.append(
        button('Fjern mattehurtigtasten', () => {
          updateSettings({ math: { keys: { [k]: null } } });
          line.remove();
          if (!note.querySelector('p')) notes.delete(c.id);
          render();
        }),
      );
      note.append(line);
    }
    notes.set(c.id, note);
  };

  const toolRow = (id: string, name: string, key: string, changed: boolean): HTMLElement => {
    const wrap = el('div', 'kb-item');
    const row = el('div', 'sc-row kb-row');
    const recId = `tool:${id}`;
    row.append(el('span', 'kb-name', name));
    if (recording === recId) {
      row.append(
        recorder(acceptToolKey, (spec) => {
          recording = null;
          if (spec) {
            // Another tool with this key loses it (one key, one tool).
            const patch: Record<string, string> = { [id]: spec };
            for (const t of tools) if (t.id !== id && toolKey(t) === spec) patch[t.id] = '';
            updateSettings({ diagram: { toolKeys: patch } });
          }
          render();
        }),
      );
    } else {
      row.append(
        keyChips(key ? [key] : [], (k) => k.toUpperCase()),
        button('Endre', () => {
          recording = recId;
          render();
        }),
      );
      const reset = button('Standard', () => {
        const def = tools.find((t) => t.id === id)!.key;
        const patch: Record<string, string> = { [id]: def };
        for (const t of tools) if (t.id !== id && toolKey(t) === def) patch[t.id] = '';
        updateSettings({ diagram: { toolKeys: patch } });
        render();
      });
      reset.disabled = !changed;
      row.append(reset);
    }
    wrap.append(row);
    return wrap;
  };

  search.addEventListener('input', () => {
    recording = null;
    render();
  });
  m.footer.append(button('Lukk', () => m.close(), 'primary'));
  render();
  if (opts.record) list.querySelector('.kb-recorder')?.scrollIntoView({ block: 'center' });
  else requestAnimationFrame(() => search.focus());
}
