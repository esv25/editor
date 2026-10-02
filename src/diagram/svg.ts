/**
 * A tiny description of SVG elements. The same tree is turned into live DOM
 * (the canvas) and into text (the saved file), so what you see is what's saved.
 */

export interface SvgNode {
  tag: string;
  attrs?: Record<string, string | number | undefined>;
  children?: SvgNode[];
  text?: string;
}

export function h(tag: string, attrs: SvgNode['attrs'] = {}, children: SvgNode[] = [], text?: string): SvgNode {
  return { tag, attrs, children, text };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const fmt = (value: string | number) => (typeof value === 'number' ? String(Math.round(value * 100) / 100) : value);

export function toSvgString(node: SvgNode, indent = ''): string {
  const attrs = Object.entries(node.attrs ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${escapeXml(fmt(v!))}"`)
    .join('');
  const children = node.children ?? [];
  if (!children.length && node.text === undefined) return `${indent}<${node.tag}${attrs}/>`;
  if (!children.length) return `${indent}<${node.tag}${attrs}>${escapeXml(node.text!)}</${node.tag}>`;
  const inner = children.map((c) => toSvgString(c, `${indent}  `)).join('\n');
  return `${indent}<${node.tag}${attrs}>\n${inner}\n${indent}</${node.tag}>`;
}

export function toDom(node: SvgNode): SVGElement {
  const el = document.createElementNS(SVG_NS, node.tag);
  for (const [k, v] of Object.entries(node.attrs ?? {})) {
    if (v !== undefined) el.setAttribute(k, fmt(v));
  }
  if (node.text !== undefined) el.textContent = node.text;
  for (const child of node.children ?? []) el.append(toDom(child));
  return el;
}
