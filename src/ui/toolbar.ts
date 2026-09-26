/**
 * Renders buttons for registered commands. Used for the formatting toolbar
 * and the file/view buttons in the top bar.
 */
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describeCommand, getCommand, runCommand } from '../commands/registry';

export interface ButtonBar {
  /** Refresh active states (call on selection/doc changes). */
  update(state: EditorState): void;
  /** Refresh tooltips (call when keybindings change). */
  refreshTooltips(): void;
}

export function renderButtons(container: HTMLElement, ids: string[], getView: () => EditorView): ButtonBar {
  container.replaceChildren();
  const buttons: { id: string; el: HTMLButtonElement }[] = [];

  for (const id of ids) {
    if (id === '|') {
      const sep = document.createElement('span');
      sep.className = 'tb-sep';
      container.append(sep);
      continue;
    }
    const command = getCommand(id);
    if (!command) {
      console.warn(`Ukjent kommando i verktøylinjen: ${id}`);
      continue;
    }
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'tb-button';
    el.dataset.command = id;
    if (command.icon) el.innerHTML = command.icon;
    else el.textContent = command.label ?? command.name;
    el.setAttribute('aria-label', command.name);
    // Keep focus (and selection) in the editor.
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', () => {
      const view = getView();
      runCommand(view, id);
      view.focus();
    });
    container.append(el);
    buttons.push({ id, el });
  }

  const bar: ButtonBar = {
    update(state) {
      for (const { id, el } of buttons) {
        const isActive = getCommand(id)?.isActive;
        if (!isActive) continue;
        const active = isActive(state);
        el.classList.toggle('active', active);
        el.setAttribute('aria-pressed', String(active));
      }
    },
    refreshTooltips() {
      for (const { id, el } of buttons) el.title = describeCommand(id);
    },
  };
  bar.refreshTooltips();
  return bar;
}
