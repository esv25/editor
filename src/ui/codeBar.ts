/**
 * Toolbar shown instead of the formatting buttons when a code file is active:
 * language menu and Run.
 */
import type { EditorView } from '@codemirror/view';
import type { EditorDocument } from '../app/document';
import { runFile } from '../code/codeMode';
import { describeCommand } from '../commands/registry';
import { runnability } from '../features/codeBlockTools/run';
import { languageChoices } from '../features/codeBlockTools/runners';

export class CodeBar {
  private select = document.createElement('select');
  private run = document.createElement('button');
  private doc: EditorDocument | null = null;

  constructor(
    container: HTMLElement,
    getView: () => EditorView,
    onLanguage: (doc: EditorDocument, lang: string) => void,
  ) {
    const label = document.createElement('span');
    label.className = 'code-bar-label';
    label.textContent = 'Språk';

    this.select.className = 'code-bar-lang';
    this.select.title = 'Språk for highlighting og kjøring';
    this.select.addEventListener('change', () => {
      if (this.doc) onLanguage(this.doc, this.select.value);
    });

    this.run.type = 'button';
    this.run.className = 'tb-button code-bar-run';
    this.run.textContent = '▶ Kjør';
    this.run.addEventListener('mousedown', (e) => e.preventDefault());
    this.run.addEventListener('click', () => {
      const view = getView();
      runFile(view);
      view.focus();
    });

    container.replaceChildren(label, this.select, this.run);
  }

  update(doc: EditorDocument): void {
    this.doc = doc;
    const choices = languageChoices.filter((c) => c.id !== '');
    if (doc.lang && !choices.some((c) => c.id === doc.lang)) choices.push({ id: doc.lang, label: doc.lang });
    this.select.replaceChildren(
      ...choices.map((c) => {
        const option = document.createElement('option');
        option.value = c.id;
        option.textContent = c.label;
        option.selected = c.id === doc.lang;
        return option;
      }),
    );
    const can = runnability(doc.lang);
    this.run.disabled = !can.ok;
    this.run.title = can.ok ? describeCommand('code.run') : can.reason;
  }
}
