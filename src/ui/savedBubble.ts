/**
 * "Lagret" bubble under a toolbar button, like Chrome's downloads bubble:
 * the file that was just saved, with Åpne and Vis i mappen. It closes by
 * itself after a while (not while the pointer or focus is in it), on a click
 * outside, or on Escape.
 */
import { platform } from '../platform';

const CLOSE_AFTER_MS = 8000;

let current: { el: HTMLElement; cleanup: () => void } | null = null;

export function closeSavedBubble(): void {
  current?.cleanup();
  current = null;
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const folderName = (path: string) => path.split(/[\\/]/).slice(-2, -1)[0] ?? '';

/** Open a saved file in its program; errors go to `onError`. */
export function openSavedFile(path: string, onError: (message: string) => void): void {
  platform.openPath?.(path).catch((err) => onError(`Kunne ikke åpne ${fileName(path)}: ${err instanceof Error ? err.message : String(err)}`));
}

export function showSavedBubble(anchor: HTMLElement, path: string, onError: (message: string) => void): void {
  closeSavedBubble();
  const el = document.createElement('div');
  el.className = 'saved-bubble';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Lagret');

  const ext = /\.([^.\\/]+)$/.exec(path)?.[1]?.toUpperCase() ?? '';
  const file = document.createElement('div');
  file.className = 'sb-file';
  const type = Object.assign(document.createElement('span'), { className: `sb-type sb-${ext.toLowerCase()}`, textContent: ext === 'DOCX' ? 'W' : ext });
  const text = document.createElement('div');
  text.append(
    Object.assign(document.createElement('div'), { className: 'sb-name', textContent: fileName(path), title: path }),
    Object.assign(document.createElement('div'), { className: 'sb-dir', textContent: `Lagret i ${folderName(path)}` }),
  );
  file.append(type, text);

  const actions = document.createElement('div');
  actions.className = 'sb-actions';
  const button = (label: string, run: () => void) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label });
    b.addEventListener('click', () => {
      closeSavedBubble();
      run();
    });
    actions.append(b);
    return b;
  };
  if (platform.openPath) button('Åpne', () => openSavedFile(path, onError));
  if (platform.revealPath) button('Vis i mappen', () => void platform.revealPath!(path).catch(() => {}));
  el.append(file, actions);
  document.body.append(el);

  const rect = anchor.getBoundingClientRect();
  const width = el.getBoundingClientRect().width;
  el.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - width - 4))}px`;
  el.style.top = `${rect.bottom + 6}px`;
  // The arrow points at the button's middle.
  el.style.setProperty('--arrow-x', `${rect.left + rect.width / 2 - parseFloat(el.style.left)}px`);

  let timer = setTimeout(closeSavedBubble, CLOSE_AFTER_MS);
  const hold = () => clearTimeout(timer);
  const release = () => {
    clearTimeout(timer);
    if (!el.matches(':hover, :focus-within')) timer = setTimeout(closeSavedBubble, CLOSE_AFTER_MS);
  };
  const onOutside = (e: MouseEvent) => {
    if (!el.contains(e.target as Node)) closeSavedBubble();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeSavedBubble();
  };
  el.addEventListener('pointerenter', hold);
  el.addEventListener('focusin', hold);
  el.addEventListener('pointerleave', release);
  el.addEventListener('focusout', release);
  window.addEventListener('mousedown', onOutside, true);
  window.addEventListener('keydown', onKey, true);
  current = {
    el,
    cleanup: () => {
      clearTimeout(timer);
      el.remove();
      window.removeEventListener('mousedown', onOutside, true);
      window.removeEventListener('keydown', onKey, true);
    },
  };
}
