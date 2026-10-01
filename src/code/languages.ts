/**
 * File type handling: which files open as Markdown and which as code, and
 * which language a code file is.
 */
import type { Extension } from '@codemirror/state';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { normalizeLang } from '../features/codeBlockTools/runners';

export type DocKind = 'markdown' | 'code';

const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'txt'];

/** Language id -> file extension for new code files. */
export const extensionForLang: Record<string, string> = {
  python: 'py',
  javascript: 'js',
  typescript: 'ts',
  html: 'html',
  css: 'css',
  json: 'json',
  bash: 'sh',
  powershell: 'ps1',
  java: 'java',
  sql: 'sql',
  yaml: 'yaml',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  rust: 'rs',
  go: 'go',
  xml: 'xml',
};

/** Extensions offered in the open dialog besides Markdown. */
export const codeFileExtensions = [
  ...new Set([...Object.values(extensionForLang), 'mjs', 'cjs', 'mts', 'jsx', 'tsx', 'htm', 'yml', 'h', 'hpp', 'toml', 'ini', 'csv']),
];

const EXT_ALIASES: Record<string, string> = {
  yml: 'yaml',
  cs: 'csharp',
  rs: 'rust',
  h: 'c',
  hpp: 'cpp',
  cc: 'cpp',
  jsx: 'javascript',
  tsx: 'typescript',
  cjs: 'javascript',
  mts: 'typescript',
};

export function extensionOf(name: string): string {
  const m = /\.([^.\\/]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

/** Markdown for .md/.txt (and files without extension), code for everything else. */
export function kindForName(name: string): DocKind {
  const ext = extensionOf(name);
  return ext === '' || MARKDOWN_EXTENSIONS.includes(ext) ? 'markdown' : 'code';
}

/** Language id for a code file name, e.g. "main.py" -> "python". */
export function langForName(name: string): string {
  const ext = extensionOf(name);
  return EXT_ALIASES[ext] ?? normalizeLang(ext);
}

/** Replace a file name's extension. */
export function withExtension(name: string, ext: string): string {
  return name.replace(/\.[^.\\/]*$/, '') + '.' + ext;
}

/** Syntax highlighting support for a language (loaded on demand), or nothing. */
export async function loadLanguage(lang: string): Promise<Extension> {
  if (!lang) return [];
  const desc =
    LanguageDescription.matchLanguageName(languages, lang, true) ??
    LanguageDescription.matchFilename(languages, `x.${extensionForLang[lang] ?? lang}`);
  if (!desc) return [];
  try {
    return await desc.load();
  } catch {
    return [];
  }
}
