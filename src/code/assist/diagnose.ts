/**
 * Turns the analysis into problems with Norwegian messages: unknown names
 * (with «mente du …?»), names used before they get a value, unused code, and
 * syntax errors. Plain functions of (tree, text), so they're tested in Node.
 */
import type { Tree } from '@lezer/common';
import { jsGlobals, jsLookalikes, pythonBuiltins, pythonImportHints, pythonLookalikes, pythonShadowable } from './globals';
import { analyzeJavaScript, type JsAnalysis } from './javascript';
import type { CodeHelpFeature } from './levels';
import { analyzePython, type PythonAnalysis } from './python';
import { pythonLineIssues } from './pythonLines';
import { lineIndex, syntaxIssues } from './syntax';
import type { Binding, Fix, Issue, Ref, Scope } from './types';

export type AssistLang = 'python' | 'javascript';

/** Which analyzer a language uses (null: only syntax errors and the visual aids). */
export function assistLang(lang: string): AssistLang | null {
  if (lang === 'python') return 'python';
  if (['javascript', 'typescript', 'jsx', 'tsx'].includes(lang)) return 'javascript';
  return null;
}

const LANG_NAMES: Record<string, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  json: 'JSON',
  css: 'CSS',
  html: 'HTML',
  java: 'Java',
  cpp: 'C++',
  c: 'C',
  rust: 'Rust',
  go: 'Go',
  sql: 'SQL',
  yaml: 'YAML',
  xml: 'XML',
};

export type AnyAnalysis = (PythonAnalysis & { lang: 'python' }) | (JsAnalysis & { lang: 'javascript' });

export function analyze(lang: AssistLang, tree: Tree, text: string): AnyAnalysis {
  return lang === 'python' ? { ...analyzePython(tree, text), lang } : { ...analyzeJavaScript(tree, text), lang };
}

/** All problems in the file the given features ask for, sorted by position. */
export function diagnose(tree: Tree, text: string, lang: string, features: Set<CodeHelpFeature>, analysis?: AnyAnalysis | null): Issue[] {
  const kind = assistLang(lang);
  const langName = LANG_NAMES[lang] ?? (lang ? lang[0].toUpperCase() + lang.slice(1) : 'Editoren');
  const syntax = syntaxProblems(tree, text, lang, langName);
  const issues: Issue[] = [...syntax];
  if (kind) {
    const a = analysis ?? analyze(kind, tree, text);
    // A name inside a syntax error (`let x = 5` in Python) is part of that error, and after a
    // bracket that's never closed the parser can't tell what anything is.
    const errors = syntax.filter((i) => i.severity === 'error');
    const unclosedAt = Math.min(...syntax.filter((i) => i.unclosed).map((i) => i.from));
    const inError = (i: Issue) => i.from > unclosedAt || errors.some((e) => i.from < e.to && i.to > e.from);
    issues.push(...a.issues.map((i) => withGuess(i, text)), ...nameIssues(a, text).filter((i) => i.feature !== 'names' || !inError(i)));
  }
  return issues.filter((i) => features.has(i.feature)).sort((a, b) => a.from - b.from || a.to - b.to);
}

