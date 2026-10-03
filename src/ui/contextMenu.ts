/**
 * A small menu: on right click, or dropped down under a button (the settings
 * menu). One open at a time; closes on click outside, Escape, scrolling or
 * window blur.
 */

export type MenuItem =
  | {
      label: string;
      action: () => void;
      disabled?: boolean;
      /** A setting that's on or off: shows a check box. */
      checked?: boolean;
    }
  | 'separator'
  | { heading: string };

let open: HTMLElement | null = null;

function close(): void {
  if (open?.dataset.owner) document.querySelector(`[data-command="${open.dataset.owner}"]`)?.classList.remove('menu-open');
  open?.remove();
  open = null;
  window.removeEventListener('mousedown', onOutside, true);
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('blur', close);
  window.removeEventListener('wheel', close, true);
}

function onOutside(e: MouseEvent): void {
  const target = e.target as Element;
  // The button that opened it toggles it itself.
  if (open?.dataset.owner && target.closest?.(`[data-command="${open.dataset.owner}"]`)) return;
  if (open && !open.contains(target)) close();
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
  }
}

export function showContextMenu(event: MouseEvent, items: MenuItem[]): void {
  event.preventDefault();
  showMenuAt(event.clientX, event.clientY, items);
}

/** Drop the menu down under a button, right-aligned with it. Clicking the button again closes it. */
export function showMenuUnder(button: HTMLElement, items: MenuItem[]): void {
  if (open && open.dataset.owner === button.dataset.command) return close();
  const rect = button.getBoundingClientRect();
  const menu = showMenuAt(rect.right, rect.bottom + 4, items, true);
  menu.dataset.owner = button.dataset.command ?? '';
  button.classList.add('menu-open');
  menu.querySelector('button')?.focus();
}

function showMenuAt(x: number, y: number, items: MenuItem[], alignRight = false): HTMLElement {
  close();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    if (item === 'separator') {
      menu.append(Object.assign(document.createElement('div'), { className: 'context-menu-separator' }));
      continue;
    }
    if ('heading' in item) {
      menu.append(Object.assign(document.createElement('div'), { className: 'context-menu-heading', textContent: item.heading }));
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    if (item.checked !== undefined) {
      button.setAttribute('role', 'menuitemcheckbox');
      button.setAttribute('aria-checked', String(item.checked));
      button.classList.add('context-menu-check');
      if (item.checked) button.classList.add('checked');
    } else button.setAttribute('role', 'menuitem');
    button.textContent = item.label;
    button.disabled = !!item.disabled;
    button.addEventListener('click', () => {
      close();
      item.action();
    });
    menu.append(button);
  }
  document.body.append(menu);
  // Keep it on screen.
  const { innerWidth, innerHeight } = window;
  const rect = menu.getBoundingClientRect();
  // Under a button: its right edge lines up with the button's.
  if (alignRight) menu.style.right = `${Math.max(4, document.documentElement.clientWidth - x)}px`;
  else menu.style.left = `${Math.max(4, Math.min(x, innerWidth - rect.width - 4))}px`;
  menu.style.top = `${Math.min(y, innerHeight - rect.height - 4)}px`;
  open = menu;
  window.addEventListener('mousedown', onOutside, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', close);
  window.addEventListener('wheel', close, true);
  return menu;
}
