import { describe, expect, it } from 'vitest';
import changelogText from '../CHANGELOG.md?raw';
import packageText from '../package.json?raw';
import { compareVersions, entriesSince, inlineSpans, noteBlocks, parseChangelog } from '../src/app/changelog';

const sample = `# Hva er nytt

Innledning som ikke vises.

## Neste versjon

- Ikke utgitt ennå

## 0.10.0 – 2026-11-01

- Ny ting
- Enda en

## 0.9.1 – 2026-10-20

Bare tekst.

### Feilrettinger

- Fiks

## 0.9.0
`;

describe('parseChangelog', () => {
  it('reads version sections newest first and skips the rest', () => {
    const entries = parseChangelog(sample);
    expect(entries.map((e) => e.version)).toEqual(['0.10.0', '0.9.1', '0.9.0']);
    expect(entries[0]).toEqual({ version: '0.10.0', date: '2026-11-01', notes: '- Ny ting\n- Enda en' });
    expect(entries[1].notes).toBe('Bare tekst.\n\n### Feilrettinger\n\n- Fiks');
    expect(entries[2]).toEqual({ version: '0.9.0', date: null, notes: '' });
  });
  it('handles CRLF', () => {
    expect(parseChangelog(sample.replace(/\n/g, '\r\n'))[0].notes).toBe('- Ny ting\n- Enda en');
  });
  it('the bundled CHANGELOG.md has the current version', () => {
    const entries = parseChangelog(changelogText);
    const { version } = JSON.parse(packageText) as { version: string };
    expect(entries.some((e) => e.version === version)).toBe(true);
  });
});

describe('compareVersions', () => {
  it('compares numerically', () => {
    expect(compareVersions('0.10.0', '0.9.3')).toBe(1);
    expect(compareVersions('0.5.0', '0.5.0')).toBe(0);
    expect(compareVersions('0.5', '0.5.1')).toBe(-1);
  });
});

describe('entriesSince', () => {
  const entries = parseChangelog(sample);
  const versions = (current: string, lastSeen: string | null, isNewUser = false) =>
    entriesSince(entries, current, lastSeen, isNewUser).map((e) => e.version);

  it('shows every version since the last start', () => {
    expect(versions('0.10.0', '0.9.0')).toEqual(['0.10.0', '0.9.1']);
    expect(versions('0.9.1', '0.9.0')).toEqual(['0.9.1']);
  });
  it('shows nothing for the same version or a downgrade', () => {
    expect(versions('0.10.0', '0.10.0')).toEqual([]);
    expect(versions('0.9.1', '0.10.0')).toEqual([]);
  });
  it('without a remembered version: the current one, but nothing for a new user', () => {
    expect(versions('0.10.0', null)).toEqual(['0.10.0']);
    expect(versions('0.10.0', null, true)).toEqual([]);
  });
});

describe('noteBlocks', () => {
  it('splits paragraphs, headings and lists', () => {
    expect(noteBlocks('Første linje\nfortsetter.\n\n### Tittel\n- a\n  mer om a\n* b\nEtter lista')).toEqual([
      { kind: 'paragraph', text: 'Første linje fortsetter.' },
      { kind: 'heading', text: 'Tittel' },
      { kind: 'list', items: ['a mer om a', 'b'] },
      { kind: 'paragraph', text: 'Etter lista' },
    ]);
  });
  it('a list right after a paragraph', () => {
    expect(noteBlocks('Nytt:\n- a')).toEqual([
      { kind: 'paragraph', text: 'Nytt:' },
      { kind: 'list', items: ['a'] },
    ]);
  });
});

describe('inlineSpans', () => {
  it('finds code, bold and italic', () => {
    expect(inlineSpans('Trykk `Ctrl+M` for **formel** eller *blokk*.')).toEqual([
      { text: 'Trykk ' },
      { text: 'Ctrl+M', style: 'code' },
      { text: ' for ' },
      { text: 'formel', style: 'bold' },
      { text: ' eller ' },
      { text: 'blokk', style: 'italic' },
      { text: '.' },
    ]);
  });
  it('leaves stray marks alone', () => {
    expect(inlineSpans('2 * 3 * 4 og ``` alene')).toEqual([{ text: '2 * 3 * 4 og ``` alene' }]);
  });
});
