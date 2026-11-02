/** The drawn parts of exam practice, shared by the text widgets and table cells. */
import { MAX_RATING, ratingClass } from './model';

/** The rating as a coloured number ("7"), or a dash when not rated yet; click it to pick. */
export function ratingChip(value: number | null): HTMLElement {
  const chip = document.createElement('span');
  chip.className = `cm-exam-rating ${ratingClass(value)}` + (value === null ? ' unrated' : '');
  chip.setAttribute('role', 'button');
  chip.textContent = value === null ? '–' : String(value);
  chip.title = value === null ? 'Forståelse: ikke vurdert (klikk for å velge 1–10)' : `Forståelse: ${value} av 10 (klikk for å endre)`;
  return chip;
}

export function noteButton(text: string): HTMLElement {
  const b = document.createElement('span');
  b.className = 'cm-exam-note';
  b.setAttribute('role', 'button');
  b.textContent = '💬';
  b.title = text;
  return b;
}

let openPicker: (() => void) | null = null;

/**
 * Ten big buttons under `anchor` to pick a rating (number keys work too, 0 = 10);
 * «Fjern» picks null. Closes on a pick, Esc or a click elsewhere.
 */
export function pickRating(anchor: DOMRect, current: number | null, onPick: (value: number | null) => void): void {
  openPicker?.();
  const root = document.createElement('div');
  root.className = 'exam-picker';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Forståelse 1–10');
  const close = () => {
    root.remove();
    window.removeEventListener('mousedown', outside, true);
    window.removeEventListener('keydown', onKey, true);
    openPicker = null;
  };
  const pick = (value: number | null) => {
    close();
    onPick(value);
  };
  for (let i = 1; i <= MAX_RATING; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `exam-pick ${ratingClass(i)}` + (i === current ? ' current' : '');
    b.textContent = String(i);
    b.addEventListener('click', () => pick(i));
    root.append(b);
  }
  if (current !== null) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'exam-pick-clear';
    clear.textContent = 'Fjern';
    clear.addEventListener('click', () => pick(null));
    root.append(clear);
  }
  const outside = (e: MouseEvent) => {
    if (!root.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if (/^[0-9]$/.test(e.key)) pick(Number(e.key) || 10);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  document.body.append(root);
  const w = root.offsetWidth;
  const h = root.offsetHeight;
  root.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - w - 8))}px`;
  root.style.top = `${anchor.bottom + h + 8 < innerHeight ? anchor.bottom + 4 : Math.max(8, anchor.top - h - 4)}px`;
  // After this mousedown has finished, so it doesn't close the picker at once.
  setTimeout(() => window.addEventListener('mousedown', outside, true));
  window.addEventListener('keydown', onKey, true);
  openPicker = close;
}
