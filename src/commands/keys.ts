/**
 * Shortcuts outside the editor. CodeMirror runs command keys while the
 * editor has focus; this runs app-wide commands (scope 'any') when focus is
 * elsewhere – the terminal, the sidebar, a button.
 */
import type { EditorView } from '@codemirror/view';
import { allCommands, keysFor } from './registry';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Whether a key event matches a binding in CodeMirror notation ("Mod-Shift-Enter", "F10"). */
export function matchesKey(event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>, binding: string): boolean {
  const parts = binding.split(/-(?!$)/);
  const name = parts.pop()!;
  let ctrl = false;
  let alt = false;
  let shift = false;
  let meta = false;
  for (const mod of parts) {
    if (mod === 'Mod') {
      if (isMac) meta = true;
      else ctrl = true;
    } else if (/^(ctrl|control|c)$/i.test(mod)) ctrl = true;
    else if (/^(alt|a)$/i.test(mod)) alt = true;
    else if (/^(shift|s)$/i.test(mod)) shift = true;
    else if (/^(meta|cmd|m)$/i.test(mod)) meta = true;
  }
  if (event.ctrlKey !== ctrl || event.altKey !== alt || event.shiftKey !== shift || event.metaKey !== meta) return false;
  if (name === 'Space') return event.key === ' ';
  if (name.length > 1) return event.key === name;
  // Letters and digits: also by physical key, since Shift changes event.key ("7" -> "/").
  const physical = /^(?:Key|Digit)(.)$/.exec(event.code)?.[1];
  return event.key.toLowerCase() === name.toLowerCase() || physical?.toLowerCase() === name.toLowerCase();
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
