/**
 * Markdown → a small document model for export (PDF and Word).
 *
 * Parsed with the same Lezer grammar as the editor (GFM + math), but without
 * code-language parsers, so it runs anywhere (tested in tests/export.test.ts).
 * Raw HTML in the Markdown is never passed on as HTML: it becomes text.
 */
import { markdownLanguage } from '@codemirror/lang-markdown';
import type { SyntaxNode } from '@lezer/common';
import type { MarkdownParser } from '@lezer/markdown';
import { mathSyntax } from '../features/math/syntax';
import { parseFence } from '../features/util/fence';

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'strong' | 'em' | 'strike' | 'sup' | 'sub'; children: Inline[] }
  | { t: 'code'; text: string }
  | { t: 'link'; href: string; children: Inline[] }
  | { t: 'image'; src: string; alt: string }
  | { t: 'math'; latex: string }
  | { t: 'break' };

export interface ListItem {
  /** null: not a task; otherwise whether it's checked. */
  checked: boolean | null;
  blocks: Block[];
}

export type Align = 'left' | 'center' | 'right' | null;

export type Block =
  | { t: 'heading'; level: number; children: Inline[] }
  | { t: 'para'; children: Inline[] }
  | { t: 'code'; lang: string; title: string | null; text: string }
  | { t: 'math'; latex: string }
  | { t: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { t: 'quote'; blocks: Block[] }
  | { t: 'hr' }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] };

const parser = (markdownLanguage.parser as MarkdownParser).configure([mathSyntax]);

/** Marks that are syntax, not content. */
const MARKS = new Set([
  'HeaderMark', 'EmphasisMark', 'CodeMark', 'LinkMark', 'QuoteMark', 'ListMark', 'StrikethroughMark',
  'SuperscriptMark', 'SubscriptMark', 'MathMark', 'TaskMarker', 'CodeInfo', 'LinkTitle', 'LinkLabel', 'Comment',
  'ProcessingInstruction',
]);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '­', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', copy: '©', deg: '°', times: '×', divide: '÷', plusmn: '±', aelig: 'æ', oslash: 'ø', aring: 'å', AElig: 'Æ', Oslash: 'Ø', Aring: 'Å' };

function decodeEntity(entity: string): string {
  const m = /^&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(\w+));$/.exec(entity);
  if (!m) return entity;
  if (m[3]) return ENTITIES[m[3]] ?? entity;
  const code = m[1] ? parseInt(m[1], 10) : parseInt(m[2], 16);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '�';
}

export function parseDocument(text: string): Block[] {
  const tree = parser.parse(text);
  return blocksOf(tree.topNode, text);
}

function children(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
}

function blocksOf(parent: SyntaxNode, text: string): Block[] {
  const out: Block[] = [];
  for (const node of children(parent)) {
    const block = blockOf(node, text);
    if (block) out.push(block);
  }
  return out;
}

/** Indentation (columns) of the line `pos` is on, up to `pos`. */
function columnOf(text: string, pos: number): number {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  return pos - lineStart;
}

/** The lines between a block's first and last line, with `indent` columns of leading space removed. */
function innerLines(text: string, from: number, to: number, indent: number, dropLast: boolean): string {
  const lines = text.slice(from, to).split('\n').slice(1);
  if (dropLast && lines.length) lines.pop();
  const strip = new RegExp(`^ {0,${indent}}`);
  return lines.map((l) => l.replace(strip, '')).join('\n');
}

function blockOf(node: SyntaxNode, text: string): Block | null {
  const name = node.name;
  const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
  if (heading) {
    return { t: 'heading', level: Number(heading[1]), children: trimInlines(inlinesOf(node, text)) };
  }
  switch (name) {
    case 'Paragraph':
      return { t: 'para', children: trimInlines(inlinesOf(node, text)) };
    case 'FencedCode': {
      const firstLine = text.slice(node.from, text.indexOf('\n', node.from) < 0 ? node.to : text.indexOf('\n', node.from));
      const info = parseFence(firstLine.trimStart());
      const marks = node.getChildren('CodeMark');
      const closed = marks.length > 1;
      return {
        t: 'code',
        lang: info?.lang ?? '',
        title: info?.title ?? null,
        text: innerLines(text, node.from, node.to, columnOf(text, node.from), closed),
      };
    }
    case 'CodeBlock':
      return { t: 'code', lang: '', title: null, text: (text.slice(node.from - columnOf(text, node.from), node.to)).split('\n').map((l) => l.replace(/^ {0,4}|^\t/, '')).join('\n') };
    case 'BlockMath': {
      const marks = node.getChildren('MathMark');
      if (marks.length < 2) return { t: 'para', children: [{ t: 'text', text: text.slice(node.from, node.to) }] };
      return { t: 'math', latex: text.slice(marks[0].to, marks[marks.length - 1].from).trim() };
    }
    case 'BulletList':
    case 'OrderedList': {
      const items = node.getChildren('ListItem').map((item) => listItem(item, text));
      const firstMark = node.firstChild?.getChild('ListMark');
      const start = name === 'OrderedList' && firstMark ? parseInt(text.slice(firstMark.from, firstMark.to), 10) || 1 : 1;
      return { t: 'list', ordered: name === 'OrderedList', start, items };
    }
    case 'Blockquote':
      return { t: 'quote', blocks: blocksOf(node, text) };
    case 'HorizontalRule':
      return { t: 'hr' };
    case 'Table':
      return table(node, text);
    case 'HTMLBlock': {
      const raw = text.slice(node.from, node.to).trim();
      if (/^<!--[\s\S]*-->$/.test(raw)) return null;
      return { t: 'para', children: [{ t: 'text', text: raw }] };
    }
    default:
      return null; // link references, comments …
  }
}

