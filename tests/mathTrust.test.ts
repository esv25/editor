import { describe, expect, it } from 'vitest';
import { renderMath } from '../src/features/math/render';

/** What a formula in someone else's document can make KaTeX output. */
describe('KaTeX trust', () => {
  const html = (latex: string) => renderMath(latex, false).html;

  it('keeps the formula field’s own markers', () => {
    expect(html('\\htmlClass{mf-ph}{\\square}')).toContain('class="enclosing mf-ph"');
    expect(html('\\htmlData{node=3}{x}')).toContain('data-node="3"');
  });

  it('refuses links, images, styles, ids and app classes', () => {
    for (const latex of [
      '\\href{javascript:alert(1)}{x}',
      '\\url{javascript:alert(1)}',
      '\\includegraphics[height=1em]{https://example.com/t.png}',
      '\\htmlStyle{position:fixed;inset:0}{x}',
      '\\htmlId{app}{x}',
      '\\htmlClass{cm-editor}{x}',
      '\\htmlClass{mf-ph x}{x}',
    ]) {
      const out = html(latex);
      expect(out, latex).not.toMatch(/<a |href=|<img|position:fixed|id="app"|class="enclosing cm-editor|mf-ph x/);
    }
  });
});
