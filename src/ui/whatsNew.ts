/**
 * "Hva er nytt": the changelog for the versions since the last start, shown
 * once after an update; also on demand (the command, and the "latest version"
 * notice). The text is CHANGELOG.md, bundled at build time.
 */
import changelogText from '../../CHANGELOG.md?raw';
import { compareVersions, entriesSince, inlineSpans, noteBlocks, parseChangelog, type ChangelogEntry } from '../app/changelog';
import { platform } from '../platform';
import { button, el, openModal } from './modal';

const LAST_VERSION_KEY = 'editor.lastVersion';

const entries = parseChangelog(changelogText);

/** Release notes (a little Markdown) as DOM. */
export function renderNotes(markdown: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const inline = (tag: string, text: string) => {
    const parent = document.createElement(tag);
    for (const span of inlineSpans(text)) {
      const style = span.style === 'bold' ? 'strong' : span.style === 'italic' ? 'em' : span.style;
      if (!style) parent.append(span.text);
      else parent.appendChild(document.createElement(style)).textContent = span.text;
    }
    return parent;
  };
  for (const block of noteBlocks(markdown)) {
    if (block.kind === 'list') frag.appendChild(document.createElement('ul')).append(...block.items.map((item) => inline('li', item)));
    else frag.append(inline(block.kind === 'heading' ? 'h4' : 'p', block.text));
  }
  return frag;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** The dialog with `shown`, and a button for the rest of the history. */
function openDialog(shown: ChangelogEntry[]): void {
  const returnFocus = document.activeElement as HTMLElement | null;
  const m = openModal('Hva er nytt', () => returnFocus?.focus());
  m.dialog.classList.add('whats-new');
  const render = (list: ChangelogEntry[]) => {
    m.body.replaceChildren();
    for (const entry of list) {
      const section = el('section', 'wn-version');
      const head = document.createElement('h3');
      head.textContent = `Versjon ${entry.version}`;
      if (entry.date) head.append(el('span', 'wn-date', formatDate(entry.date)));
      section.append(head, renderNotes(entry.notes || 'Forbedringer og feilrettinger.'));
      m.body.append(section);
    }
  };
  render(shown);
  const ok = button('OK', () => m.close(), 'primary');
  if (shown.length < entries.length) {
    const all = button(
      'Eldre versjoner',
      () => {
        render(entries);
        all.remove();
        ok.focus();
      },
      'wn-all',
    );
    m.footer.append(all);
  }
  m.footer.append(ok);
  requestAnimationFrame(() => ok.focus());
}

/** The current version's notes (or the newest, when the version is unknown). */
export async function openWhatsNew(): Promise<void> {
  const version = (await platform.appVersion?.()) ?? null;
  const upTo = version ? entries.filter((e) => compareVersions(e.version, version) <= 0) : entries;
  if (entries.length) openDialog(upTo.length ? upTo.slice(0, 1) : entries.slice(0, 1));
}

/**
 * At startup: show what changed since the version that ran last, once.
 * `isNewUser`: nothing to compare with – they get the welcome text instead.
 */
export function showWhatsNewOnStart(version: string, isNewUser: boolean): void {
  let lastSeen: string | null = null;
  try {
    lastSeen = localStorage.getItem(LAST_VERSION_KEY);
    localStorage.setItem(LAST_VERSION_KEY, version);
  } catch {
    return; // Without storage it would show on every start.
  }
  const shown = entriesSince(entries, version, lastSeen, isNewUser);
  if (shown.length) openDialog(shown);
}
