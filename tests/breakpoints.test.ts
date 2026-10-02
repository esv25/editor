import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  breakpointField,
  breakpointLines,
  executionField,
  setBreakpointsEffect,
  setExecutionLine,
  toggleBreakpointEffect,
} from '../src/debug/breakpoints';

const code = 'a = 1\nb = 2\nc = 3\nprint(a + b + c)\n';

function stateWith(lines: number[] = []): EditorState {
  const state = EditorState.create({ doc: code, extensions: [breakpointField, executionField] });
  return lines.length ? state.update({ effects: setBreakpointsEffect.of(lines) }).state : state;
}

const toggle = (state: EditorState, pos: number) => state.update({ effects: toggleBreakpointEffect.of(pos) }).state;

describe('breakpoints', () => {
  it('toggles on and off anywhere on the line', () => {
    let state = stateWith();
    state = toggle(state, state.doc.line(2).from);
    expect(breakpointLines(state)).toEqual([2]);
    state = toggle(state, state.doc.line(2).to); // end of the same line
    expect(breakpointLines(state)).toEqual([]);
  });

  it('follows its line when text is inserted above', () => {
    let state = stateWith([1, 3]);
    // Like pressing Enter at the very start: the breakpoint moves down with the code.
    state = state.update({ changes: { from: 0, insert: 'import os\n' } }).state;
    expect(breakpointLines(state)).toEqual([2, 4]);
  });

  it('stays on its line when typing at the start of it', () => {
    let state = stateWith([2]);
    state = state.update({ changes: { from: state.doc.line(2).from, insert: 'x' } }).state;
    expect(breakpointLines(state)).toEqual([2]);
  });

  it('lists each line once, sorted, ignoring lines that don’t exist', () => {
    const state = stateWith([4, 1, 4, 99]);
    expect(breakpointLines(state)).toEqual([1, 4]);
  });

  it('collapses onto one line when lines are joined', () => {
    let state = stateWith([2, 3]);
    // Delete line 2 entirely: both markers end up on what is now line 2.
    state = state.update({ changes: { from: state.doc.line(2).from, to: state.doc.line(3).from } }).state;
    expect(breakpointLines(state)).toEqual([2]);
  });

  it('is empty for states without the field (Markdown, other languages)', () => {
    expect(breakpointLines(EditorState.create({ doc: code }))).toEqual([]);
  });
});

describe('execution line', () => {
  it('is set, follows edits and is cleared', () => {
    let state = stateWith().update({ effects: setExecutionLine.of({ line: 3, top: true }) }).state;
    expect(state.field(executionField)).toEqual({ line: 3, top: true });
    state = state.update({ changes: { from: 0, insert: '# kommentar\n' } }).state;
    expect(state.field(executionField)?.line).toBe(4);
    state = state.update({ effects: setExecutionLine.of(null) }).state;
    expect(state.field(executionField)).toBeNull();
  });
});
