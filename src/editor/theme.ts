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
