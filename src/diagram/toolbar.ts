/**
 * The drawing window's toolbar (big buttons with text: easy to hit and to
 * understand) and the hint bar that always says what a click will do.
 */
import type { DiagramCanvas } from './canvas';
import { shapeIcon } from './shapes/common';
import { stepTextSize } from './textSize';
import { toolKey, tools } from './tools';

export interface Toolbar {
  update(): void;
  setStatus(text: string): void;
}

const icons = {
  undo: shapeIcon('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  redo: shapeIcon('<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
  delete: shapeIcon('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  fit: shapeIcon('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
  textSmaller: shapeIcon('<path d="M4 18 9 6l5 12M5.7 14h6.6M16 12h5"/>'),
  textLarger: shapeIcon('<path d="M4 18 9 6l5 12M5.7 14h6.6M16 12h5M18.5 9.5v5"/>'),
};

export function renderToolbar(
  bar: HTMLElement,
  hintBar: HTMLElement,
  canvas: DiagramCanvas,
  actions: { save(): void; canSaveAs: () => boolean },
): Toolbar {
  const button = (parent: HTMLElement, label: string, title: string, icon: string | null, onClick: () => void) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'dg-button';
    el.title = title;
    el.innerHTML = icon ?? '';
    const text = document.createElement('span');
    text.textContent = label;
    el.append(text);
    // Keep keyboard focus where it was (the canvas listens on the window).
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', onClick);
    parent.append(el);
    return el;
  };
  const group = () => {
    const el = document.createElement('div');
    el.className = 'dg-group';
    bar.append(el);
    return el;
  };

  const toolGroup = group();
  const toolButtons = tools.map((tool) => ({
    tool,
    el: button(toolGroup, tool.name, tool.name, tool.icon, () => canvas.setTool(tool.id)),
  }));

  const editGroup = group();
  button(editGroup, 'Angre', 'Angre (Ctrl+Z)', icons.undo, () => canvas.undo());
  button(editGroup, 'Gjør om', 'Gjør om (Ctrl+Y)', icons.redo, () => canvas.redo());
  const deleteButton = button(editGroup, 'Slett', 'Slett det valgte (Delete)', icons.delete, () => canvas.deleteSelection());

  const zoomGroup = group();
  button(zoomGroup, '−', 'Zoom ut (-)', null, () => canvas.zoomBy(1 / 1.25));
  const zoomLabel = button(zoomGroup, '100 %', 'Tilbake til 100 % (0)', null, () => canvas.zoomReset());
  button(zoomGroup, '+', 'Zoom inn (+)', null, () => canvas.zoomBy(1.25));
  button(zoomGroup, 'Vis alt', 'Hele tegningen i bildet (Home)', icons.fit, () => canvas.zoomToFit());

  // The drawing's text size: drawings are often shown small (in notes, on paper).
  const textGroup = group();
  const smaller = button(textGroup, 'Mindre tekst', 'Mindre tekst i hele tegningen', icons.textSmaller, () => canvas.stepTextSize(-1));
  const larger = button(
    textGroup,
    'Større tekst',
    'Større tekst i hele tegningen (figurene vokser der teksten trenger plass)',
    icons.textLarger,
    () => canvas.stepTextSize(1),
  );

  const right = group();
  right.classList.add('dg-right');
  const status = document.createElement('span');
  status.className = 'dg-status';
  right.append(status);
  const saveButton = button(right, 'Lagre som …', 'Lagre tegningen som fil (Ctrl+S)', null, () => actions.save());

  const hint = document.createElement('span');
  hintBar.append(hint);

  const toolbar: Toolbar = {
    update() {
      for (const { tool, el } of toolButtons) {
        const active = canvas.tool.id === tool.id;
        el.classList.toggle('active', active);
        el.setAttribute('aria-pressed', String(active));
        // The key can be changed (in the editor's «Hurtigtaster»), so it's read each time.
        const key = toolKey(tool);
        el.title = key ? `${tool.name} (${key.toUpperCase()})` : tool.name;
      }
      deleteButton.disabled = !canvas.selection.length;
      zoomLabel.querySelector('span')!.textContent = `${canvas.zoomPercent} %`;
      const textPercent = `Tekst nå: ${Math.round(canvas.textScale * 100)} %`;
      smaller.disabled = stepTextSize(canvas.textScale, -1) === null;
      larger.disabled = stepTextSize(canvas.textScale, 1) === null;
      smaller.title = `Mindre tekst i hele tegningen (${textPercent})`;
      larger.title = `Større tekst i hele tegningen – figurene vokser der teksten trenger plass (${textPercent})`;
      saveButton.hidden = !actions.canSaveAs();
      hint.textContent = canvas.hint;
    },
    setStatus(text) {
      status.textContent = text;
    },
  };
  return toolbar;
}
