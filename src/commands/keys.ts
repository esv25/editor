/**
 * Keys outside CodeMirror's own keymaps.
 *
 * - Key events ⇄ CodeMirror notation ("Mod-Shift-7"), for the formula field
 *   and for recording a new shortcut. Matching works like CodeMirror's:
 *   Shift+7 on a Norwegian keyboard is "/", but "Mod-Shift-7" still matches it.
 * - Key sequences (Ctrl+M, F).
 * - App-wide commands (scope 'any') when focus is elsewhere – the terminal,
 *   the sidebar, a button. CodeMirror runs command keys while the editor has
 *   focus.
 */
import type { EditorView } from '@codemirror/view';
import { base, keyName } from 'w3c-keyname';
import { allCommands, keysFor } from './registry';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** What matching needs from a key event (tests pass plain objects). */
export type KeyEvent = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'> & { keyCode?: number };

/** Canonical form of a key spec ("Mod-Shift-a" → "Shift-Ctrl-a" on Windows). */
export function normalizeKey(spec: string): string {
  const parts = spec.split(/-(?!$)/);
  let result = parts[parts.length - 1];
  if (result === 'Space') result = ' ';
  let alt = false;
  let ctrl = false;
  let shift = false;
  let meta = false;
  for (const mod of parts.slice(0, -1)) {
    if (/^(cmd|meta|m)$/i.test(mod)) meta = true;
    else if (/^a(lt)?$/i.test(mod)) alt = true;
    else if (/^(c|ctrl|control)$/i.test(mod)) ctrl = true;
    else if (/^s(hift)?$/i.test(mod)) shift = true;
    else if (/^mod$/i.test(mod)) {
      if (isMac) meta = true;
      else ctrl = true;
    }
  }
  if (alt) result = 'Alt-' + result;
  if (ctrl) result = 'Ctrl-' + result;
  if (meta) result = 'Meta-' + result;
  if (shift) result = 'Shift-' + result;
  return result;
}

function withModifiers(name: string, e: KeyEvent, shift: boolean): string {
  if (e.altKey) name = 'Alt-' + name;
  if (e.ctrlKey) name = 'Ctrl-' + name;
  if (e.metaKey) name = 'Meta-' + name;
  if (shift && e.shiftKey) name = 'Shift-' + name;
  return name;
}

/** The key without Shift/Alt ("/" → "7"), from the key code or else the physical key. */
function baseKey(e: KeyEvent): string | undefined {
  if (e.keyCode !== undefined && base[e.keyCode]) return base[e.keyCode];
  const physical = /^(?:Key|Digit)(.)$/.exec(e.code)?.[1];
  return physical?.toLowerCase();
}

/** The canonical names a key event can match. */
export function eventKeyNames(e: KeyEvent): string[] {
  const name = keyName(e as KeyboardEvent);
  const isChar = name.length === 1 && name !== ' ';
  const names = [withModifiers(name, e, !isChar)];
  const baseName = baseKey(e);
  if (isChar && (e.shiftKey || e.altKey || e.metaKey) && baseName && baseName !== name) {
    names.push(withModifiers(baseName, e, true));
  } else if (isChar && e.shiftKey) {
    names.push(withModifiers(name, e, true));
  }
  return names;
}

/** Whether a key event matches a binding in CodeMirror notation ("Mod-Shift-Enter", "F10"). */
export function matchesKey(e: KeyEvent, spec: string): boolean {
  const target = normalizeKey(spec);
  return eventKeyNames(e).includes(target);
}

/** AltGr on Windows arrives as Ctrl+Alt: then the key is a character to type, not a shortcut. */
export function isAltGraph(e: KeyEvent): boolean {
  return e.ctrlKey && e.altKey && !e.metaKey && e.key.length === 1;
}

export const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead', 'Unidentified', 'Process']);

/**
 * A pressed key combination in CodeMirror notation ("Mod-Shift-r"), for
 * recording a shortcut. Null for lone modifiers, and for plain typing keys
 * unless `plain` (later keys of a sequence may be plain: Ctrl+M, F).
 */
