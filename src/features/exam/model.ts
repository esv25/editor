/**
 * Exam practice ("Eksamensøving"): a syllabus written as a task list, where each
 * topic can carry an understanding rating and short notes. Plain text only:
 *
 *   - [ ] Derivasjon {7/10} [Notat](derivasjon.md) [Video](https://…) ^[f'(x) er stigningstallet]
 *
 * `{n/10}` is the rating (1–10; none = not rated yet), `^[…]` a note (pandoc's inline footnote). Pure logic, no DOM.
 */

export const MAX_RATING = 10;

/** Colour class for a rating: 1–10 share five colours; none is grey. */
export const ratingClass = (value: number | null) => `cm-exam-r${value === null ? 0 : Math.ceil(value / 2)}`;

export interface Token {
  /** Offsets within the line. */
  from: number;
  to: number;
}

export interface RatingToken extends Token {
  value: number;
}

export interface NoteToken extends Token {
  text: string;
}

const RATING = /\{(10|[1-9])\/10\}/g;

/** Spans of inline code, where tokens aren't tokens. */
function codeSpans(line: string): Token[] {
  const spans: Token[] = [];
  const re = /(`+)[^`]*?\1/g;
  for (let m; (m = re.exec(line)); ) spans.push({ from: m.index, to: m.index + m[0].length });
  return spans;
}

const inside = (spans: Token[], at: number) => spans.some((s) => at >= s.from && at < s.to);

export function findRatings(line: string): RatingToken[] {
  const code = codeSpans(line);
  return [...line.matchAll(RATING)]
    .filter((m) => !inside(code, m.index!))
    .map((m) => ({ from: m.index!, to: m.index! + m[0].length, value: Number(m[1]) }));
}

/** `^[…]` notes; brackets may nest, `\]` is a literal bracket. */
export function findNotes(line: string): NoteToken[] {
  const code = codeSpans(line);
  const notes: NoteToken[] = [];
  for (let i = line.indexOf('^['); i >= 0; i = line.indexOf('^[', i + 1)) {
    if (inside(code, i)) continue;
    let depth = 0;
    for (let j = i + 1; j < line.length; j++) {
      const c = line[j];
      if (c === '\\') { j++; continue; }
      if (c === '[') depth++;
      else if (c === ']' && --depth === 0) {
        notes.push({ from: i, to: j + 1, text: unescapeNote(line.slice(i + 2, j)) });
        i = j;
        break;
      }
    }
  }
  return notes;
}

/** Note text as written in the file: one line, unbalanced brackets escaped. */
export function escapeNote(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\\/g, '\\\\').replace(/([[\]|])/g, '\\$1').trim();
}

export function unescapeNote(raw: string): string {
  return raw.replace(/\\(.)/g, '$1');
}

export const ratingText = (value: number) => `{${value}/10}`;
export const noteText = (text: string) => `^[${escapeNote(text)}]`;

/**
 * Where a new rating goes in a list line: right after the topic text, before
 * links and notes, so the line reads "Emne {7/10} [lenker] ^[notat]".
 */
export function ratingInsertAt(line: string): number {
  const stops = [line.search(/\s\[[^\]]*\]\(/), line.search(/\s\^\[/)].filter((i) => i >= 0);
  return stops.length ? Math.min(...stops) : line.trimEnd().length;
}

export interface ExamItem {
  /** 1-based line number. */
  line: number;
  title: string;
  rating: number | null;
  done: boolean;
  section: string;
  /** From a "Uke" column ("12", "uke 12"); null when there's none. */
  week: number | null;
}

/** Topic text with tokens, links and markup stripped. */
export function topicTitle(text: string): string {
  let rest = text.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '');
  for (const t of [...findNotes(rest), ...findRatings(rest)].sort((a, b) => b.from - a.from)) {
    rest = rest.slice(0, t.from) + rest.slice(t.to);
  }
  return rest.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').trim();
}

/** A table row's cells (pipes escaped with `\|` stay in the cell). */
export function rowCells(line: string): string[] | null {
  if (!/^\s*\|/.test(line)) return null;
  const cells = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/);
  return cells.map((c) => c.trim());
}

export const isDelimiterRow = (line: string) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);

/** "12", "uke 12", "U12" → 12. */
export function weekOf(cell: string): number | null {
  const m = /^\D*?(\d{1,2})\b/.exec(cell.trim());
  return m ? Number(m[1]) : null;
}

/** Which column of a header row has the given name, or -1. */
const columnOf = (header: string[], name: RegExp) => header.findIndex((h) => name.test(h));
const WEEK = /^\s*uke\s*$/i;
const RATED = /forståelse/i;
const TOPIC = /^\s*(emne|tema|pensum)\s*$/i;

