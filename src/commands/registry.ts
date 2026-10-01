/**
 * Central command registry.
 *
 * Every user-facing action (toolbar buttons, shortcuts, later a command
 * palette) is a command registered here. Buttons and keymaps both look
 * commands up by id, so a new command is added in exactly one place.
 */
import { Prec, type EditorState, type Extension } from '@codemirror/state';
import { keymap, type EditorView, type KeyBinding } from '@codemirror/view';
import { getSettings } from '../settings';

/**
 * Which kind of document a command applies to. Markdown formatting
 * commands shouldn't fire in a code file and vice versa.
 */
export type CommandScope = 'markdown' | 'code' | 'any';

export interface EditorCommand {
  id: string;
  /** Human-readable name, used in tooltips and (later) a command palette. */
  name: string;
  /** Short toolbar label (text) – ignored if `icon` is set. */
  label?: string;
  /** Inline SVG markup for the toolbar button. */
  icon?: string;
  /**
   * Default key(s) in CodeMirror notation ("Mod-b", "Mod-Shift-7"). The first
   * is shown in tooltips. Overridable in settings.
   */
  key?: string | string[];
  /** Where the command applies. Default: 'markdown'. */
  scope?: CommandScope;
  run: (view: EditorView) => boolean;
  /** Whether the command's effect is active at the cursor (for toggle buttons). */
  isActive?: (state: EditorState) => boolean;
}

const commands = new Map<string, EditorCommand>();

export function registerCommand(command: EditorCommand): void {
  commands.set(command.id, command);
}

export function registerCommands(list: EditorCommand[]): void {
  list.forEach(registerCommand);
}

export function getCommand(id: string): EditorCommand | undefined {
  return commands.get(id);
}

export function allCommands(): EditorCommand[] {
  return [...commands.values()];
}

export function runCommand(view: EditorView, id: string): boolean {
  const command = commands.get(id);
  return command ? command.run(view) : false;
}

/** The effective keys for a command: the settings override if any, else the defaults. */
export function keysFor(id: string): string[] {
  const overrides = getSettings().keybindings;
  const key = id in overrides ? overrides[id] : commands.get(id)?.key;
  if (!key) return [];
  return Array.isArray(key) ? key : [key];
}

/** The main key for a command (shown in tooltips and hints). */
export function keyFor(id: string): string | undefined {
  return keysFor(id)[0];
}

/**
 * Keymap for one kind of document, built from the registry.
 * Rebuild (via compartment) when settings change.
 */
export function commandKeymap(scope: 'markdown' | 'code'): Extension {
  const bindings: KeyBinding[] = [];
  for (const command of commands.values()) {
    const commandScope = command.scope ?? 'markdown';
    if (commandScope !== scope && commandScope !== 'any') continue;
    for (const key of keysFor(command.id)) bindings.push({ key, run: command.run, preventDefault: false });
  }
  return Prec.high(keymap.of(bindings));
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** "Mod-Shift-h" -> "Ctrl+Shift+H" (or "⌘⇧H" on Mac). */
export function formatKey(key: string): string {
  const names: Record<string, [string, string]> = {
    Mod: ['Ctrl', '⌘'],
    Ctrl: ['Ctrl', '⌃'],
    Shift: ['Shift', '⇧'],
    Alt: ['Alt', '⌥'],
    Meta: ['Win', '⌘'],
  };
  const parts = key.split(/-(?!$)/).map((part) => {
    if (names[part]) return names[part][isMac ? 1 : 0];
    return part.length === 1 ? part.toUpperCase() : part;
  });
  return parts.join(isMac ? '' : '+');
}

/** Tooltip text: "Fet (Ctrl+B)". */
export function describeCommand(id: string): string {
  const command = commands.get(id);
  if (!command) return id;
  const key = keyFor(id);
  return key ? `${command.name} (${formatKey(key)})` : command.name;
}
