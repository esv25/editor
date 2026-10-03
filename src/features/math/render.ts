/**
 * Drawing formulas with KaTeX (the only part of the math tool that comes
 * from a library: TeX layout and fonts). Finished formulas are cached as
 * HTML; the formula field renders its marked-up LaTeX directly.
 */
import katex from 'katex';
// Chemistry: \ce{H2O}, \ce{2H2 + O2 -> 2H2O}.
import 'katex/contrib/mhchem';
import 'katex/dist/katex.min.css';

/** Only the marker commands the formula field writes are trusted. */
const trust = (context: { command: string }) => context.command === '\\htmlData' || context.command === '\\htmlClass';

const cache = new Map<string, string>();
const CACHE_LIMIT = 800;

export interface RenderResult {
  html: string;
  error: string | null;
}

/** HTML for a finished formula (cached). Errors show the source in red. */
export function renderMath(latex: string, display: boolean): RenderResult {
  const key = (display ? 'D' : 'I') + latex;
  const hit = cache.get(key);
  if (hit !== undefined) return { html: hit, error: null };
  try {
    const html = katex.renderToString(latex, { displayMode: display, throwOnError: true, strict: 'ignore', output: 'html', trust });
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(key, html);
    return { html, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message.replace(/^KaTeX parse error: /, '') : String(err);
    const html = katex.renderToString(latex, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html', errorColor: 'var(--syn-invalid)' });
    return { html, error };
  }
}

/** Render into an element; throws on errors (the field falls back to safer LaTeX). */
export function renderInto(el: HTMLElement, latex: string, display: boolean): void {
  katex.render(latex, el, { displayMode: display, throwOnError: true, strict: 'ignore', output: 'html', trust });
}

/** Whether KaTeX can render this (for tests and the panel). */
export function canRender(latex: string, display = false): boolean {
  try {
    katex.renderToString(latex, { displayMode: display, throwOnError: true, strict: 'ignore', trust });
    return true;
  } catch {
    return false;
  }
}