export function keySpecFromEvent(e: KeyEvent, plain = false): string | null {
  if (MODIFIER_KEYS.has(e.key) || isAltGraph(e)) return null;
  let name = keyName(e as KeyboardEvent);
  const baseName = baseKey(e);
  if (name.length === 1 && baseName && (e.shiftKey || e.altKey)) name = baseName;
  if (name === ' ') name = 'Space';
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const isFunctionKey = /^F\d+$/.test(name);
  if (!plain && !mod && !e.altKey && !isFunctionKey) return null;
  let spec = name.length === 1 ? name.toLowerCase() : name;
  if (e.shiftKey) spec = 'Shift-' + spec;
  if (e.altKey) spec = 'Alt-' + spec;
  if (mod) spec = 'Mod-' + spec;
  return spec;
}

/** A key sequence ("Mod-m f") as its strokes. */
export function strokes(spec: string): string[] {
  return spec.trim().split(/\s+/).filter(Boolean);
}

/** "Mod-m f" → "Ctrl+M, F". */
export function formatKeys(spec: string, format: (key: string) => string): string {
  return strokes(spec).map(format).join(', ');
}

export interface ChordBinding<T> {
  /** Normalized strokes. */
  keys: string[];
  value: T;
}

export function chordBindings<T>(entries: [string, T][]): ChordBinding<T>[] {
  return entries.map(([spec, value]) => ({ keys: strokes(spec).map(normalizeKey), value }));
}

/**
 * Matches key presses against single keys and sequences (Ctrl+M, F).
 * After the first key of a sequence it waits; if that key is also bound on
 * its own, it runs that binding when no second key comes in time.
 */
export class ChordMatcher<T> {
  private pending: string[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    /** Called with the keys typed so far (null when the sequence ends), to show a hint. */
    private readonly onPending: (keys: string[] | null) => void,
    private readonly timeoutMs = 1500,
  ) {}

  /**
   * Feed a keydown. Returns the matched value, 'pending' if it started or
   * continued a sequence (the key should be swallowed), or null.
   * `fallback` runs when a waiting sequence times out.
   */
  feed(e: KeyEvent, bindings: ChordBinding<T>[], fallback: (keys: string[]) => void): { value: T } | 'pending' | null {
    if (MODIFIER_KEYS.has(e.key)) return null;
    const names = eventKeyNames(e);
    const at = this.pending.length;
    const candidates = bindings.filter(
      (b) => b.keys.length > at && this.pending.every((k, i) => b.keys[i] === k) && names.includes(b.keys[at]),
    );
    if (candidates.length === 0) {
      this.reset();
      return null;
    }
    const stroke = candidates[0].keys[at];
    const full = candidates.find((b) => b.keys.length === at + 1);
    const longer = candidates.some((b) => b.keys.length > at + 1);
    if (full && !longer) {
      this.reset();
      return { value: full.value };
    }
    this.pending.push(stroke);
    const keys = [...this.pending];
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.reset();
      fallback(keys);
    }, this.timeoutMs);
    this.onPending(keys);
    return 'pending';
  }

  reset(): void {
    clearTimeout(this.timer);
    if (this.pending.length) this.onPending(null);
    this.pending = [];
  }
}

/** App-wide commands bound to this key, in registration order. */
export function commandsForKey(event: KeyboardEvent) {
  return allCommands().filter((c) => c.scope === 'any' && keysFor(c.id).some((k) => matchesKey(event, k)));
}

/**
 * Keys the terminal leaves to the app: function keys (debugging), switching
 * tabs and showing/hiding the terminal. Everything else goes to the shell.
 */
export function isAppKeyInTerminal(event: KeyboardEvent): boolean {
  return commandsForKey(event).some(
    (c) =>
      ['view.toggleTerminal', 'tab.next', 'tab.prev'].includes(c.id) ||
      keysFor(c.id).some((k) => /(^|-)F\d+$/.test(k) && matchesKey(event, k)),
  );
}

/** Keys that reload the page in the webview – never wanted in the installed app. */
const RELOAD_KEYS = ['F5', 'Shift-F5', 'Mod-F5', 'Mod-r', 'Mod-Shift-r'];

export function installGlobalKeys(getView: () => EditorView, blockReload: boolean): void {
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    // The editor runs its own keymap; anything it didn't handle falls through to here.
    if (!target?.closest('.cm-editor')) {
      for (const command of commandsForKey(event)) {
        if (command.run(getView())) {
          event.preventDefault();
          return;
        }
      }
    }
    if (blockReload && RELOAD_KEYS.some((k) => matchesKey(event, k))) event.preventDefault();
  });
}