/** Syntax errors; the parser's generic ones only where nothing more precise was found. */
function syntaxProblems(tree: Tree, text: string, lang: string, langName: string): Issue[] {
  let issues = syntaxIssues(tree, text, langName);
  if (lang === 'python') issues.push(...pythonLineIssues(text));
  const lineOf = lineIndex(text);
  if (lang === 'python') {
    // Python the parser can't read: a bare `yield`, numbers like `4.`, `case str():`.
    issues = issues.filter((i) => {
      if (!i.generic) return true;
      if (/\d\.\D?$/.test(text.slice(Math.max(0, i.from - 2), i.from + 1))) return false;
      const start = text.lastIndexOf('\n', i.from - 1) + 1;
      const end = text.indexOf('\n', i.from);
      const line = text.slice(start, end < 0 ? text.length : end);
      return !/\byield\s*(\)|#|$)/.test(line) && !/^\s*case\b.*\w\(\)/.test(line);
    });
  }
  if (lang === 'typescript') {
    // TypeScript the parser can't read: `(x): x is T =>` and `let x!: T`. Not errors.
    const gaps = new Set<number>();
    const re = /\)\s*:\s*[\w$.]+\s+is\s|[\w$]!\s*:/g;
    for (let m = re.exec(text); m; m = re.exec(text)) gaps.add(lineOf(m.index));
    issues = issues.filter((i) => !gaps.has(lineOf(i.from)));
  }
  const unclosedAt = Math.min(...issues.filter((i) => i.unclosed).map((i) => i.from));
  const specific = new Set<number>();
  for (const i of issues) {
    if (i.generic || i.severity !== 'error') continue;
    const line = lineOf(i.from);
    specific.add(line).add(line + 1);
  }
  return issues.filter((i) => !i.generic || (!specific.has(lineOf(i.from)) && i.from <= unclosedAt));
}

// ---- Names ----

function isGlobal(a: AnyAnalysis, name: string): boolean {
  return a.lang === 'python' ? pythonBuiltins.has(name) || a.starNames.has(name) : jsGlobals().has(name);
}

/** Names visible from a scope (the user's own). */
function visibleNames(a: AnyAnalysis, scope: Scope): Set<string> {
  const out = new Set<string>();
  for (let s: Scope | null = scope; s; s = s.parent) {
    if (a.lang === 'python' && s.kind === 'class' && s !== scope) continue;
    for (const name of s.names.keys()) out.add(name);
  }
  return out;
}