function listItem(item: SyntaxNode, text: string): ListItem {
  let checked: boolean | null = null;
  const blocks: Block[] = [];
  for (const child of children(item)) {
    if (child.name === 'Task') {
      const marker = child.getChild('TaskMarker');
      checked = marker ? /x/i.test(text.slice(marker.from, marker.to)) : false;
      blocks.push({ t: 'para', children: trimInlines(inlinesOf(child, text)) });
    } else {
      const block = blockOf(child, text);
      if (block) blocks.push(block);
    }
  }
  return { checked, blocks };
}

function table(node: SyntaxNode, text: string): Block {
  const delimiterRow = children(node).find((c) => c.name === 'TableDelimiter');
  const align: Align[] = delimiterRow
    ? text
        .slice(delimiterRow.from, delimiterRow.to)
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((spec) => {
          const s = spec.trim();
          if (s.startsWith(':') && s.endsWith(':')) return 'center';
          if (s.endsWith(':')) return 'right';
          if (s.startsWith(':')) return 'left';
          return null;
        })
    : [];
  const cellsOf = (row: SyntaxNode): Inline[][] => {
    // Cells lie between the pipes; an empty cell has no TableCell node.
    const pipes = row.getChildren('TableDelimiter').map((d) => d.from);
    const bounds = [row.from, ...pipes, row.to];
    const segments: [number, number][] = [];
    for (let i = 0; i + 1 < bounds.length; i++) segments.push([bounds[i] + (i === 0 ? 0 : 1), bounds[i + 1]]);
    if (segments.length && !text.slice(...segments[0]).trim()) segments.shift();
    if (segments.length && !text.slice(...segments[segments.length - 1]).trim()) segments.pop();
    const cells = row.getChildren('TableCell');
    return segments.map(([from, to]) => {
      const cell = cells.find((c) => c.from >= from && c.to <= to);
      return cell ? trimInlines(inlinesOf(cell, text)) : [];
    });
  };
  const header = node.getChild('TableHeader');
  const head = header ? cellsOf(header) : [];
  const rows = node.getChildren('TableRow').map(cellsOf);
  const width = Math.max(head.length, align.length, ...rows.map((r) => r.length));
  const pad = (r: Inline[][]) => Array.from({ length: width }, (_, i) => r[i] ?? []);
  return { t: 'table', align: Array.from({ length: width }, (_, i) => align[i] ?? null), head: pad(head), rows: rows.map(pad) };
}

// --- Inline content ------------------------------------------------------------------

/** Plain text between syntax nodes: line breaks inside a paragraph are spaces. */
function plain(raw: string): Inline[] {
  const t = raw.replace(/[ \t]*\n[ \t>]*/g, ' ');
  return t ? [{ t: 'text', text: t }] : [];
}

function inlinesOf(parent: SyntaxNode, text: string, from = parent.from, to = parent.to): Inline[] {
  const out: Inline[] = [];
  let pos = from;
  for (const node of children(parent)) {
    if (node.from >= to) break;
    if (node.from > pos) out.push(...plain(text.slice(pos, node.from)));
    out.push(...inlineOf(node, text));
    // The space after a quote's ">" on continuation lines is part of the syntax.
    pos = Math.max(pos, node.name === 'QuoteMark' && text[node.to] === ' ' ? node.to + 1 : node.to);
  }
  if (pos < to) out.push(...plain(text.slice(pos, to)));
  return merge(out);
}

/** Content between a node's first and last marks (`*…*`, `[…]`). */
function between(node: SyntaxNode, text: string, mark: string): Inline[] {
  const marks = node.getChildren(mark);
  const from = marks.length ? marks[0].to : node.from;
  const to = marks.length > 1 ? marks[marks.length - 1].from : node.to;
  return inlinesOf(node, text, from, to);
}

