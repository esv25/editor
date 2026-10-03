/**
 * Python's line structure, read straight from the text: logical lines
 * (brackets and `\` join physical lines), their indentation, and top-level
 * colons and `=`. Gives exact messages for the errors beginners make most –
 * wrong indentation, a missing colon, `=` instead of `==` – where the parser
 * only knows that something is wrong somewhere.
 */
import type { Issue } from './types';

export interface LogicalLine {
  /** Start of the physical line the logical line begins on. */
  lineFrom: number;
  /** First character of code. */
  start: number;
  /** End of the code (before a trailing comment and spaces). */
  codeEnd: number;
  indent: string;
  /** Colons outside brackets and strings (not `:=`). */
  colons: number[];
  /** Single `=` outside brackets and strings (not `==`, `<=`, `+=` …). */
  equals: number[];
  /** The first two tokens, if they're words. */
  words: { text: string; from: number }[];
}

const PREFIX = /^(?:[rRbBuUfF]|[bB][rR]|[rR][bB]|[fF][rR]|[rR][fF])$/;
const isIdent = (ch: string) => /[\p{L}\p{N}_]/u.test(ch);
const isNewline = (ch: string) => ch === '\n' || ch === '\r';

/** Skip a string starting at its quote; returns the position after it. */
function skipString(text: string, i: number): number {
  const quote = text[i];
  const triple = text.startsWith(quote.repeat(3), i);
  let k = i + (triple ? 3 : 1);
  while (k < text.length) {
    const ch = text[k];
    if (ch === '\\') {
      k += 2;
      continue;
    }
    if (triple) {
      if (text.startsWith(quote.repeat(3), k)) return k + 3;
    } else {
      if (ch === quote) return k + 1;
      // Unterminated: the string (and the logical line) ends here.
      if (isNewline(ch)) return k;
    }
    k++;
  }
  return k;
}

export function pythonLogicalLines(text: string): LogicalLine[] {
  const lines: LogicalLine[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const lineFrom = i;
    let j = i;
    while (j < n && (text[j] === ' ' || text[j] === '\t' || text[j] === '\f')) j++;
    if (j >= n) break;
    if (isNewline(text[j]) || text[j] === '#') {
      // Blank or comment-only line.
      while (j < n && !isNewline(text[j])) j++;
      i = j + (text.startsWith('\r\n', j) ? 2 : 1);
      continue;
    }
    const line: LogicalLine = { lineFrom, start: j, codeEnd: j, indent: text.slice(lineFrom, j), colons: [], equals: [], words: [] };
    let depth = 0;
    let tokens = 0;
    let k = j;
    while (k < n) {
      const ch = text[k];
      if (isNewline(ch)) {
        if (depth > 0) {
          k++;
          continue;
        }
        break;
      }
      if (ch === '#') {
        while (k < n && !isNewline(text[k])) k++;
        continue;
      }
      if (ch === '\\' && isNewline(text[k + 1] ?? '')) {
        k += text.startsWith('\r\n', k + 1) ? 3 : 2;
        continue;
      }
      if (ch === ' ' || ch === '\t' || ch === '\f') {
        k++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        k = skipString(text, k);
        line.codeEnd = k;
        tokens++;
        continue;
      }
      if (isIdent(ch)) {
        let e = k;
        while (e < n && isIdent(text[e])) e++;
        const word = text.slice(k, e);
        if ((text[e] === '"' || text[e] === "'") && PREFIX.test(word)) {
          k = skipString(text, e);
          line.codeEnd = k;
          tokens++;
          continue;
        }
        if (tokens < 2 && !/^\d/.test(word)) line.words.push({ text: word, from: k });
        tokens++;
        k = e;
        line.codeEnd = k;
        continue;
      }
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
      else if (depth === 0 && ch === ':') {
        if (text[k + 1] === '=') {
          k += 2;
          line.codeEnd = k;
          tokens++;
          continue;
        }
        line.colons.push(k);
      } else if (depth === 0 && ch === '=') {
        const prev = text[k - 1] ?? '';
        if (text[k + 1] === '=') {
          k += 2;
          line.codeEnd = k;
          tokens++;
          continue;
        }
        if (!'=!<>:+-*/%&|^@'.includes(prev)) line.equals.push(k);
      }
      tokens++;
      k++;
      line.codeEnd = k;
    }
    lines.push(line);
    i = k + (text.startsWith('\r\n', k) ? 2 : 1);
  }
  return lines;
}

/** Indent width in columns (a tab goes to the next multiple of 8, like Python). */
function widthOf(indent: string): number {
  let w = 0;
  for (const ch of indent) w = ch === '\t' ? w + 8 - (w % 8) : w + 1;
  return w;
}

const HEADERS = new Set(['if', 'elif', 'else', 'for', 'while', 'def', 'class', 'try', 'except', 'finally', 'with']);

/** Statements that start a block and need a colon. */
function headerWord(line: LogicalLine): string | null {
  const [first, second] = line.words;
  if (!first || first.from !== line.start) return null;
  if (HEADERS.has(first.text)) return first.text;
  if (first.text === 'async' && second && ['def', 'for', 'with'].includes(second.text)) return second.text;
  return null;
}

/** Ends with a colon (nothing but a comment after it): the next line must be indented. */
function endsWithColon(line: LogicalLine): boolean {
  const last = line.colons[line.colons.length - 1];
  return last !== undefined && last + 1 === line.codeEnd;
}

