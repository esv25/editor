/**
 * Heuristics for "should this line be a heading?".
 *
 * Kept free of CodeMirror so the rules are easy to read, tweak and test.
 * Each rule is a named predicate; a line is a candidate only if every
 * enabled rule passes. Add a rule by pushing to `headingRules` (or
 * calling `registerHeadingRule`), disable one via `disabledRules` in settings.
 */

export interface HeadingSuggestionConfig {
  enabled: boolean;
  /** Longest line (trimmed) that can be suggested. */
  maxLength: number;
  minLength: number;
  maxWords: number;
  /** Lines ending with one of these are treated as prose, not headings. */
  forbiddenEndings: string[];
  requireBlankBefore: boolean;
  requireBlankAfter: boolean;
  /** Only hint on the line the cursor is on (much less noisy). */
  onlyOnCursorLine: boolean;
  /** Hide the hint while typing; show it after this many ms of idle. */
  idleDelayMs: number;
  /** Heading level the shortcut applies. */
  level: number;
  /** Rule ids to skip. */
  disabledRules: string[];
}

export const defaultHeadingSuggestionConfig: HeadingSuggestionConfig = {
  enabled: true,
  maxLength: 40,
  minLength: 2,
  maxWords: 7,
  forbiddenEndings: ['.', ',', ';', ':'],
  requireBlankBefore: true,
  requireBlankAfter: true,
  onlyOnCursorLine: true,
  idleDelayMs: 800,
  level: 2,
  disabledRules: [],
};

export interface LineContext {
  text: string;
  /** Previous line's text, or null at the start of the document. */
  prevText: string | null;
  /** Next line's text, or null at the end of the document. */
  nextText: string | null;
  /** Name of the Markdown block the line belongs to, e.g. "Paragraph". */
  blockType: string;
}

export interface HeadingRule {
  id: string;
  description: string;
  test: (ctx: LineContext, config: HeadingSuggestionConfig) => boolean;
}

const isBlank = (text: string | null) => text === null || text.trim() === '';

export const headingRules: HeadingRule[] = [
  {
    id: 'plain-paragraph',
    description: 'Linja er vanlig tekst (ikke liste, sitat, kode eller allerede overskrift)',
    test: (ctx) => ctx.blockType === 'Paragraph',
  },
  {
    id: 'length',
    description: 'Linja er kort',
    test: (ctx, c) => {
      const len = ctx.text.trim().length;
      return len >= c.minLength && len <= c.maxLength;
    },
  },
  {
    id: 'words',
    description: 'Linja har få ord',
    test: (ctx, c) => ctx.text.trim().split(/\s+/).length <= c.maxWords,
  },
  {
    id: 'ending',
    description: 'Linja slutter ikke med punktum eller lignende',
    test: (ctx, c) => !c.forbiddenEndings.some((end) => ctx.text.trimEnd().endsWith(end)),
  },
  {
    id: 'blank-before',
    description: 'Tom linje (eller dokumentstart) over',
    test: (ctx, c) => !c.requireBlankBefore || isBlank(ctx.prevText),
  },
  {
    id: 'blank-after',
    description: 'Tom linje (eller dokumentslutt) under',
    test: (ctx, c) => !c.requireBlankAfter || isBlank(ctx.nextText),
  },
];

export function registerHeadingRule(rule: HeadingRule): void {
  const existing = headingRules.findIndex((r) => r.id === rule.id);
  if (existing >= 0) headingRules[existing] = rule;
  else headingRules.push(rule);
}

export function isHeadingCandidate(ctx: LineContext, config: HeadingSuggestionConfig): boolean {
  return headingRules.every((rule) => config.disabledRules.includes(rule.id) || rule.test(ctx, config));
}
