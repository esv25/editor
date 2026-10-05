/**
 * Just enough XML for export: escaping, and reading the well-formed MathML
 * KaTeX writes (no DOM, so it runs in tests too).
 */

export const esc = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
    // Control characters (except tab and line breaks) aren't allowed in XML 1.0.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}
export type XmlNode = XmlElement | string;

const unescape = (text: string): string =>
  text.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g, (_, dec, hex, name) =>
    dec || hex ? String.fromCodePoint(parseInt(dec ?? hex, dec ? 10 : 16)) : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name as 'amp']!,
  );

/** Parse a fragment; returns its top-level nodes. Comments and declarations are skipped. */
export function parseXml(source: string): XmlNode[] {
  const root: XmlElement = { name: '', attrs: {}, children: [] };
  const stack = [root];
  const tag = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<[?!][^>]*>/g;
  let pos = 0;
  for (let m = tag.exec(source); m; m = tag.exec(source)) {
    const top = stack[stack.length - 1];
    if (m.index > pos) top.children.push(unescape(source.slice(pos, m.index)));
    pos = m.index + m[0].length;
    if (!m[2]) continue;
    if (m[1]) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[3].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unescape(a[2] ?? a[3]);
    const el: XmlElement = { name: m[2], attrs, children: [] };
    top.children.push(el);
    if (!m[4]) stack.push(el);
  }
  if (pos < source.length) stack[stack.length - 1].children.push(unescape(source.slice(pos)));
  return root.children;
}

export const elements = (nodes: XmlNode[]): XmlElement[] => nodes.filter((n): n is XmlElement => typeof n !== 'string');

export const textOf = (node: XmlNode): string => (typeof node === 'string' ? node : node.children.map(textOf).join(''));
