import { describe, expect, it } from 'vitest';
import { kindForName, langForName, withExtension } from '../src/code/languages';

describe('file types', () => {
  it('opens notes as Markdown and everything else as code', () => {
    expect(kindForName('notat.md')).toBe('markdown');
    expect(kindForName('liste.TXT')).toBe('markdown');
    expect(kindForName('README')).toBe('markdown');
    expect(kindForName('main.py')).toBe('code');
    expect(kindForName('C:\\mappe.md\\app.ts')).toBe('code');
  });
  it('finds the language from the extension', () => {
    expect(langForName('main.py')).toBe('python');
    expect(langForName('app.mjs')).toBe('javascript');
    expect(langForName('app.tsx')).toBe('typescript');
    expect(langForName('skript.ps1')).toBe('powershell');
    expect(langForName('bygg.sh')).toBe('bash');
    expect(langForName('Program.cs')).toBe('csharp');
    expect(langForName('config.yml')).toBe('yaml');
  });
  it('replaces extensions', () => {
    expect(withExtension('Uten tittel.py', 'js')).toBe('Uten tittel.js');
    expect(withExtension('navn', 'md')).toBe('navn.md');
  });
});