function nameIssues(a: AnyAnalysis, text: string): Issue[] {
  const issues: Issue[] = [];
  const lineOf = lineIndex(text);
  const python = a.lang === 'python';
  const language = python ? 'Python' : 'JavaScript';

  for (const ref of a.refs) {
    const b = ref.binding;
    if (!b) {
      if (ref.quiet || ref.type || ref.role === 'def' || ref.role === 'mention' || isGlobal(a, ref.name)) continue;
      if (a.lang === 'python' && a.unknownStar) continue;
      issues.push(undefinedIssue(a, ref, text));
      continue;
    }
    if (ref.role === 'def') continue;

    // Used before it has a value.
    const first = b.defs[0];
    if (ref.role !== 'mention' && first && !b.param) {
      let before = false;
      if (python && ref.role !== 'write' && (b.scope.kind === 'module' || b.scope.kind === 'function')) {
        let s: Scope | null = ref.scope;
        while (s && s !== b.scope && s.kind === 'comprehension') s = s.parent;
        const at = Math.min(...b.defs.map((d) => d.at));
        before =
          s === b.scope &&
          at > ref.from &&
          !(b.scope.kind === 'module' && isGlobal(a, ref.name)) &&
          // In a loop, an assignment further down may have run in an earlier round.
          !ref.loops?.some((l) => b.defs.some((d) => d.from !== ref.from && d.from >= l.from && d.from < l.to));
      } else if (!python && b.lexical && !ref.type) {
        let s: Scope | null = ref.scope;
        while (s && s !== b.scope && s.kind !== 'function') s = s.parent;
        before = s === b.scope && ref.from < (b.kind === 'class' ? first.from : first.at) && !(ref.from >= first.from && ref.to <= first.to);
      }
      if (before) {
        const fn = b.kind === 'function' || b.kind === 'class';
        const line = lineOf(first.from) + 1;
        const issue: Issue = {
          from: ref.from,
          to: ref.to,
          severity: python ? 'warning' : 'error',
          feature: 'names',
          message: python
            ? fn
              ? `«${ref.name}» brukes før den er definert (linje ${line})`
              : `«${ref.name}» brukes før den har fått en verdi`
            : `«${ref.name}» brukes før den er deklarert`,
          explanation: python
            ? `Python leser programmet ovenfra og ned. «${ref.name}» får ${fn ? 'sin definisjon' : 'verdi'} først på linje ${line}, men brukes her på linje ${lineOf(ref.from) + 1}. Flytt ${fn ? 'definisjonen' : 'linja der den får verdi'} over denne.`
            : `«${ref.name}» er deklarert med let, const eller class på linje ${line} og kan ikke brukes før den linja. Flytt deklarasjonen over denne.`,
        };
        // Maybe it's a misspelling of a name that does have a value here.
        const own = visibleNames(a, ref.scope);
        own.delete(ref.name);
        const guess = suggest(ref.name, own, own);
        if (guess) addGuess(issue, ref, guess);
        issues.push(issue);
      }
    }

    // A new value for a constant or an import.
    if (b.readonly && (ref.role === 'write' || ref.role === 'readwrite')) {
      const imported = b.kind === 'import';
      const issue: Issue = {
        from: ref.from,
        to: ref.to,
        severity: 'error',
        feature: 'names',
        message: imported ? `«${ref.name}» er importert og kan ikke få ny verdi` : `«${ref.name}» er en konstant (const) og kan ikke få ny verdi`,
        explanation: imported
          ? 'Importerte navn kan bare leses. Lag en ny variabel med let hvis du trenger å endre verdien.'
          : 'En variabel laget med const kan ikke endres. Bruk let i stedet for const hvis verdien skal kunne endres.',
      };
      const decl = b.defs[0];
      if (!imported && decl) {
        const lineStart = text.lastIndexOf('\n', decl.from - 1) + 1;
        const m = /\bconst(\s+)$/.exec(text.slice(lineStart, decl.from));
        if (m) {
          const at = decl.from - m[0].length;
          issue.fixes = [{ label: 'Bytt const til let', changes: [{ from: at, to: at + 5, insert: 'let' }] }];
        }
      }
      issues.push(issue);
    }
  }

  // Unused names. Parameters only count after the last one in use (the earlier ones can't be dropped).
  const lastUsedParam = new Map<number, number>();
  for (const b of a.bindings) {
    if (b.param && (b.reads > 0 || b.keep)) lastUsedParam.set(b.param.fn, Math.max(lastUsedParam.get(b.param.fn) ?? -1, b.param.index));
  }
  for (const b of a.bindings) {
    if (b.keep || b.reads > 0 || b.name.startsWith('_') || b.kind === 'type') continue;
    if (python && b.scope.kind === 'class') continue;
    if (!python && b.kind === 'import' && b.name === 'React' && a.lang === 'javascript' && a.jsx) continue;
    if (b.param && (lastUsedParam.get(b.param.fn) ?? -1) > b.param.index) continue;
    issues.push(...unusedIssues(b, text, language));
  }

  // Built-ins used as names (tips).
  if (python) {
    for (const b of a.bindings) {
      if (b.kind === 'import' || b.kind === 'class' || b.scope.kind === 'class' || !pythonShadowable.has(b.name) || !b.defs[0]) continue;
      issues.push({
        from: b.defs[0].from,
        to: b.defs[0].to,
        severity: 'info',
        feature: 'tips',
        message: `«${b.name}» er navnet på en innebygd funksjon i Python`,
        explanation: `Når du kaller noe «${b.name}», kan du ikke lenger bruke den innebygde ${b.name}(…) her. Velg heller et annet navn.`,
      });
    }
  }

  return issues;
}

/** An analyzer's issue about a possibly misspelled name (`math.sqroot`), with «mente du …?» added. */
function withGuess(issue: Issue, text: string): Issue {
  if (!issue.candidates) return issue;
  const guess = suggest(text.slice(issue.from, issue.to), issue.candidates);
  if (!guess) return issue;
  const copy = { ...issue, fixes: [...(issue.fixes ?? [])] };
  addGuess(copy, issue, guess);
  return copy;
}

