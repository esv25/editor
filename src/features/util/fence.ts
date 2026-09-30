/**
 * Parsing of fenced code block lines: ```lang title="name"
 * Pure text (no syntax tree), so it can be used anywhere and tested easily.
 */
import type { Line, Text } from '@codemirror/state';

export interface FenceInfo {
  /** The fence characters, e.g. "```" or "~~~~". */
  fence: string;
  /** Language (first word of the info string), or "". */
  lang: string;
  /** Offsets within the line. With no language, langFrom = langTo = where it would go. */
  langFrom: number;
  langTo: number;
  /** Value of title="…", or null if there is none. */
  title: string | null;
  /** Offsets of the title value (inside the quotes). */
  titleFrom: number;
  titleTo: number;
}

const FENCE_RE = /^( {0,3})(`{3,}|~{3,})[ \t]*/;
const TITLE_RE = /\btitle=(?:"([^"]*)"|'([^']*)'|(\S+))/;

export function parseFence(text: string): FenceInfo | null {
  const m = FENCE_RE.exec(text);
  if (!m) return null;
  const fence = m[2];
  // Backtick fences can't have backticks in the info string.
  if (fence[0] === '`' && text.slice(m[0].length).includes('`')) return null;

  const langFrom = m[0].length;
  const langMatch = /^[^\s{]+/.exec(text.slice(langFrom));
  const lang = langMatch && !langMatch[0].startsWith('title=') ? langMatch[0] : '';
  const langTo = langFrom + lang.length;

  let title: string | null = null;
  let titleFrom = -1;
  let titleTo = -1;
  const t = TITLE_RE.exec(text.slice(langTo));
  if (t) {
    title = t[1] ?? t[2] ?? t[3];
    const quoted = t[3] === undefined;
    titleFrom = langTo + t.index + 'title='.length + (quoted ? 1 : 0);
    titleTo = titleFrom + title.length;
  }
  return { fence, lang, langFrom, langTo, title, titleFrom, titleTo };
}

/** Whether `text` closes a block opened with `fence`. */
export function isClosingFence(text: string, fence: string): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(text);
  return !!m && m[1][0] === fence[0] && m[1].length >= fence.length;
}

export interface FencedBlock {
  open: Line;
  info: FenceInfo;
  /** Closing fence line, or null if the block runs to the end of the document. */
  close: Line | null;
  code: string;
}

/** The fenced block whose opening fence is the line at `pos`, or null. */
export function blockAt(doc: Text, pos: number): FencedBlock | null {
  const open = doc.lineAt(pos);
  const info = parseFence(open.text);
  if (!info) return null;
  let close: Line | null = null;
  for (let n = open.number + 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (isClosingFence(line.text, info.fence)) {
      close = line;
      break;
    }
  }
  const codeFrom = Math.min(open.to + 1, doc.length);
  const codeTo = close ? Math.max(codeFrom, close.from - 1) : doc.length;
  return { open, info, close, code: doc.sliceString(codeFrom, codeTo) };
}
