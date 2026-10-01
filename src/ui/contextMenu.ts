/**
 * A small right-click menu. One open at a time; closes on click outside,
 * Escape, scrolling or window blur.
 */

export type MenuItem = { label: string; action: () => void; disabled?: boolean } | 'separator';

let open: HTMLElement | null = null;

function close(): void {
  open?.remove();
  open = null;
  window.removeEventListener('mousedown', onOutside, true);
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('blur', close);
  window.removeEventListener('wheel', close, true);
}

function onOutside(e: MouseEvent): void {
  if (open && !open.contains(e.target as Node)) close();
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
  }
}

export function showContextMenu(event: MouseEvent, items: MenuItem[]): void {
  event.preventDefault();
  close();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    if (item === 'separator') {
      menu.append(Object.assign(document.createElement('div'), { className: 'context-menu-separator' }));
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
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
  menu.style.left = `${Math.min(event.clientX, innerWidth - rect.width - 4)}px`;
  menu.style.top = `${Math.min(event.clientY, innerHeight - rect.height - 4)}px`;
  open = menu;
  window.addEventListener('mousedown', onOutside, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', close);
  window.addEventListener('wheel', close, true);
}