function addGuess(issue: Issue, at: { from: number; to: number }, guess: string): void {
  issue.message += ` – mente du «${guess}»?`;
  (issue.fixes ??= []).push({ label: `Bytt til «${guess}»`, changes: [{ from: at.from, to: at.to, insert: guess }] });
}

function undefinedIssue(a: AnyAnalysis, ref: Ref, text: string): Issue {
  const python = a.lang === 'python';
  const name = ref.name;
  const issue: Issue = {
    from: ref.from,
    to: ref.to,
    severity: 'error',
    feature: 'names',
    message: `«${name}» er ikke definert`,
    explanation: ref.call
      ? `Det finnes ingen funksjon som heter «${name}». Sjekk stavemåten (store og små bokstaver teller), eller om den må importeres.`
      : `${python ? 'Python' : 'JavaScript'} vet ikke hva «${name}» er. Kanskje navnet er stavet feil (store og små bokstaver teller), eller den får en verdi først et annet sted?`,
  };

  // JS: `x = 5` without let/const.
  if (!python && ref.role === 'write') {
    issue.message = `«${name}» er ikke deklarert`;
    issue.explanation = `Skriv «let ${name} = …» første gang ${name} får en verdi, så JavaScript vet at det er en ny variabel.`;
    const lineStart = text.lastIndexOf('\n', ref.from - 1) + 1;
    if (/^\s*$/.test(text.slice(lineStart, ref.from)) && /^\s*=[^=]/.test(text.slice(ref.to))) {
      issue.fixes = [{ label: 'Legg til let', changes: [{ from: ref.from, to: ref.from, insert: 'let ' }] }];
    }
    return issue;
  }

  const lookalike = (python ? pythonLookalikes : jsLookalikes)[name];
  if (lookalike) {
    issue.message = `«${name}» finnes ikke i ${python ? 'Python' : 'JavaScript'} – ${lookalike.note.replace(/\.$/, '')}`;
    issue.explanation = lookalike.note;
    if (lookalike.replace) issue.fixes = [{ label: `Bytt til ${lookalike.use}`, changes: [{ from: ref.from, to: ref.to, insert: lookalike.use }] }];
    return issue;
  }

  // A class attribute used from a method: it's `self.name` there.
  if (python) {
    for (let s = ref.scope.parent; s; s = s.parent) {
      if (s.kind !== 'class' || !s.names.has(name)) continue;
      issue.message = `«${name}» er ikke definert – mente du «self.${name}»?`;
      issue.explanation = `«${name}» hører til klassen. Inne i en metode når du den med «self.${name}» (eller med klassenavnet foran).`;
      issue.fixes = [{ label: `Bytt til self.${name}`, changes: [{ from: ref.from, to: ref.from, insert: 'self.' }] }];
      return issue;
    }
  }

  if (python && pythonImportHints[name]) {
    const line = pythonImportHints[name];
    issue.message = `«${name}» er ikke definert – mangler du «${line}»?`;
    issue.explanation = `«${name}» kommer fra en modul som må importeres øverst i filen: «${line}».`;
    issue.fixes = [importFix(a as PythonAnalysis, text, line)];
    return issue;
  }

  const own = visibleNames(a, ref.scope);
  const all = python ? [...own, ...pythonBuiltins, ...(a as PythonAnalysis).starNames] : [...own, ...jsGlobals()];
  const guess = suggest(name, all, own);
  if (guess) addGuess(issue, ref, guess);
  return issue;
}

