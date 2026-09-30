import { describe, expect, it } from 'vitest';
import { suggestFileName, titleFromContent } from '../src/app/fileNames';

describe('suggestFileName', () => {
  it('uses the first heading or line', () => {
    expect(suggestFileName('# Møtereferat 3. mai\n\ntekst')).toBe('Møtereferat 3. mai');
    expect(suggestFileName('\n\nHandleliste\n- melk')).toBe('Handleliste');
    expect(suggestFileName('- [ ] Ring **Kari**')).toBe('Ring Kari');
  });
  it('removes characters Windows does not allow', () => {
    expect(suggestFileName('# Plan: A/B? "test"')).toBe('Plan AB test');
    expect(suggestFileName('C:\\mappe\\fil')).toBe('Cmappefil');
    expect(suggestFileName('Slutt med punktum.')).toBe('Slutt med punktum');
  });
  it('shortens long lines', () => {
    expect(suggestFileName('x'.repeat(100)).length).toBe(60);
  });
  it('falls back to a timestamp', () => {
    expect(suggestFileName('```\ncode\n```', new Date(2026, 8, 30, 14, 5))).toBe('Notat 2026-09-30 14.05');
    expect(suggestFileName('', new Date(2026, 0, 2, 3, 4))).toBe('Notat 2026-01-02 03.04');
  });
});

describe('titleFromContent', () => {
  it('returns null when there is no text', () => {
    expect(titleFromContent('')).toBeNull();
    expect(titleFromContent('\n\n```\nx\n```')).toBeNull();
    expect(titleFromContent('# Tittel')).toBe('Tittel');
  });
});
