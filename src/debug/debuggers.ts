/**
 * Which debugger handles which language. Override or add languages via
 * `settings.debuggers`, e.g. a Debug Adapter Protocol program for another
 * language: { csharp: { type: 'dap', command: 'netcoredbg', args: ['--interpreter=vscode'],
 * launch: { program: '{file}', cwd: '{cwd}' } } }.
 */
import { normalizeLang, runnerFor } from '../features/codeBlockTools/runners';
import { getSettings } from '../settings';

export interface DebuggerConfig {
  /**
   * 'dap': a Debug Adapter Protocol program on stdin/stdout (debugpy for Python).
   * 'node': Node's built-in inspector (JavaScript, TypeScript).
   */
  type: 'dap' | 'node';
  /** dap: the adapter program and its arguments. "{python}" = the Python used for running code. */
  command?: string;
  args?: string[];
  /** dap: arguments for the launch request. "{file}" and "{cwd}" are replaced. */
  launch?: Record<string, unknown>;
  /** Text in the adapter's error output that means it isn't installed … */
  missing?: string;
  /** … and the program + arguments that install it (run in the terminal). */
  install?: string[];
  /** Name of what's installed, for the question to the user. */
  installName?: string;
}

export const defaultDebuggers: Record<string, DebuggerConfig> = {
  python: {
    type: 'dap',
    command: '{python}',
    args: ['-m', 'debugpy.adapter'],
    launch: {
      type: 'python',
      request: 'launch',
      program: '{file}',
      cwd: '{cwd}',
      console: 'integratedTerminal',
      justMyCode: true,
      showReturnValue: true,
    },
    missing: "No module named 'debugpy'",
    install: ['{python}', '-m', 'pip', 'install', 'debugpy'],
    installName: 'debugpy',
  },
  javascript: { type: 'node' },
  typescript: { type: 'node' },
};

/** The effective debugger for a language (defaults merged with settings), or null. */
export function debuggerFor(lang: string): DebuggerConfig | null {
  const id = normalizeLang(lang);
  const base = defaultDebuggers[id];
  const override = getSettings().debuggers[id];
  if (!base && !override?.type) return null;
  const config = { ...base, ...override } as DebuggerConfig;
  const python = runnerFor('python')?.command ?? 'python';
  const fill = (s: string) => s.replaceAll('{python}', python);
  return {
    ...config,
    command: config.command && fill(config.command),
    args: config.args?.map(fill),
    install: config.install?.map(fill),
  };
}

/** Replace "{file}" and "{cwd}" in launch arguments (recursively). */
export function fillLaunchArgs(value: unknown, vars: { file: string; cwd: string }): unknown {
  if (typeof value === 'string') return value.replaceAll('{file}', vars.file).replaceAll('{cwd}', vars.cwd);
  if (Array.isArray(value)) return value.map((v) => fillLaunchArgs(v, vars));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillLaunchArgs(v, vars)]));
  }
  return value;
}
