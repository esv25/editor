/**
 * Toolbar shown instead of the formatting buttons when a code file is active:
 * language menu, Run, Run in terminal and Debug.
 */
import type { EditorView } from '@codemirror/view';
import type { EditorDocument } from '../app/document';
import { describeCommand, runCommand } from '../commands/registry';
import type { DebugController } from '../debug/controller';
import { runnability } from '../features/codeBlockTools/run';
import { languageChoices, runnerFor } from '../features/codeBlockTools/runners';
import { platform } from '../platform';
import { debugIcons } from './debugPanel';

export class CodeBar {
  private select = document.createElement('select');
  private run: HTMLButtonElement;
  private runInTerminal: HTMLButtonElement;
  private debugButton: HTMLButtonElement;
  private doc: EditorDocument | null = null;

  constructor(
    container: HTMLElement,
    private getView: () => EditorView,
    private debug: DebugController,
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

    this.run = this.button('code.run', '▶ Kjør', 'code-bar-run');
    this.runInTerminal = this.button('code.runInTerminal', '▶ Kjør i terminal', 'code-bar-run');
    this.debugButton = this.button('debug.start', '', 'code-bar-debug');
    this.debugButton.innerHTML = `${debugIcons.start}<span>Feilsøk</span>`;

    container.replaceChildren(label, this.select, this.run, this.runInTerminal, this.debugButton);
    debug.onChange(() => this.doc && this.update(this.doc));
  }

  private button(command: string, text: string, className: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tb-button ${className}`;
    b.textContent = text;
    b.dataset.command = command;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      const view = this.getView();
      runCommand(view, b.dataset.command!);
      view.focus();
    });
    return b;
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

    // Running in the terminal (so the program can read input) needs the desktop app and a runner.
    this.runInTerminal.hidden = !platform.processes;
    const inTerminal = !!runnerFor(doc.lang);
    this.runInTerminal.disabled = !inTerminal;
    this.runInTerminal.title = inTerminal
      ? `${describeCommand('code.runInTerminal')} – programmet kan lese det du skriver`
      : 'Dette språket kan ikke kjøres i terminalen';

    // Debug, or stop the session that's running.
    const { debug } = this;
    this.debugButton.hidden = !platform.processes;
    const stopping = debug.active;
    this.debugButton.dataset.command = stopping ? 'debug.stop' : 'debug.start';
    this.debugButton.innerHTML = stopping ? `${debugIcons.stop}<span>Stopp feilsøking</span>` : `${debugIcons.start}<span>Feilsøk</span>`;
    this.debugButton.classList.toggle('active', stopping);
    const problem = stopping ? null : debug.problem(doc);
    this.debugButton.disabled = problem !== null;
    this.debugButton.title = problem ?? describeCommand(this.debugButton.dataset.command);
  }
}
