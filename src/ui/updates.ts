/**
 * Update check: a small notice in the corner when a new version is
 * published, with "Update now". Desktop only.
 */
import { platform, type AvailableUpdate } from '../platform';

let notice: HTMLElement | null = null;

function showNotice(build: (el: HTMLElement) => void, autoHideMs?: number): void {
  notice?.remove();
  const el = document.createElement('div');
  el.className = 'update-notice';
  el.setAttribute('role', 'status');
  build(el);
  document.body.append(el);
  notice = el;
  if (autoHideMs) setTimeout(() => el.remove(), autoHideMs);
}

function button(text: string, primary: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = primary ? 'primary' : '';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function offerUpdate(update: AvailableUpdate, beforeInstall: () => Promise<void>): void {
  showNotice((el) => {
    const text = document.createElement('div');
    text.className = 'update-text';
    const title = document.createElement('strong');
    title.textContent = `Ny versjon ${update.version} er klar`;
    text.append(title);
    if (update.notes) {
      const notes = document.createElement('div');
      notes.className = 'update-notes';
      notes.textContent = update.notes;
      text.append(notes);
    }
    const actions = document.createElement('div');
    actions.className = 'update-actions';
    actions.append(
      button('Senere', false, () => el.remove()),
      button('Oppdater nå', true, async () => {
        const progress = document.createElement('span');
        progress.textContent = 'Lagrer …';
        actions.replaceChildren(progress);
        try {
          await beforeInstall();
          progress.textContent = 'Laster ned …';
          await update.install((f) => {
            if (f === null) progress.textContent = 'Laster ned …';
            else if (f >= 1) progress.textContent = 'Installerer – programmet starter på nytt';
            else progress.textContent = `Laster ned … ${Math.round(f * 100)} %`;
          });
        } catch (err) {
          progress.textContent = `Oppdatering feilet: ${err instanceof Error ? err.message : String(err)}`;
        }
      }),
    );
    el.append(text, actions);
  });
}

/**
 * Look for an update. `quiet`: say nothing unless one is found (startup).
 * `beforeInstall` runs before the app is closed for installing.
 */
export async function checkForUpdates(quiet: boolean, beforeInstall: () => Promise<void>): Promise<void> {
  if (!platform.checkForUpdate) return;
  try {
    const update = await platform.checkForUpdate();
    if (update) offerUpdate(update, beforeInstall);
    else if (!quiet) {
      const version = (await platform.appVersion?.()) ?? '';
      showNotice((el) => (el.textContent = `Du har nyeste versjon (${version}).`), 4000);
    }
  } catch (err) {
    if (!quiet) {
      const message = err instanceof Error ? err.message : String(err);
      showNotice((el) => (el.textContent = `Kunne ikke se etter oppdateringer: ${message}`), 6000);
    }
  }
}
