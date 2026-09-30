/**
 * Which program runs which language. Override or add languages via
 * `settings.codeRunners`, e.g. { python: { command: 'py' } } or
 * { ruby: { label: 'Ruby', command: 'ruby', args: ['{file}'], extension: 'rb' } }.
 */
import { getSettings } from '../../settings';

export interface RunnerConfig {
  label: string;
  /** Program name (on PATH) or full path. */
  command: string;
  /** "{file}" is replaced with the snippet's temp file. */
  args: string[];
  /** Temp file extension, without dot. */
  extension: string;
  /** Write the file with a UTF-8 BOM (Windows PowerShell 5 needs it for æøå). */
  bom?: boolean;
  /** Code prepended to the snippet. */
  prelude?: string;
}

export const defaultRunners: Record<string, RunnerConfig> = {
  python: { label: 'Python', command: 'python', args: ['-X', 'utf8', '{file}'], extension: 'py' },
  // .mjs so top-level await works.
  javascript: { label: 'JavaScript', command: 'node', args: ['{file}'], extension: 'mjs' },
  typescript: {
    label: 'TypeScript',
    command: 'node',
    args: ['--experimental-strip-types', '--no-warnings', '{file}'],
    extension: 'mts',
  },
  powershell: {
    label: 'PowerShell',
    command: 'powershell',
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', '{file}'],
    extension: 'ps1',
    bom: true,
    prelude: '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n',
  },
  bash: { label: 'Bash', command: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['{file}'], extension: 'sh' },
  java: {
    label: 'Java',
    command: 'java',
    args: ['-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8', '{file}'],
    extension: 'java',
  },
};

const ALIASES: Record<string, string> = {
  py: 'python',
  python3: 'python',
  js: 'javascript',
  node: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  ps: 'powershell',
  ps1: 'powershell',
  pwsh: 'powershell',
  sh: 'bash',
  shell: 'bash',
  htm: 'html',
};

/** Languages offered in the code block language menu. */
export const languageChoices: { id: string; label: string }[] = [
  { id: '', label: 'Ren tekst' },
  { id: 'python', label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'json', label: 'JSON' },
  { id: 'bash', label: 'Bash' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'java', label: 'Java' },
  { id: 'sql', label: 'SQL' },
  { id: 'yaml', label: 'YAML' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'rust', label: 'Rust' },
  { id: 'go', label: 'Go' },
];

export function normalizeLang(lang: string): string {
  const lower = lang.toLowerCase();
  return ALIASES[lower] ?? lower;
}

/** The effective runner for a language (defaults merged with settings), or null. */
export function runnerFor(lang: string): RunnerConfig | null {
  const id = normalizeLang(lang);
  const override = getSettings().codeRunners[id];
  const base = defaultRunners[id];
  if (!base && !override?.command) return null;
  return Object.assign({ label: id, args: ['{file}'], extension: 'txt' }, base, override) as RunnerConfig;
}
