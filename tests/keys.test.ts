import { describe, expect, it } from 'vitest';
import { matchesKey } from '../src/commands/keys';

const key = (key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}, code = '') => ({
  key,
  code,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  metaKey: false,
});

describe('matchesKey', () => {
  it('matches function keys with and without modifiers', () => {
    expect(matchesKey(key('F5'), 'F5')).toBe(true);
    expect(matchesKey(key('F5', { shift: true }), 'F5')).toBe(false);
    expect(matchesKey(key('F5', { shift: true }), 'Shift-F5')).toBe(true);
    expect(matchesKey(key('F5', { ctrl: true, shift: true }), 'Mod-Shift-F5')).toBe(true);
    expect(matchesKey(key('F11', { shift: true }), 'Shift-F11')).toBe(true);
  });

  it('matches letters regardless of case', () => {
    expect(matchesKey(key('j', { ctrl: true }, 'KeyJ'), 'Mod-j')).toBe(true);
    expect(matchesKey(key('J', { ctrl: true, shift: true }, 'KeyJ'), 'Mod-j')).toBe(false);
  });

  it('matches digits by physical key when Shift changes the character (Norwegian layout)', () => {
    expect(matchesKey(key('/', { ctrl: true, shift: true }, 'Digit7'), 'Mod-Shift-7')).toBe(true);
  });

  it('does not treat AltGr (Ctrl+Alt) as Ctrl', () => {
    expect(matchesKey(key('@', { ctrl: true, alt: true }, 'Digit2'), 'Mod-2')).toBe(false);
  });
});
