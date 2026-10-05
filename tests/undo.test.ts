import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { undo, redo } from '@codemirror/commands';
import { undoHistory } from '../src/editor/undo';

/** Applies transactions like a user would, and runs undo/redo on the result. */
class Doc {
  state = EditorState.create({ doc: '', extensions: [undoHistory()] });
  /** A fake clock, so pauses don't need real waiting. */
  time = 1_000_000;

  pause(ms: number): this {
    this.time += ms;
    return this;
  }

  get text(): string {
    return this.state.doc.toString();
  }

  type(text: string): this {
    for (const ch of text) {
      const pos = this.state.selection.main.head;
      this.state = this.state.update({
        changes: { from: pos, insert: ch },
        selection: { anchor: pos + ch.length },
        userEvent: 'input.type',
        annotations: Transaction.time.of((this.time += 100)),
      }).state;
    }
    return this;
  }

  /** Enter as CodeMirror's insertNewline dispatches it. */
  enter(): this {
    const pos = this.state.selection.main.head;
    this.state = this.state.update({
      changes: { from: pos, insert: '\n' },
      selection: { anchor: pos + 1 },
      userEvent: 'input',
      annotations: Transaction.time.of((this.time += 100)),
    }).state;
    return this;
  }

  backspace(times = 1): this {
    for (let i = 0; i < times; i++) {
      const pos = this.state.selection.main.head;
      this.state = this.state.update({
        changes: { from: pos - 1, to: pos },
        selection: { anchor: pos - 1 },
        userEvent: 'delete.backward',
        annotations: Transaction.time.of((this.time += 100)),
      }).state;
    }
    return this;
  }

  moveTo(pos: number): this {
    this.state = this.state.update({ selection: EditorSelection.cursor(pos), userEvent: 'select' }).state;
    return this;
  }

  undo(): this {
    undo({ state: this.state, dispatch: (tr) => (this.state = tr.state) });
    return this;
  }

  redo(): this {
    redo({ state: this.state, dispatch: (tr) => (this.state = tr.state) });
    return this;
  }
}

describe('undo grouping', () => {
  it('undoes what was typed in one go as one step', () => {
    const doc = new Doc().type('Hei på deg');
    expect(doc.undo().text).toBe('');
  });

  it('keeps going after a long pause', () => {
    const doc = new Doc().type('Hei på ').pause(60_000).type('deg');
    expect(doc.undo().text).toBe('');
  });

  it('includes a plain Enter in the typing', () => {
    const doc = new Doc().type('a').enter().type('b');
    expect(doc.text).toBe('a\nb');
    expect(doc.undo().text).toBe('');
  });

  it('keeps Enter that does more (like continuing a list) as its own step', () => {
    const doc = new Doc().type('- a');
    const pos = doc.state.selection.main.head;
    doc.state = doc.state.update({ changes: { from: pos, insert: '\n- ' }, selection: { anchor: pos + 3 }, userEvent: 'input' }).state;
    doc.type('b');
    expect(doc.undo().text).toBe('- a\n- ');
    expect(doc.undo().text).toBe('- a');
  });

  it('redoes the same steps', () => {
    const doc = new Doc().type('en').backspace().type('t').undo().undo().undo();
    expect(doc.text).toBe('');
    expect(doc.redo().text).toBe('en');
    expect(doc.redo().text).toBe('e');
    expect(doc.redo().text).toBe('et');
  });

  it('separates typing from deleting', () => {
    const doc = new Doc().type('katt').backspace(2).type('lt');
    expect(doc.text).toBe('kalt');
    expect(doc.undo().text).toBe('ka');
    expect(doc.undo().text).toBe('katt');
    expect(doc.undo().text).toBe('');
  });

  it('keeps consecutive deletes together', () => {
    const doc = new Doc().type('abc').moveTo(3).backspace(3);
    expect(doc.undo().text).toBe('abc');
  });

  it('starts a new step after the cursor moves', () => {
    const doc = new Doc().type('ab').moveTo(1).type('x');
    expect(doc.text).toBe('axb');
    expect(doc.undo().text).toBe('ab');
  });
});