/** Add an import line after the existing imports (or at the top, after comments and the docstring). */
function importFix(a: PythonAnalysis, text: string, line: string): Fix {
  let end = -1;
  for (const b of a.bindings) if (b.kind === 'import' && b.scope === a.module && b.statement) end = Math.max(end, b.statement.to);
  if (end >= 0) {
    const eol = text.indexOf('\n', end);
    const at = eol < 0 ? text.length : eol;
    return { label: `Legg til «${line}»`, changes: [{ from: at, to: at, insert: `\n${line}` }] };
  }
  // Skip leading comments, blank lines and a docstring.
  const m = /^(?:[ \t]*(?:#[^\n]*)?\n)*(?:[ \t]*[rRuU]?("""|''')[\s\S]*?\1[^\n]*\n)?/.exec(text);
  const at = m ? m[0].length : 0;
  return { label: `Legg til «${line}»`, changes: [{ from: at, to: at, insert: `${line}\n` }] };
}

function unusedIssues(b: Binding, text: string, language: string): Issue[] {
  const feature: CodeHelpFeature = b.kind === 'parameter' ? 'unusedParams' : 'unused';
  const base = { severity: 'hint' as const, feature, markClass: 'cm-unused' };
  let message: string;
  let explanation: string;
  switch (b.kind) {
    case 'import':
      message = `«${b.name}» er importert, men brukes ikke`;
      explanation = 'Importen kan fjernes, eller så har du kanskje stavet navnet annerledes der du bruker det.';
      break;
    case 'function':
      message = `Funksjonen «${b.name}» brukes aldri`;
      explanation = `Funksjonen er laget, men blir aldri kalt. Har du glemt å kalle den, f.eks. «${b.name}()»?`;
      break;
    case 'class':
      message = `Klassen «${b.name}» brukes aldri`;
      explanation = `Klassen er laget, men ingen objekter lages av den. Lag et objekt med «${b.name}()»${language === 'JavaScript' ? ' (med new foran)' : ''}.`;
      break;
    case 'parameter':
      message = `Parameteren «${b.name}» brukes ikke`;
      explanation = 'Funksjonen får denne verdien, men bruker den aldri. Kanskje den kan fjernes, eller så er navnet stavet annerledes inne i funksjonen?';
      break;
    default:
      message = `«${b.name}» får en verdi, men brukes aldri`;
      explanation = `Variabelen får en verdi, men verdien blir aldri lest. Kanskje den er stavet annerledes et annet sted, eller den trengs ikke?${language === 'Python' ? ' Skriv _ som navn hvis du ikke trenger verdien.' : ''}`;
  }
  if (b.kind === 'import' && b.statement?.only) {
    const { from, to } = b.statement;
    const lineStart = text.lastIndexOf('\n', from - 1) + 1;
    const wholeLine = /^\s*$/.test(text.slice(lineStart, from));
    const end = text[to] === '\n' ? to + 1 : to;
    return [
      {
        ...base,
        from,
        to,
        message,
        explanation,
        fixes: [{ label: 'Fjern importen', changes: [{ from: wholeLine ? lineStart : from, to: wholeLine ? end : to, insert: '' }] }],
      },
    ];
  }
  return b.defs.map((d) => ({ ...base, from: d.from, to: d.to, message, explanation }));
}

// ---- Suggestions ----

/** Edit distance with transpositions (optimal string alignment), stopping early above `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      row.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

/**
 * The name the user probably meant: same letters in other case, or a few
 * typos away. Names in `own` (the user's) win over built-ins.
 */
export function suggest(name: string, candidates: Iterable<string>, own?: Set<string>): string | null {
  const lower = name.toLowerCase();
  const max = name.length <= 2 ? 0 : name.length <= 4 ? 1 : name.length <= 8 ? 2 : 3;
  let best: string | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    if (c === name || c.startsWith('__')) continue;
    const cl = c.toLowerCase();
    let score: number;
    if (cl === lower) score = 0.5;
    else {
      if (max === 0) continue;
      const d = editDistance(lower, cl, max);
      if (d > max || d >= c.length) continue;
      score = d;
    }
    if (!own?.has(c)) score += 0.1;
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}