/** The topic of a table row: the "Emne" column, else the first cell that isn't a rating or week. */
function rowTitle(cells: string[], header: string[] | null): string {
  const topic = header ? columnOf(header, TOPIC) : -1;
  const week = header ? columnOf(header, WEEK) : -1;
  const cell = topic >= 0 ? cells[topic] : cells.find((c, i) => c && i !== week && !findRatings(c).length && !c.startsWith('^['));
  return topicTitle(cell ?? '');
}

/** Every list item or table row that has a rating, with the heading it sits under. */
export function examItems(lines: string[]): ExamItem[] {
  const items: ExamItem[] = [];
  let section = '';
  let header: string[] | null = null;
  lines.forEach((text, i) => {
    const heading = /^#{1,6}\s+(.*)$/.exec(text);
    if (heading) { section = heading[1].trim(); return; }
    const cells = rowCells(text);
    if (!cells) header = null;
    else if (isDelimiterRow(text)) return;
    else if (i + 1 < lines.length && isDelimiterRow(lines[i + 1])) { header = cells; return; }
    const rating = findRatings(text)[0];
    // In a table with a "Forståelse" column, unrated rows count too (not rated yet).
    const examRow = !!cells && !!header && columnOf(header, RATED) >= 0;
    if (!rating && !examRow) return;
    if (cells) {
      const weekCol = header ? columnOf(header, WEEK) : -1;
      const week = weekCol >= 0 ? weekOf(cells[weekCol] ?? '') : null;
      items.push({ line: i + 1, title: rowTitle(cells, header), rating: rating?.value ?? null, done: (rating?.value ?? 0) >= MAX_RATING, section, week });
      return;
    }
    if (!/^\s*(?:[-*+]|\d+[.)])\s/.test(text)) return;
    const week = /\buke\s*(\d{1,2})\b/i.exec(text);
    if (!rating) return;
    items.push({ line: i + 1, title: topicTitle(text), rating: rating.value, done: /^\s*\S+\s+\[[xX]\]/.test(text), section, week: week ? Number(week[1]) : null });
  });
  return items;
}

/** Average of the rated topics, or null. */
export function averageRating(items: ExamItem[]): number | null {
  const rated = items.filter((i) => i.rating !== null);
  return rated.length ? rated.reduce((sum, i) => sum + i.rating!, 0) / rated.length : null;
}

export interface WeekStats {
  week: number | null;
  count: number;
  /** Of the rated topics; null when none are. */
  average: number | null;
  /** How many topics have each rating 1–10; index 0 = not rated. */
  byRating: number[];
}

/** Ratings per week, in week order (topics without a week last). */
export function weekStats(items: ExamItem[]): WeekStats[] {
  const map = new Map<number | null, ExamItem[]>();
  for (const item of items) map.set(item.week, [...(map.get(item.week) ?? []), item]);
  return [...map.entries()]
    .sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity))
    .map(([week, list]) => {
      const byRating = Array.from({ length: MAX_RATING + 1 }, (_, r) => list.filter((i) => (i.rating ?? 0) === r).length);
      return { week, count: list.length, average: averageRating(list), byRating };
    });
}

/**
 * Every table with a "Uke" column, its rows sorted by week (stable; rows without a
 * week last). Returns the changed lines as [lineIndex, newText] pairs.
 */
export function sortTablesByWeek(lines: string[]): Map<number, string> {
  const out = new Map<number, string>();
  for (let i = 0; i + 1 < lines.length; i++) {
    const header = rowCells(lines[i]);
    if (!header || !isDelimiterRow(lines[i + 1])) continue;
    const col = columnOf(header, WEEK);
    let end = i + 2;
    while (end < lines.length && rowCells(lines[end])) end++;
    if (col >= 0) {
      const rows = lines.slice(i + 2, end);
      const key = (row: string) => weekOf(rowCells(row)?.[col] ?? '') ?? Infinity;
      const sorted = rows.map((row, n) => ({ row, n })).sort((a, b) => key(a.row) - key(b.row) || a.n - b.n).map((r) => r.row);
      sorted.forEach((row, n) => { if (row !== rows[n]) out.set(i + 2 + n, row); });
    }
    i = end - 1;
  }
  return out;
}

/** A starter syllabus for "Ny eksamensøving": one table per theme. */
export const examTemplate = `# Eksamensøving: Fag

Klikk i Forståelse-kolonnen for å gi hvert emne et tall fra 1 til 10, og på 💬 for å lese notatet. Tab i siste celle lager en ny rad. «Oversikt» viser hvordan det står til uke for uke.

## Tema 1

| Uke | Emne | Forståelse | Notat | Lenker |
| --- | --- | --- | --- | --- |
| 1 | Første emne |  | ^[Kort forklaring av emnet] |  |
| 2 | Andre emne |  |  |  |

## Tema 2

| Uke | Emne | Forståelse | Notat | Lenker |
| --- | --- | --- | --- | --- |
| 3 | Tredje emne |  |  |  |
`;
