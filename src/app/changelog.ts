/**
 * CHANGELOG.md, bundled with the app: one "## x.y.z – yyyy-mm-dd" section per
 * version (newest first). Shown as "Hva er nytt" after an update. Other
 * sections (e.g. "## Neste versjon", filled in before a release) are skipped.
 */

export interface ChangelogEntry {
  version: string;
  /** yyyy-mm-dd, if the heading has one. */
  date: string | null;
  /** The section's Markdown. */
  notes: string;
}

export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: { entry: ChangelogEntry; lines: string[] } | null = null;
  const finish = () => {
    if (current) current.entry.notes = current.lines.join('\n').trim();
  };
  for (const line of text.split(/\r?\n/)) {
    if (/^#{1,2}\s/.test(line)) {
      finish();
      const m = /^##\s+v?(\d+(?:\.\d+)*)\b(.*)$/.exec(line);
      current = m ? { entry: { version: m[1], date: /\d{4}-\d{2}-\d{2}/.exec(m[2])?.[0] ?? null, notes: '' }, lines: [] } : null;
      if (current) entries.push(current.entry);
    } else current?.lines.push(line);
  }
  finish();
  return entries.sort((a, b) => compareVersions(b.version, a.version));
}

/** Numeric comparison of dotted versions ("0.10.0" > "0.9.3"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/**
 * What to show when `current` starts: everything after the version that ran last
 * (`lastSeen`). Nothing for a new user or the same version. Without `lastSeen`
 * (an existing user's first start with this feature), just `current`.
 */
export function entriesSince(entries: ChangelogEntry[], current: string, lastSeen: string | null, isNewUser: boolean): ChangelogEntry[] {
  if (lastSeen === null) return isNewUser ? [] : entries.filter((e) => compareVersions(e.version, current) === 0);
  if (compareVersions(lastSeen, current) >= 0) return [];
  return entries.filter((e) => compareVersions(e.version, lastSeen) > 0 && compareVersions(e.version, current) <= 0);
}

// ---- The bit of Markdown release notes use ----

export type NoteBlock = { kind: 'heading' | 'paragraph'; text: string } | { kind: 'list'; items: string[] };

/** Headings, paragraphs and bullet lists; an indented line continues the item above. */
export function noteBlocks(markdown: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (para.length) blocks.push({ kind: 'paragraph', text: para.join(' ') });
    if (list) blocks.push({ kind: 'list', items: list });
    para = [];
    list = null;
  };
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const item = /^[-*+]\s+(.*)$/.exec(line);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (heading) {
      flush();
      blocks.push({ kind: 'heading', text: heading[1] });
    } else if (item) {
      if (para.length) flush();
      (list ??= []).push(item[1]);
    } else if (list && /^\s/.test(raw)) list[list.length - 1] += ' ' + line;
    else {
      if (list) flush();
      para.push(line);
    }
  }
  flush();
  return blocks;
}

export interface Span {
  text: string;
  style?: 'bold' | 'italic' | 'code';
}

/** `code`, **bold** and *italic*; everything else is plain text. */
export function inlineSpans(text: string): Span[] {
  const spans: Span[] = [];
  const re = /`([^`]+)`|\*\*(.+?)\*\*|\*(\S(?:.*?\S)?)\*/g;
  let last = 0;
  for (let m; (m = re.exec(text)); ) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) spans.push({ text: m[1], style: 'code' });
    else if (m[2] !== undefined) spans.push({ text: m[2], style: 'bold' });
    else spans.push({ text: m[3], style: 'italic' });
    last = re.lastIndex;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans;
}
