/**
 * User-adjustable settings.
 *
 * Only the user's overrides are persisted (in localStorage), so changing a
 * default here takes effect for everyone who hasn't overridden it.
 */
import {
  defaultHeadingSuggestionConfig,
  type HeadingSuggestionConfig,
} from './features/headingSuggestion/rules';
import type { RunnerConfig } from './features/codeBlockTools/runners';
import type { DebuggerConfig } from './debug/debuggers';
import { defaultCodeHelp, type CodeHelpSettings } from './code/assist/levels';

export type ThemeSetting = 'light' | 'dark' | 'system';

export interface Settings {
  theme: ThemeSetting;
  /** Max text width in characters. */
  lineWidth: number;
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  monoFontFamily: string;
  /** Hide Markdown markup (#, **, `) on lines the cursor isn't on. */
  hideMarkup: boolean;
  outlineVisible: boolean;
  autosave: {
    enabled: boolean;
    delayMs: number;
    /** Desktop: where new, never-saved documents are autosaved. Empty = Documents\Editor. */
    folder: string;
  };
  /** Per-language overrides for running code blocks (see features/codeBlockTools/runners.ts). */
  codeRunners: Record<string, Partial<RunnerConfig>>;
  /** Max run time for a code block before it's stopped. */
  codeRunTimeoutMs: number;
  /** Per-language debugger overrides (see debug/debuggers.ts). */
  debuggers: Record<string, Partial<DebuggerConfig>>;
  terminal: {
    /** Program for new terminals (on PATH or a full path). */
    shell: string;
    shellArgs: string[];
    /** Height of the terminal panel in pixels. */
    height: number;
    fontSize: number;
  };
  /** How much help code files get: underlined errors, faded unused code, suggestions … */
  codeHelp: CodeHelpSettings;
  /** Opening characters that get their closing partner inserted automatically. [] = off. */
  closeBrackets: string[];
  headingSuggestion: HeadingSuggestionConfig;
  /** Command id -> key(s) (CodeMirror notation, e.g. "Mod-Shift-h"), or null to unbind. */
  keybindings: Record<string, string | string[] | null>;
  /** Command ids shown in the formatting toolbar; "|" is a separator. */
  toolbar: string[];
  /** The drawing window. */
  diagram: {
    /** Grid step: everything snaps to it. */
    grid: number;
    /** How far (screen px) from a figure or arrow a click still hits it. */
    hitTolerance: number;
    /** How far (screen px) the pointer must move with the button down before it's a drag, not a click. */
    dragThreshold: number;
    /** How close (screen px) a dragged figure's edge or middle must come to another's to line up with it (0 = only the grid). */
    alignTolerance: number;
    /** Wait this long after a change before saving. */
    autosaveDelayMs: number;
    /** Tool id → the key that picks it ('' = none), overriding the tool's own. */
    toolKeys: Record<string, string>;
  };
  math: MathSettings;
  security: {
    /** Folders code may run from without asking (see app/trust.ts). */
    trustedFolders: string[];
    /** Hosts whose images load without asking (others wait for «Vis bildet»). */
    imageHosts: string[];
  };
  updates: {
    /** Installed app: look for a new version this often while it runs (0 = only at start). */
    checkMinutes: number;
  };
}

export interface MathSettings {
  /** Always show the math panel (symbols and templates) below the editor. */
  palette: boolean;
  /** Also show it while a formula is being edited (and hide it again after). */
  paletteAuto: boolean;
  /** Last open tab in the math panel. */
  paletteTab: string;
  /** Typed shortcuts in formulas: text → LaTeX template (null turns a built-in one off). */
  shortcuts: Record<string, string | null>;
  /** Key shortcuts: key or sequence ("Mod-Shift-r", "Mod-m f") → LaTeX template (null = removed). */
  keys: Record<string, string | null>;
  /** Names the user gave their own shortcuts, by key or text. */
  names: Record<string, string>;
  /** Panel items in «Mine» (favourites), by id. */
  favorites: string[];
}

export const defaultSettings: Settings = {
  theme: 'system',
  lineWidth: 75,
  fontSize: 18,
  lineHeight: 1.7,
  fontFamily: '"Sitka Text", Charter, "Iowan Old Style", Georgia, serif',
  monoFontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace',
  hideMarkup: true,
  outlineVisible: true,
  autosave: { enabled: true, delayMs: 1500, folder: '' },
  codeRunners: {},
  codeRunTimeoutMs: 30000,
  debuggers: {},
  terminal: { shell: 'powershell.exe', shellArgs: ['-NoLogo'], height: 260, fontSize: 13 },
  codeHelp: defaultCodeHelp,
  closeBrackets: ['(', '[', '{', '«'],
  headingSuggestion: defaultHeadingSuggestionConfig,
  keybindings: {},
  toolbar: [
    'heading.1', 'heading.2', 'heading.3', '|',
    'format.bold', 'format.italic', 'format.code', '|',
    'list.bullet', 'list.ordered', 'list.task', '|',
    'codeblock.toggle', 'table.insert', 'image.insert', 'diagram.new', '|',
    'math.inline', 'math.block', 'math.palette',
  ],
  diagram: { grid: 20, hitTolerance: 16, dragThreshold: 6, alignTolerance: 10, autosaveDelayMs: 500, toolKeys: {} },
  math: {
    palette: false,
    paletteAuto: true,
    paletteTab: 'basic',
    shortcuts: {},
    keys: {},
    names: {},
    favorites: ['frac', 'sqrt', 'square', 'pow', 'times', 'pm', 'le', 'ge', 'ne', 'approx', 'pi', 'paren', 'abs', 'answer'],
  },
  security: { trustedFolders: [], imageHosts: [] },
  updates: { checkMinutes: 30 },
};

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const STORAGE_KEY = 'editor.settings.v1';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Recursively merge `patch` into `base`. Arrays and primitives are replaced. */
export function mergeDeep<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = isPlainObject(out[key]) && isPlainObject(value) ? mergeDeep(out[key], value) : value;
  }
  return out as T;
}

function loadOverrides(): DeepPartial<Settings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

let overrides = loadOverrides();
let current: Settings = mergeDeep(defaultSettings, overrides);
const listeners = new Set<(next: Settings, prev: Settings) => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: DeepPartial<Settings>): void {
  const prev = current;
  overrides = mergeDeep(overrides, patch);
  current = mergeDeep(defaultSettings, overrides);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Storage unavailable (private mode etc.) – settings just won't persist.
  }
  for (const fn of listeners) fn(current, prev);
}

export function resetSettings(): void {
  overrides = {};
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  const prev = current;
  current = defaultSettings;
  for (const fn of listeners) fn(current, prev);
}

// Another window (the drawing window, or the editor) changed them: follow along.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    const prev = current;
    overrides = loadOverrides();
    current = mergeDeep(defaultSettings, overrides);
    for (const fn of listeners) fn(current, prev);
  });
}

export function onSettingsChange(fn: (next: Settings, prev: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