function inlineOf(node: SyntaxNode, text: string): Inline[] {
  const raw = () => text.slice(node.from, node.to);
  switch (node.name) {
    case 'Emphasis':
      return [{ t: 'em', children: between(node, text, 'EmphasisMark') }];
    case 'StrongEmphasis':
      return [{ t: 'strong', children: between(node, text, 'EmphasisMark') }];
    case 'Strikethrough':
      return [{ t: 'strike', children: between(node, text, 'StrikethroughMark') }];
    case 'Superscript':
      return [{ t: 'sup', children: between(node, text, 'SuperscriptMark') }];
    case 'Subscript':
      return [{ t: 'sub', children: between(node, text, 'SubscriptMark') }];
    case 'InlineCode': {
      const marks = node.getChildren('CodeMark');
      const code = marks.length > 1 ? text.slice(marks[0].to, marks[marks.length - 1].from) : raw();
      // CommonMark: line endings become spaces, one surrounding space is stripped.
      const flat = code.replace(/\n/g, ' ');
      return [{ t: 'code', text: /^ .* $/.test(flat) && flat.trim() ? flat.slice(1, -1) : flat }];
    }
    case 'InlineMath': {
      const marks = node.getChildren('MathMark');
      if (marks.length < 2) return plain(raw());
      return [{ t: 'math', latex: text.slice(marks[0].to, marks[marks.length - 1].from).trim() }];
    }
    case 'Link': {
      const url = node.getChild('URL');
      const label = node.getChildren('LinkMark');
      const content = label.length >= 2 ? inlinesOf(node, text, label[0].to, label[1].from) : plain(raw());
      return url ? [{ t: 'link', href: text.slice(url.from, url.to).replace(/^<|>$/g, ''), children: content }] : content;
    }
    case 'Autolink':
    case 'URL': {
      const url = node.name === 'URL' ? raw() : text.slice(node.from + 1, node.to - 1);
      const href = /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(url) ? `mailto:${url}` : /^www\./i.test(url) ? `https://${url}` : url;
      return [{ t: 'link', href, children: [{ t: 'text', text: url }] }];
    }
    case 'Image': {
      const url = node.getChild('URL');
      const marks = node.getChildren('LinkMark');
      const alt = marks.length >= 2 ? text.slice(marks[0].to, marks[1].from) : '';
      return url ? [{ t: 'image', src: text.slice(url.from, url.to), alt }] : plain(raw());
    }
    case 'HardBreak':
      return [{ t: 'break' }];
    case 'Escape':
      return [{ t: 'text', text: raw().slice(1) }];
    case 'Entity':
      return [{ t: 'text', text: decodeEntity(raw()) }];
    case 'HTMLTag':
      return /^<br\s*\/?>$/i.test(raw()) ? [{ t: 'break' }] : [];
    default:
      return MARKS.has(node.name) ? [] : plain(raw());
  }
}

/** Join neighbouring text pieces. */
function merge(items: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (item.t === 'text' && last?.t === 'text') out[out.length - 1] = { t: 'text', text: last.text + item.text };
    else out.push(item);
  }
  return out;
}

/** Strip leading/trailing whitespace of a block's content. */
function trimInlines(items: Inline[]): Inline[] {
  const out = [...items];
  const first = out[0];
  if (first?.t === 'text') out[0] = { t: 'text', text: first.text.trimStart() };
  const last = out[out.length - 1];
  if (last?.t === 'text') out[out.length - 1] = { t: 'text', text: last.text.trimEnd() };
  return out.filter((i) => i.t !== 'text' || i.text);
}

/** The plain text of inline content (alt texts, titles). */
export function inlineText(items: Inline[]): string {
  return items
    .map((i) => {
      switch (i.t) {
        case 'text':
        case 'code':
          return i.text;
        case 'math':
          return i.latex;
        case 'image':
          return i.alt;
        case 'break':
          return '\n';
        default:
          return inlineText(i.children);
      }
    })
    .join('');
}

/** Every image source in the document, in order (without duplicates). */
export function imageSources(blocks: Block[]): string[] {
  const found = new Set<string>();
  const inl = (items: Inline[]) => {
    for (const i of items) {
      if (i.t === 'image') found.add(i.src);
      else if ('children' in i) inl(i.children);
    }
  };
  const walk = (list: Block[]) => {
    for (const b of list) {
      if (b.t === 'para' || b.t === 'heading') inl(b.children);
      else if (b.t === 'quote') walk(b.blocks);
      else if (b.t === 'list') b.items.forEach((item) => walk(item.blocks));
      else if (b.t === 'table') [b.head, ...b.rows].forEach((r) => r.forEach(inl));
    }
  };
  walk(blocks);
  return [...found];
}
