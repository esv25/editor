/**
 * Update check: a small notice in the corner when a new version is
 * published, with "Update now". Desktop only. The installed app checks
 * shortly after start and then now and then while it runs.
 */
import { platform, type AvailableUpdate } from '../platform';
import { getSettings } from '../settings';
import { openWhatsNew, renderNotes } from './whatsNew';

let notice: HTMLElement | null = null;
/** The version button in the status bar; shows a waiting update. */
let versionButton: HTMLElement | null = null;
/** Version the user said «Senere» to: background checks don't offer it again. */
let postponed: string | null = null;
let installing = false;
let checking = false;
let lastCheck = 0;

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

function markAvailable(version: string): void {
  if (!versionButton) return;
  versionButton.classList.add('has-update');
  versionButton.dataset.update = version;
  versionButton.title = `Versjon ${version} er klar – klikk for å oppdatere`;
}

function offerUpdate(update: AvailableUpdate, beforeInstall: () => Promise<void>): void {
  showNotice((el) => {
    el.dataset.version = update.version;
    const text = document.createElement('div');
    text.className = 'update-text';
    const title = document.createElement('strong');
    title.textContent = `Ny versjon ${update.version} er klar`;
    text.append(title);
    if (update.notes) {
      const notes = document.createElement('div');
      notes.className = 'update-notes';
      notes.append(renderNotes(update.notes));
      text.append(notes);
    }
    const actions = document.createElement('div');
    actions.className = 'update-actions';
    actions.append(
      button('Senere', false, () => {
        postponed = update.version;
        el.remove();
      }),
      button('Oppdater nå', true, async () => {
        const progress = document.createElement('span');
        progress.textContent = 'Lagrer …';
        actions.replaceChildren(progress);
        installing = true;
        try {
          await beforeInstall();
          progress.textContent = 'Laster ned …';
          await update.install((f) => {
            if (f === null) progress.textContent = 'Laster ned …';
            else if (f >= 1) progress.textContent = 'Installerer – programmet starter på nytt';
            else progress.textContent = `Laster ned … ${Math.round(f * 100)} %`;
          });
        } catch (err) {
          installing = false;
          progress.textContent = `Oppdatering feilet: ${err instanceof Error ? err.message : String(err)}`;
        }
      }),
    );
    el.append(text, actions);
  });
}

/**
 * Look for an update. `quiet`: say nothing unless one is found, and don't
 * offer it again if it's already shown or postponed (background checks).
 * `beforeInstall` runs before the app is closed for installing.
 */
export async function checkForUpdates(quiet: boolean, beforeInstall: () => Promise<void>): Promise<void> {
  if (!platform.checkForUpdate || installing || (quiet && checking)) return;
  checking = true;
  lastCheck = Date.now();
  try {
    const update = await platform.checkForUpdate();
    if (update) {
      markAvailable(update.version);
      const shown = notice?.isConnected && notice.dataset.version === update.version;
      if (installing || (quiet && (shown || update.version === postponed))) update.dispose?.();
      else offerUpdate(update, beforeInstall);
    } else if (!quiet) {
      const version = (await platform.appVersion?.()) ?? '';
      showNotice((el) => {
        const actions = document.createElement('div');
        actions.className = 'update-actions';
        actions.append(
          button('Hva er nytt', false, () => {
            el.remove();
            void openWhatsNew();
          }),
        );
        el.append(`Du har nyeste versjon (${version}).`, actions);
      }, 6000);
    }
  } catch (err) {
    if (!quiet) {
      const message = err instanceof Error ? err.message : String(err);
      showNotice((el) => (el.textContent = `Kunne ikke se etter oppdateringer: ${message}`), 6000);
    }
  } finally {
    checking = false;
  }
}

/**
 * Clicking the version in the status bar checks on demand. With `watch`
 * (installed app) also check shortly after start, then every
 * `settings.updates.checkMinutes` – a check that fell due while the PC
 * slept runs within a minute of waking.
 */
export function setupUpdates(versionEl: HTMLElement, beforeInstall: () => Promise<void>, watch: boolean): void {
  versionButton = versionEl;
  versionEl.addEventListener('click', () => void checkForUpdates(false, beforeInstall));
  if (!watch) return;
  setTimeout(() => void checkForUpdates(true, beforeInstall), 4000);
  setInterval(() => {
    const minutes = getSettings().updates.checkMinutes;
    if (minutes > 0 && lastCheck > 0 && Date.now() - lastCheck >= minutes * 60_000) {
      void checkForUpdates(true, beforeInstall);
    }
  }, 60_000);
}
