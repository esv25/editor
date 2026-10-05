/**
 * Document model → HTML for printing and PDF. All text is escaped; the only
 * markup that isn't ours is KaTeX's (rendered with the app's `trust`).
 * Pure (tested in tests/export.test.ts); print.ts puts it on the page.
 */
import { renderMath } from '../features/math/render';
import type { Block, Inline } from './document';
import { esc } from './xml';

/** Image source (as written in the Markdown) → URL the page can show, if it could be read. */
export type ImageUrls = Map<string, string>;

const SAFE_LINK = /^(https?:|mailto:)/i;

function inlines(items: Inline[], images: ImageUrls): string {
  return items.map((i) => inline(i, images)).join('');
}

function inline(item: Inline, images: ImageUrls): string {
  switch (item.t) {
    case 'text':
      return esc(item.text);
    case 'strong':
      return `<strong>${inlines(item.children, images)}</strong>`;
    case 'em':
      return `<em>${inlines(item.children, images)}</em>`;
    case 'strike':
      return `<s>${inlines(item.children, images)}</s>`;
    case 'sup':
      return `<sup>${inlines(item.children, images)}</sup>`;
    case 'sub':
      return `<sub>${inlines(item.children, images)}</sub>`;
    case 'code':
      return `<code>${esc(item.text)}</code>`;
    case 'break':
      return '<br>';
    case 'math':
      return renderMath(item.latex, false).html;
    case 'link':
      return SAFE_LINK.test(item.href)
        ? `<a href="${esc(item.href)}">${inlines(item.children, images)}</a>`
        : inlines(item.children, images);
    case 'image': {
      const url = images.get(item.src);
      return url ? `<img src="${esc(url)}" alt="${esc(item.alt)}">` : `<span class="missing-image">[${esc(item.alt || 'bilde')}]</span>`;
    }
  }
}

function block(b: Block, images: ImageUrls): string {
  switch (b.t) {
    case 'heading':
      return `<h${b.level}>${inlines(b.children, images)}</h${b.level}>`;
    case 'para': {
      const only = b.children.length === 1 ? b.children[0] : null;
      if (only?.t === 'image' && images.has(only.src)) {
        const caption = only.alt ? `<figcaption>${esc(only.alt)}</figcaption>` : '';
        return `<figure>${inline(only, images)}${caption}</figure>`;
      }
      return `<p>${inlines(b.children, images)}</p>`;
    }
    case 'math':
      return `<div class="math-block">${renderMath(b.latex, true).html}</div>`;
    case 'code': {
      const title = b.title ? `<div class="code-title">${esc(b.title)}</div>` : '';
      return `<div class="code">${title}<pre><code>${esc(b.text)}</code></pre></div>`;
    }
    case 'quote':
      return `<blockquote>${blocks(b.blocks, images)}</blockquote>`;
    case 'hr':
      return '<hr>';
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
      const items = b.items
        .map((item) => {
          const body = blocks(item.blocks, images);
          if (item.checked === null) return `<li>${body}</li>`;
          return `<li class="task${item.checked ? ' done' : ''}"><span class="box">${item.checked ? '☒' : '☐'}</span>${body}</li>`;
        })
        .join('');
      return `<${tag}${start}>${items}</${tag}>`;
    }
    case 'table': {
      const cell = (tag: string, content: Inline[], i: number) =>
        `<${tag}${b.align[i] ? ` style="text-align:${b.align[i]}"` : ''}>${inlines(content, images)}</${tag}>`;
      const head = `<tr>${b.head.map((c, i) => cell('th', c, i)).join('')}</tr>`;
      const rows = b.rows.map((r) => `<tr>${r.map((c, i) => cell('td', c, i)).join('')}</tr>`).join('');
      return `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;
    }
  }
}

export function blocks(list: Block[], images: ImageUrls): string {
  return list.map((b) => block(b, images)).join('\n');
}
