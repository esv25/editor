/**
 * Editor theme. All colours come from CSS variables defined in styles.css,
 * so light/dark switching is just a `data-theme` attribute on <html>.
 */
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--fg)',
    backgroundColor: 'var(--bg)',
    fontSize: 'var(--font-size)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-prose)',
    lineHeight: 'var(--line-height)',
    overflowX: 'hidden',
  },
  '.cm-content': {
    maxWidth: 'var(--line-width)',
    margin: '0 auto',
    padding: '3rem 1.5rem 40vh',
    caretColor: 'var(--accent)',
  },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--selection) !important' },
  '.cm-placeholder': { color: 'var(--faint)', fontStyle: 'italic' },
  '.cm-panels': { backgroundColor: 'var(--panel-bg)', color: 'var(--fg)', fontFamily: 'var(--font-ui)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-searchMatch': { backgroundColor: 'var(--search-match)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--search-match-selected)' },
  '.cm-textfield': {
    backgroundColor: 'var(--bg)',
    color: 'var(--fg)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--button-bg)',
    color: 'var(--fg)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
  },

  // Code help (code/assist): tooltips, squiggles, faded unused code, suggestions.
  '.cm-tooltip': {
    backgroundColor: 'var(--panel-bg)',
    color: 'var(--fg)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    fontFamily: 'var(--font-ui)',
    boxShadow: '0 4px 14px rgb(0 0 0 / 0.16)',
    overflow: 'hidden',
  },
  '.cm-tooltip-lint': { maxWidth: 'min(560px, 90vw)' },
  '.cm-diagnostic': { padding: '8px 12px', fontSize: '14px', lineHeight: '1.45' },
  '.cm-diagnostic + .cm-diagnostic': { borderTop: '1px solid var(--border)' },
  '.cm-diagnostic-error': { borderLeft: '4px solid var(--diag-error)' },
  '.cm-diagnostic-warning': { borderLeft: '4px solid var(--diag-warning)' },
  '.cm-diagnostic-info': { borderLeft: '4px solid var(--diag-info)' },
  '.cm-diagnostic-hint': { borderLeft: '4px solid var(--faint)' },
  '.cm-diagnosticText': { display: 'block' },
  '.cm-diagnostic-explain': { display: 'block', marginTop: '4px', color: 'var(--muted)' },
  '.cm-diagnosticAction': {
    backgroundColor: 'var(--accent)',
    color: 'var(--bg)',
    fontSize: '13px',
    fontWeight: '600',
    padding: '6px 12px',
    margin: '8px 8px 0 0',
    borderRadius: '4px',
  },
  '.cm-diagnosticAction:hover': { filter: 'brightness(1.1)' },
  '.cm-lintRange-error, .cm-lintRange-warning, .cm-lintRange-info': {
    backgroundImage: 'none',
    textDecorationLine: 'underline',
    textDecorationStyle: 'wavy',
    textDecorationSkipInk: 'none',
    textDecorationThickness: '1px',
    textUnderlineOffset: '3px',
  },
  '.cm-lintRange-error': { textDecorationColor: 'var(--diag-error)' },
  '.cm-lintRange-warning': { textDecorationColor: 'var(--diag-warning)' },
  '.cm-lintRange-info': { textDecorationColor: 'var(--diag-info)' },
  '.cm-lintRange-hint': { backgroundImage: 'none' },
  '.cm-unused, .cm-unreachable': { opacity: '0.5' },
  '.cm-lintPoint:after': { borderBottomColor: 'var(--diag-error)' },
  '.cm-lintPoint-warning:after': { borderBottomColor: 'var(--diag-warning)' },
  '.cm-lintPoint-info:after': { borderBottomColor: 'var(--diag-info)' },
  '.cm-panel.cm-panel-lint ul': { maxHeight: '180px', fontSize: '13px' },
  '.cm-panel.cm-panel-lint ul li': { padding: '4px 10px' },
  '.cm-panel.cm-panel-lint ul [aria-selected]': { backgroundColor: 'var(--button-active)' },
  '.cm-panel.cm-panel-lint [name=close]': { color: 'var(--muted)', padding: '4px 10px', fontSize: '16px' },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', fontSize: '13px', maxHeight: '18em' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '3px 10px 3px 4px', lineHeight: '1.5' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--bg)' },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700' },
  '.cm-completionDetail': { color: 'var(--muted)' },
  '.cm-occurrence': { backgroundColor: 'var(--occurrence)', borderRadius: '2px' },
  '.cm-occurrence-write': { backgroundColor: 'var(--occurrence-write)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--occurrence)' },
  // Inner spans too: the syntax colour may sit inside the bracket mark.
  '.cm-bracket-1, .cm-bracket-1 *': { color: 'var(--bracket-1) !important' },
  '.cm-bracket-2, .cm-bracket-2 *': { color: 'var(--bracket-2) !important' },
  '.cm-bracket-3, .cm-bracket-3 *': { color: 'var(--bracket-3) !important' },
  '.cm-trailingSpace': { backgroundColor: 'var(--trailing-space)' },
});

/** Highlighting for Markdown itself and for languages inside fenced code blocks. */
export const highlightStyle = HighlightStyle.define([
  // Markdown
  { tag: t.heading, fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--muted)' },
  { tag: t.quote, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.88em' },
  { tag: t.processingInstruction, color: 'var(--faint)' },
  { tag: t.contentSeparator, color: 'var(--faint)' },
  { tag: t.labelName, color: 'var(--muted)' },
  // Code
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-function)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syn-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syn-property)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--syn-tag)' },
  { tag: [t.definition(t.variableName), t.variableName], color: 'var(--syn-variable)' },
  { tag: [t.operator, t.punctuation, t.bracket], color: 'var(--syn-punct)' },
  { tag: t.invalid, color: 'var(--syn-invalid)' },
]);

export const editorHighlighting = syntaxHighlighting(highlightStyle);
