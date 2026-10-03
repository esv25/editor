/**
 * A small modal dialog (the shortcut dialogs), and helpers for building one.
 * Esc closes it; a click outside doesn't (easy to do by accident).
 */
import { registerFocusZone, unregisterFocusZone } from '../features/math';

export interface Modal {
  dialog: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
  close(): void;
}

export function openModal(title: string, onClose?: () => void): Modal {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'modal';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', title);
  const h = document.createElement('h2');
  h.textContent = title;
  const body = document.createElement('div');
  body.className = 'modal-body';
  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  dialog.append(h, body, footer);
  overlay.append(dialog);
  // Leave the math panel free below the dialog: it can fill in the dialog's formula.
  const panel = document.getElementById('math-panel');
  if (panel && !panel.hidden) overlay.style.bottom = `${panel.offsetHeight}px`;
  document.body.append(overlay);
  registerFocusZone(overlay);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    unregisterFocusZone(overlay);
    overlay.remove();
    window.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  // Esc closes (a click outside doesn't: easy to do by accident). Not from the formula
  // field or the key recorder, where Esc means something of its own.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !e.defaultPrevented && !(e.target as Element | null)?.closest('.sc-recorder, .mf')) {
      e.preventDefault();
      close();
    }
  };
  window.addEventListener('keydown', onKey, true);
  return { dialog, body, footer, close };
}

export function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (className) b.className = className;
  b.addEventListener('click', onClick);
  return b;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
