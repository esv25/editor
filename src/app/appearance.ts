/**
 * Applies appearance settings (theme, fonts, line width) to the document
 * as CSS variables / a data-theme attribute.
 */
import { getSettings, onSettingsChange, type Settings } from '../settings';

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

export function resolvedTheme(settings: Settings = getSettings()): 'light' | 'dark' {
  if (settings.theme === 'system') return darkQuery.matches ? 'dark' : 'light';
  return settings.theme;
}

function apply(settings: Settings): void {
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme(settings);
  root.style.setProperty('--font-prose', settings.fontFamily);
  root.style.setProperty('--font-mono', settings.monoFontFamily);
  root.style.setProperty('--font-size', `${settings.fontSize}px`);
  root.style.setProperty('--line-height', String(settings.lineHeight));
  root.style.setProperty('--line-width', `${settings.lineWidth}ch`);
}

export function initAppearance(): void {
  apply(getSettings());
  onSettingsChange(apply);
  darkQuery.addEventListener('change', () => apply(getSettings()));
}
