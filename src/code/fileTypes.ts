/**
 * File extensions as plain data (no CodeMirror), so the storage layer and the
 * drawing window can use them without loading the editor's language support.
 */

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
