import { describe, expect, it } from 'vitest';
import { folderOf, isInFolders, withFolder } from '../src/app/trustRules';

describe('trusted folders', () => {
  const trusted = ['C:\\Users\\Eirik\\Documents\\Editor', 'D:/Skole/'];

  it('trusts files in and below a trusted folder', () => {
    expect(isInFolders('C:\\Users\\Eirik\\Documents\\Editor\\notat.md', trusted)).toBe(true);
    expect(isInFolders('C:\\Users\\Eirik\\Documents\\Editor\\fag\\matte\\a.py', trusted)).toBe(true);
    expect(isInFolders('D:\\Skole\\R2\\oppgave.md', trusted)).toBe(true);
  });

  it('ignores case and slash direction, like Windows', () => {
    expect(isInFolders('c:/users/eirik/documents/editor/x.md', trusted)).toBe(true);
  });

  it('does not trust a sibling folder that shares the prefix', () => {
    expect(isInFolders('C:\\Users\\Eirik\\Documents\\Editor2\\x.py', trusted)).toBe(false);
    expect(isInFolders('C:\\Users\\Eirik\\Downloads\\x.py', trusted)).toBe(false);
  });

  it('resolves . and .. before comparing (no climbing out of a trusted folder)', () => {
    expect(isInFolders('D:\\Skole\\..\\Nedlastinger\\x.py', trusted)).toBe(false);
    expect(isInFolders('D:/Skole/./../Nedlastinger/x.py', trusted)).toBe(false);
    expect(isInFolders('D:\\Annet\\..\\Skole\\R2\\x.py', trusted)).toBe(true);
    expect(isInFolders('D:\\..\\..\\Skole\\x.py', trusted)).toBe(true);
  });

  it('never trusts everything through an empty entry', () => {
    expect(isInFolders('C:\\x.py', ['', '/'])).toBe(false);
  });

  it('adds a folder only once', () => {
    expect(withFolder(trusted, 'D:\\Skole\\R2')).toBe(trusted);
    expect(withFolder(trusted, 'E:\\Annet')).toEqual([...trusted, 'E:\\Annet']);
  });

  it('finds the folder of a file', () => {
    expect(folderOf('C:\\a\\b\\c.md')).toBe('C:\\a\\b');
    expect(folderOf('/home/x/c.md')).toBe('/home/x');
  });
});
