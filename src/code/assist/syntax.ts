/**
 * Syntax errors for any language with a Lezer parser: the parser's error
 * nodes, brackets that are never closed (or closed without being opened),
 * and strings without their closing quote. Bracket and string messages point
 * at the real cause; the parser's own errors are kept as a fallback.
 */
import type { Tree } from '@lezer/common';
import type { Issue } from './types';

const OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const CLOSE: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
const BRACKET_NAME: Record<string, string> = {
  '(': 'Parentesen (',
  ')': 'Parentesen )',
  '[': 'Hakeparentesen [',
  ']': 'Hakeparentesen ]',
  '{': 'Krøllparentesen {',
  '}': 'Krøllparentesen }',
};

export function syntaxIssues(tree: Tree, text: string, langName: string): Issue[] {
  const issues: Issue[] = [];
  const stack: { name: string; from: number }[] = [];
  const errors: { from: number; to: number }[] = [];
  const strings: { from: number; to: number; name: string }[] = [];

  tree.iterate({
    enter(node) {
      if (node.type.isError) {
        errors.push({ from: node.from, to: node.to });
        return;
      }
      const name = node.name;
      if (name === 'String' || name === 'TemplateString' || name === 'FormatString') strings.push({ from: node.from, to: node.to, name });
      if (node.to - node.from !== 1) return;
      if (OPEN[name] && text[node.from] === name) stack.push({ name, from: node.from });
      else if (CLOSE[name] && text[node.from] === name) {
        let i = stack.length - 1;
        while (i >= 0 && stack[i].name !== CLOSE[name]) i--;
        if (i < 0) {
          issues.push({
            from: node.from,
            to: node.to,
            severity: 'error',
            feature: 'syntaxErrors',
            message: `${BRACKET_NAME[name]} har ingen ${CLOSE[name]} å lukke`,
            explanation: `Det er ingen ${CLOSE[name]} før denne ${name} som den kan høre sammen med. Fjern den, eller sett inn ${CLOSE[name]} der parentesen skal begynne.`,
          });
        } else {
          // Brackets opened inside this pair that were never closed.
          for (const open of stack.slice(i + 1)) issues.push(unclosed(open));
          stack.length = i;
        }
      }
    },
  });
  for (const open of stack) issues.push(unclosed(open));

  for (const s of strings) {
    const body = text.slice(s.from, s.to);
    const quote = /^[a-zA-Z]{0,2}('''|"""|'|"|`)/.exec(body)?.[1];
    if (!quote) continue;
    const prefix = body.indexOf(quote);
    if (body.length >= prefix + quote.length * 2 && body.endsWith(quote) && !/(^|[^\\])(\\\\)*\\$/.test(body.slice(0, -quote.length))) continue;
    const lineEnd = text.indexOf('\n', s.from);
    issues.push({
      from: s.from,
      to: Math.max(s.from + 1, Math.min(s.to, lineEnd < 0 ? s.to : lineEnd)),
      severity: 'error',
      feature: 'syntaxErrors',
      message: `Teksten mangler ${quote === '`' ? 'avsluttende `' : 'avsluttende anførselstegn'} (${quote})`,
      explanation: `Tekst (en streng) må slutte med det samme tegnet som den begynner med: ${quote}. Ellers tror ${langName} at resten av linja også er tekst.`,
    });
  }

  // The parser's own errors: one per line.
  const lineOf = lineIndex(text);
  const lines = new Set<number>();
  for (const e of errors) {
    let { from, to } = e;
    if (from === to) {
      // A missing token: mark the character next to it.
      if (from < text.length && text[from] !== '\n') to = from + 1;
      else if (from > 0 && text[from - 1] !== '\n') from = from - 1;
    }
    const line = lineOf(from);
    if (lines.has(line)) continue;
    lines.add(line);
    issues.push({
      from,
      to,
      severity: 'error',
      feature: 'syntaxErrors',
      generic: true,
      message: `Syntaksfeil: ${langName} forstår ikke koden her`,
      explanation: 'Noe mangler eller står feil her, f.eks. et komma, en parentes, et kolon eller et anførselstegn. Feilen kan også være på slutten av linja over.',
    });
  }
  return issues;
}

function unclosed(open: { name: string; from: number }): Issue {
  return {
    from: open.from,
    to: open.from + 1,
    severity: 'error',
    feature: 'syntaxErrors',
    unclosed: true,
    message: `${BRACKET_NAME[open.name]} blir aldri lukket`,
    explanation: `Hver ${open.name} må ha en ${OPEN[open.name]} som hører til. Sett inn ${OPEN[open.name]} der det som står i parentesen, slutter.`,
  };
}

/** A function giving the 0-based line number of a position in `text`. */
export function lineIndex(text: string): (pos: number) => number {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return (pos) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
}
