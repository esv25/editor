import { describe, expect, it } from 'vitest';
import { defaultHeadingSuggestionConfig as cfg, isHeadingCandidate } from '../src/features/headingSuggestion/rules';

const ctx = (text: string, prevText: string | null = '', nextText: string | null = '', blockType = 'Paragraph') => ({
  text,
  prevText,
  nextText,
  blockType,
});

describe('heading suggestion rules', () => {
  it('suggests short standalone lines', () => {
    expect(isHeadingCandidate(ctx('Innledning'), cfg)).toBe(true);
    expect(isHeadingCandidate(ctx('Innledning', null, null), cfg)).toBe(true);
  });
  it('rejects prose-like lines', () => {
    expect(isHeadingCandidate(ctx('Dette er en setning.'), cfg)).toBe(false);
    expect(isHeadingCandidate(ctx('x'.repeat(41)), cfg)).toBe(false);
    expect(isHeadingCandidate(ctx('Innledning', 'tekst over'), cfg)).toBe(false);
    expect(isHeadingCandidate(ctx('Innledning', '', 'tekst under'), cfg)).toBe(false);
    expect(isHeadingCandidate(ctx('- punkt', '', '', 'BulletList'), cfg)).toBe(false);
  });
  it('rejects lines with a formula', () => {
    expect(isHeadingCandidate(ctx('$x = 2$'), cfg)).toBe(false);
    expect(isHeadingCandidate(ctx('Svar: $x = 2$'), cfg)).toBe(false);
  });
  it('respects disabled rules', () => {
    expect(isHeadingCandidate(ctx('Setning.'), { ...cfg, disabledRules: ['ending'] })).toBe(true);
  });
});