export function pythonLineIssues(text: string): Issue[] {
  const issues: Issue[] = [];
  const lines = pythonLogicalLines(text);
  const stack = [0];
  let expectIndent = false;
  let opener: LogicalLine | null = null;
  const error = (from: number, to: number, message: string, explanation: string, extra: Partial<Issue> = {}) =>
    issues.push({ from, to, severity: 'error', feature: 'syntaxErrors', message, explanation, ...extra });

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const width = widthOf(line.indent);
    if (line.indent.includes(' ') && line.indent.includes('\t')) {
      issues.push({
        from: line.lineFrom,
        to: line.start,
        severity: 'warning',
        feature: 'syntaxErrors',
        message: 'Innrykket blander tabulator og mellomrom',
        explanation: 'Python kan ikke alltid se hvor langt inn en linje med både tabulator og mellomrom er. Bruk bare mellomrom (4 per nivå).',
      });
    }

    // Indentation, the way Python's tokenizer checks it.
    let top = stack[stack.length - 1];
    if (expectIndent) {
      if (width > top) {
        stack.push(width);
        top = width;
      } else {
        const what = opener ? `«${text.slice(opener.start, opener.codeEnd).trim().slice(0, 30)}»` : 'linja over';
        error(line.start, Math.max(line.codeEnd, line.start + 1), 'Mangler innrykk', `Linja etter ${what} slutter med kolon, så linjene som hører til den, må rykkes inn (Tab).`);
      }
    } else if (width > top) {
      error(line.start, Math.max(line.codeEnd, line.start + 1), 'Uventet innrykk', 'Linja er rykket lenger inn enn linja over, men linja over slutter ikke med kolon (:). Fjern innrykket, eller sett kolon på linja over hvis den skal starte en blokk.');
      stack.push(width);
      top = width;
    }
    if (width < top) {
      while (stack.length > 1 && stack[stack.length - 1] > width) stack.pop();
      if (stack[stack.length - 1] !== width) {
        error(line.start, Math.max(line.codeEnd, line.start + 1), 'Innrykket passer ikke med linjene over', 'Når en blokk slutter, må linja rykkes inn akkurat like langt som en av linjene over. Sjekk at antall mellomrom stemmer.');
        stack.push(width);
      }
    }

    const header = headerWord(line);
    const [first, second] = line.words;
    expectIndent = endsWithColon(line);
    opener = expectIndent ? line : null;

    if (header && first?.text === 'else' && second?.text === 'if' && /^else\s+if\b/.test(text.slice(first.from))) {
      error(first.from, second.from + 2, 'Python bruker «elif», ikke «else if»', 'I Python skrives «ellers hvis» som elif: «elif x > 5:».', {
        fixes: [{ label: 'Bytt til elif', changes: [{ from: first.from, to: second.from + 2, insert: 'elif' }] }],
      });
      expectIndent = true;
      opener = line;
      continue;
    }
    if (header && line.colons.length === 0) {
      error(line.codeEnd - 1, line.codeEnd, 'Mangler kolon (:) på slutten av linja', `Linjer som starter med «${header}» må slutte med kolon. Linjene under som hører til, rykkes inn.`, {
        fixes: [{ label: 'Legg til :', changes: [{ from: line.codeEnd, to: line.codeEnd, insert: ':' }] }],
      });
      // Treat it as a block opener when the next line is indented, so that isn't an error too.
      const next = lines[index + 1];
      expectIndent = !!next && widthOf(next.indent) > width;
      opener = line;
    }
    // Only in the condition: `if x: y = 1` assigns after the colon.
    const inCondition = line.equals.filter((e) => e < (line.colons[0] ?? Infinity));
    if (header && ['if', 'elif', 'while'].includes(header) && inCondition.length) {
      const at = inCondition[0];
      error(at, at + 1, 'Bruk == for å sammenligne', 'Ett likhetstegn (=) gir en variabel en ny verdi. For å sjekke om to ting er like, skriver du to: ==.', {
        fixes: [{ label: 'Bytt til ==', changes: [{ from: at, to: at + 1, insert: '==' }] }],
      });
    }
    if (first && first.from === line.start && second && ['let', 'var', 'const'].includes(first.text) && line.equals.length) {
      error(first.from, first.from + first.text.length, `Python trenger ikke «${first.text}»`, `I Python lager du en variabel bare ved å gi den en verdi: «${text.slice(second.from, line.codeEnd).trim()}».`, {
        fixes: [{ label: `Fjern ${first.text}`, changes: [{ from: first.from, to: second.from, insert: '' }] }],
      });
    }
    if (first && first.from === line.start && first.text === 'function' && second) {
      error(first.from, first.from + 8, 'Python bruker «def» for å lage funksjoner', 'En funksjon i Python skrives slik: «def navn(parameter):», med innholdet rykket inn under.', {
        fixes: [{ label: 'Bytt til def', changes: [{ from: first.from, to: first.from + 8, insert: 'def' }] }],
      });
    }
    if (first && first.from === line.start && (first.text === 'elsif' || first.text === 'elseif')) {
      error(first.from, first.from + first.text.length, 'Python skriver «elif»', 'I Python skrives «ellers hvis» som elif.', {
        fixes: [{ label: 'Bytt til elif', changes: [{ from: first.from, to: first.from + first.text.length, insert: 'elif' }] }],
      });
    }
  }
  const last = lines[lines.length - 1];
  if (expectIndent && last) {
    const colon = last.colons[last.colons.length - 1] ?? last.codeEnd - 1;
    error(colon, colon + 1, 'Mangler kode etter kolon', 'En linje som slutter med kolon, må ha minst én innrykket linje under seg. Skriv «pass» hvis den skal være tom foreløpig.');
  }
  return issues;
}
