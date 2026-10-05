/**
 * Sticky scroll, like VS Code: when the line that opens a function, loop or class
 * is scrolled out of view, it stays at the top of the editor so you can see where
 * you are. Click one to go there. Which lines: `stickyHeaders` in indentation.ts.
 */
import { EditorSelection } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { highlightTree } from '@lezer/highlight';
import { highlightStyle } from '../editor/theme';
import { stickyHeaders } from './indentation';

interface Layout {
  headers: number[];
  /** Where the lines start (px from the scroller's left edge, follows horizontal scrolling). */
  textLeft: number;
  gutterWidth: number;
  /** Right edge of the line-number column. */
  numbersRight: number;
  lineHeight: number;
  top: number;
  width: number;
}

export const stickyScroll = ViewPlugin.fromClass(
  class {
    dom: HTMLElement;
    key = '';
    onScroll = () => this.schedule();

    constructor(readonly view: EditorView) {
      this.dom = document.createElement('div');
      this.dom.className = 'cm-sticky-scroll';
      this.dom.setAttribute('aria-hidden', 'true');
      this.dom.style.display = 'none';
      // mousedown, so the editor keeps focus and nothing is selected under the overlay.
      this.dom.addEventListener('mousedown', (e) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>('[data-line]');
        if (!row) return;
        e.preventDefault();
        const line = view.state.doc.line(Number(row.dataset.line));
        const pos = line.from + (line.text.length - line.text.trimStart().length);
        view.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: 'start' }) });
        view.focus();
      });
      view.dom.appendChild(this.dom);
      view.scrollDOM.addEventListener('scroll', this.onScroll);
      this.schedule();
    }

    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.geometryChanged) {
        this.key = '';
        this.schedule();
      }
    }

    schedule() {
      this.view.requestMeasure({ key: this, read: (view) => this.measure(view), write: (layout) => this.draw(layout) });
    }

    measure(view: EditorView): Layout {
      const scroller = view.scrollDOM.getBoundingClientRect();
      const block = view.lineBlockAtHeight(Math.max(0, scroller.top - view.documentTop));
      const top = view.state.doc.lineAt(block.from).number;
      const gutters = view.dom.querySelector<HTMLElement>('.cm-gutters');
      const numbers = view.dom.querySelector<HTMLElement>('.cm-lineNumbers');
      return {
        headers: stickyHeaders(view.state, top),
        textLeft: view.contentDOM.getBoundingClientRect().left - scroller.left,
        gutterWidth: gutters?.offsetWidth ?? 0,
        numbersRight: numbers ? numbers.getBoundingClientRect().right - scroller.left : 0,
        lineHeight: view.defaultLineHeight,
        top: view.scrollDOM.offsetTop,
        width: view.scrollDOM.clientWidth,
      };
    }

    draw(l: Layout) {
      const { dom } = this;
      if (!l.headers.length) {
        dom.style.display = 'none';
        this.key = '';
        return;
      }
      dom.style.display = '';
      dom.style.top = `${l.top}px`;
      dom.style.width = `${l.width}px`;
      dom.style.setProperty('--sticky-line-height', `${l.lineHeight}px`);
      dom.style.setProperty('--sticky-gutter', `${l.gutterWidth}px`);
      dom.style.setProperty('--sticky-numbers', `${l.numbersRight}px`);
      dom.style.setProperty('--sticky-text-left', `${l.textLeft}px`);
      const key = l.headers.join(',');
      if (key === this.key) return;
      this.key = key;
      dom.replaceChildren(...l.headers.map((n) => this.row(n)));
    }

    row(lineNo: number): HTMLElement {
      const { state } = this.view;
      const line = state.doc.line(lineNo);
      const row = document.createElement('div');
      row.className = 'cm-sticky-line';
      row.dataset.line = String(lineNo);
      row.title = `Gå til linje ${lineNo}`;
      const number = document.createElement('span');
      number.className = 'cm-sticky-number';
      number.textContent = String(lineNo);
      const text = document.createElement('span');
      text.className = 'cm-sticky-text';
      // Coloured like the code: the highlighter's classes on the line's tokens.
      const tree = syntaxTree(state);
      let pos = line.from;
      const put = (to: number, cls: string) => {
        if (to <= pos) return;
        const span = document.createElement('span');
        if (cls) span.className = cls;
        span.textContent = state.sliceDoc(pos, to);
        text.appendChild(span);
        pos = to;
      };
      if (tree.length >= line.to) {
        highlightTree(tree, highlightStyle, (from, to, cls) => {
          put(from, '');
          put(to, cls);
        }, line.from, line.to);
      }
      put(line.to, '');
      row.append(text, number);
      return row;
    }

    destroy() {
      this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
      this.dom.remove();
    }
  },
);
