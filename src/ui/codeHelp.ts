/**
 * «Kodehjelp»: how much help code files get. Pick a level (Av, Litt, Som
 * VS Code, Mye), then turn single things on or off; changes apply at once.
 * Opened from the code toolbar.
 */
import { featureInfo, levelHas, levels, type CodeHelpFeature, type FeatureInfo } from '../code/assist/levels';
import { formatKey, keyFor } from '../commands/registry';
import { getSettings, updateSettings } from '../settings';
import { button, el, openModal } from './modal';

const GROUPS: { id: FeatureInfo['group']; name: string }[] = [
  { id: 'problems', name: 'Feil og advarsler' },
  { id: 'show', name: 'Visning' },
  { id: 'writing', name: 'Mens du skriver' },
];

export function codeHelpLevelName(): string {
  const { level } = getSettings().codeHelp;
  const name = levels.find((l) => l.id === level)?.name ?? level;
  return hasOwnChoices() ? `${name} (tilpasset)` : name;
}

function hasOwnChoices(): boolean {
  const { level, overrides } = getSettings().codeHelp;
  return featureInfo.some((f) => {
    const own = overrides[f.id];
    return own !== undefined && own !== null && own !== levelHas(level, f.id);
  });
}

/** Overrides that clear every own choice (null = follow the level). */
function cleared(): Partial<Record<CodeHelpFeature, null>> {
  return Object.fromEntries(featureInfo.map((f) => [f.id, null]));
}

export function openCodeHelp(): void {
  const m = openModal('Kodehjelp');
  m.dialog.classList.add('ch-dialog');

  const render = () => {
    const scroll = m.body.scrollTop;
    const { level, overrides } = getSettings().codeHelp;
    m.body.replaceChildren();
    m.body.append(el('p', 'sc-hint', 'Hvor mye hjelp vil du ha når du skriver kode? Det du velger, gjelder med en gang i alle kodefiler.'));

    const choices = el('div', 'ch-levels');
    choices.setAttribute('role', 'radiogroup');
    choices.setAttribute('aria-label', 'Hvor mye hjelp');
    for (const l of levels) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ch-level';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(l.id === level));
      b.classList.toggle('active', l.id === level);
      b.append(el('span', 'ch-level-name', l.name), el('span', 'ch-level-desc', l.description));
      // Choosing a level starts from it: own choices are cleared.
      b.addEventListener('click', () => {
        updateSettings({ codeHelp: { level: l.id, overrides: cleared() } });
        render();
      });
      choices.append(b);
    }
    m.body.append(choices);

    m.body.append(el('h3', 'sc-step', 'Velg selv'));
    m.body.append(el('p', 'sc-hint', 'Kryss av eller fjern enkeltting. Det du endrer her, går foran nivået.'));
    for (const group of GROUPS) {
      m.body.append(el('h4', 'ch-group', group.name));
      for (const f of featureInfo.filter((x) => x.group === group.id)) {
        const fromLevel = levelHas(level, f.id);
        const own = overrides[f.id];
        const on = own ?? fromLevel;
        const row = document.createElement('label');
        row.className = 'ch-feature';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = on;
        box.addEventListener('change', () => {
          updateSettings({ codeHelp: { overrides: { [f.id]: box.checked === fromLevel ? null : box.checked } } });
          render();
        });
        const text = el('span', 'ch-feature-text');
        const name = el('span', 'ch-feature-name', f.name);
        if (own !== undefined && own !== null && own !== fromLevel) name.append(el('span', 'ch-changed', 'endret'));
        text.append(name, el('span', 'ch-feature-desc', f.description));
        row.append(box, text);
        m.body.append(row);
      }
    }

    m.body.append(el('h3', 'sc-step', 'Taster'));
    const keys = el('ul', 'ch-keys');
    const key = (id: string) => formatKey(keyFor(id) ?? '') || '–';
    for (const [k, what] of [
      [key('code.nextProblem'), 'gå til neste feil'],
      [key('code.problems'), 'vis listen over alle problemer'],
      [key('code.rename'), 'gi nytt navn: markerer alle stedene variabelen brukes, så du kan skrive det nye navnet'],
      [key('code.goToDefinition'), 'gå til der navnet er definert'],
      ['Ctrl+Mellomrom', 'vis forslag'],
    ]) {
      const li = el('li', '');
      li.append(el('kbd', '', k), document.createTextNode(` ${what}`));
      keys.append(li);
    }
    m.body.append(keys);
    m.body.append(el('p', 'sc-hint', 'Hold musa over en strek for å se hva som er galt. Ofte får du en knapp som retter det.'));

    reset.disabled = !hasOwnChoices();
    reset.textContent = `Tilbake til «${levels.find((l) => l.id === level)?.name}»`;
    m.body.scrollTop = scroll;
  };

  const reset = button('', () => {
    updateSettings({ codeHelp: { overrides: cleared() } });
    render();
  });
  reset.className = 'ch-reset';
  m.footer.append(reset, button('Lukk', () => m.close(), 'primary'));
  render();
  requestAnimationFrame(() => (m.body.querySelector('.ch-level.active') as HTMLElement | null)?.focus());
}
