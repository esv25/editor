/**
 * The user's own math shortcuts.
 *
 * The editor: what the shortcut writes is built in a formula field (the
 * same WYSIWYG editing as in notes, and the math panel inserts into it),
 * with optional empty spots (the cursor jumps there) and «det som er
 * markert» (the selection goes there). What triggers it: a key
 * combination, a sequence (Ctrl+M, then F) or an abbreviation typed in a
 * formula. Recording keys needs no timing: each press adds a key.
 *
 * The manager lists them all, and the built-in abbreviations (which can be
 * turned off), and the fixed keys of the formula field.
 */
import katex from 'katex';
import { trust } from '../features/math/render';
import type { EditorView } from '@codemirror/view';
import { isAltGraph, keySpecFromEvent, MODIFIER_KEYS, normalizeKey, strokes } from '../commands/keys';
import { allCommands, keysFor } from '../commands/registry';
import { closeMathField, describeKeys, fieldOptions, registerFocusZone, setInsertTarget, unregisterFocusZone } from '../features/math';
import { itemsById, previewLatex, type MathItem } from '../features/math/catalog';
import { MathField } from '../features/math/field';
import { DEFAULT_SHORTCUTS } from '../features/math/shortcuts';
import { getSettings, updateSettings } from '../settings';

// --- A small modal dialog ------------------------------------------------------

interface Modal {
  dialog: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
  close(): void;
}

function openModal(title: string, onClose?: () => void): Modal {
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

function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (className) b.className = className;
  b.addEventListener('click', onClick);
  return b;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function formulaPreview(latex: string): HTMLElement {
  const span = el('span', 'sc-preview');
  const action = latex.startsWith('@') ? [...itemsById.values()].find((it) => it.action === latex.slice(1)) : undefined;
  if (action) {
    span.textContent = action.name;
    return span;
  }
  try {
    span.innerHTML = katex.renderToString(previewLatex({ latex } as MathItem), { throwOnError: true, strict: 'ignore', trust });
  } catch {
    span.textContent = latex;
  }
  return span;
}

// --- Checking a key sequence --------------------------------------------------

/** Warnings for a key sequence: what it replaces or shares a key with. */
function keyWarnings(spec: string, editing?: string): string[] {
  const keys = strokes(spec).map(normalizeKey);
  const warnings: string[] = [];
  for (const command of allCommands()) {
    for (const k of keysFor(command.id)) {
      const theirs = strokes(k).map(normalizeKey);
      if (theirs.length !== 1 || theirs[0] !== keys[0]) continue;
      if (keys.length === 1) warnings.push(`${describeKeys(k)} brukes nå til «${command.name}». Hurtigtasten din tar over.`);
      else warnings.push(`${describeKeys(k)} er «${command.name}». Den virker fortsatt hvis du venter litt etter å ha trykket den.`);
    }
  }
  const settings = getSettings();
  for (const [other, latex] of Object.entries(settings.math.keys)) {
    if (!latex || other === editing) continue;
    const theirs = strokes(other).map(normalizeKey);
    const name = settings.math.names[other] || describeKeys(other);
    if (theirs.join(' ') === keys.join(' ')) warnings.push(`Erstatter hurtigtasten «${name}».`);
    else if (theirs.length !== keys.length && theirs.every((k, i) => i >= keys.length || k === keys[i]) && keys.every((k, i) => i >= theirs.length || k === theirs[i])) {
      warnings.push(`Den deler starten med «${name}» (${describeKeys(other)}): den korteste virker når du venter litt.`);
    }
  }
  const first = keys[0];
  const inFormula: Record<string, string> = {
    'Ctrl-z': 'angre',
    'Ctrl-y': 'gjør om',
    'Ctrl-a': 'merk alt',
    'Ctrl-c': 'kopier',
    'Ctrl-x': 'klipp ut',
    'Ctrl-v': 'lim inn',
    'Ctrl-s': 'lagre',
  };
  if (keys.length === 1 && inFormula[first]) warnings.push(`Vanligvis betyr den «${inFormula[first]}» – det vil den ikke gjøre lenger.`);
  return [...new Set(warnings)];
}

function textWarnings(text: string, editing?: string): string[] {
  const warnings: string[] = [];
  if (/\s/.test(text)) warnings.push('Forkortelsen kan ikke inneholde mellomrom.');
  if (DEFAULT_SHORTCUTS[text] !== undefined) warnings.push(`«${text}» er en innebygd forkortelse – din tar over.`);
  const own = getSettings().math.shortcuts[text];
  if (own && text !== editing) warnings.push(`Erstatter din forkortelse «${text}».`);
  if (text.length <= 2 && /^[a-zA-Z]+$/.test(text)) {
    warnings.push('Korte forkortelser av bokstaver kan slå til når du ikke vil. Backspace rett etter angrer.');
  }
  return warnings;
}

// --- The editor ----------------------------------------------------------------

export interface ShortcutEditorOptions {
  getView: () => EditorView;
  /** What it writes (a template, or '@action'). */
  latex?: string;
  name?: string;
  /** The trigger of an existing shortcut being changed. */
  edit?: string;
}

export function openShortcutEditor(opts: ShortcutEditorOptions): void {
  closeMathField(null);
  const settings = getSettings();
  const editKind = opts.edit === undefined ? null : settings.math.keys[opts.edit] ? 'key' : 'text';
  const initial = opts.latex ?? (opts.edit ? (settings.math.keys[opts.edit] ?? settings.math.shortcuts[opts.edit] ?? '') : '');
  const action = initial.startsWith('@') ? initial : null;

  let field: MathField | null = null;
  const m = openModal(opts.edit ? 'Endre hurtigtast' : 'Ny hurtigtast', () => {
    if (field) field.closed = true;
    setInsertTarget(null);
  });

  // A tidy form: a label on the left, what to do on the right.
  const form = el('div', 'sc-form');
  m.body.append(form);
  const row = (label: string, ...content: (Node | string)[]): HTMLElement => {
    const box = el('div', 'sc-content');
    box.append(...content);
    form.append(el('div', 'sc-label', label), box);
    return box;
  };

  // What it writes.
  if (action) {
    row('Gjør', el('p', 'sc-action', formulaPreview(action).textContent ?? ''));
  } else {
    const box = el('div', 'sc-formula');
    const history: string[] = [];
    field = new MathField(
      initial,
      { display: false, template: true, ...fieldOptions() },
      {
        change: () => {
          history.push(field!.editor.latex);
          check();
        },
        exit: () => field!.focus(),
        undo: () => {
          history.pop();
          field!.reload(history[history.length - 1] ?? initial);
          check();
        },
        redo: () => {},
        key: () => false,
        keepsFocus: () => true,
      },
    );
    box.append(field.dom);
    box.addEventListener('mousedown', (e) => {
      if (e.target === box) {
        e.preventDefault();
        field!.placeAtEdge('end');
        field!.focus();
        field!.draw();
      }
    });
    const f = field;
    const tool = (label: string, title: string, run: () => void) => {
      const b = button(label, () => {
        run();
        f.update();
        f.focus();
      });
      b.title = title;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      return b;
    };
    const tools = el('div', 'sc-tools');
    tools.append(
      tool('□ Tomt felt', 'Et tomt felt i formelen: markøren hopper hit (Tab)', () => f.editor.insertSpecial('ph')),
      tool('▣ Det som er markert', 'Det du har markert når du bruker hurtigtasten, havner her', () => f.editor.insertSpecial('slot')),
      tool('Tøm', 'Begynn på nytt', () => {
        f.editor.selectAll();
        f.editor.backspace();
      }),
      el('span', 'sc-hint', 'eller klikk i mattepanelet'),
    );
    row('Skriver', box, tools);
    setInsertTarget(field);
    requestAnimationFrame(() => {
      if (!f.dom.isConnected) return;
      f.placeAtEdge('end');
      f.draw();
      f.focus();
    });
  }

  // What triggers it.
  let kind: 'key' | 'text' = editKind ?? 'key';
  let recorded: string[] = editKind === 'key' && opts.edit ? strokes(opts.edit) : [];
  const choices = el('div', 'sc-segmented');
  const keyChoice = button('Taster', () => setKind('key', true), 'sc-choice');
  const textChoice = button('Forkortelse i formler', () => setKind('text', true), 'sc-choice');
  if (action) textChoice.disabled = true;
  choices.append(keyChoice, textChoice);

  const keyPane = el('div', 'sc-pane');
  const recorder = el('div', 'sc-recorder');
  recorder.tabIndex = 0;
  recorder.setAttribute('role', 'button');
  recorder.title = 'Klikk her og trykk tastene. Flere etter hverandre gir en sekvens, f.eks. Ctrl+M og så F.';
  const recordedText = el('span', 'sc-recorded');
  const recordedHint = el('span', 'sc-recorder-hint');
  const again = button('↺', () => {
    recorded = [];
    renderKeys();
    recorder.focus();
  }, 'sc-again');
  again.title = 'Ta opp på nytt';
  recorder.append(recordedText, recordedHint, again);
  keyPane.append(recorder);

  const textPane = el('div', 'sc-pane');
  const textInput = document.createElement('input');
  textInput.className = 'sc-text';
  textInput.placeholder = 'f.eks. kvr – byttes ut når du skriver den i en formel';
  textInput.value = editKind === 'text' && opts.edit ? opts.edit : '';
  textInput.addEventListener('input', check);
  textPane.append(textInput);

  const warnings = el('ul', 'sc-warnings');
  row('Utløses av', choices, keyPane, textPane, warnings);

  // Name.
  const nameInput = document.createElement('input');
  nameInput.className = 'sc-name';
  nameInput.placeholder = 'Valgfritt – vises i panelet, f.eks. «Kvadratsetning»';
  nameInput.value = opts.name ?? (opts.edit ? settings.math.names[opts.edit] ?? '' : '');
  row('Navn', nameInput);

  const save = button('Lagre', () => doSave(), 'primary');
  if (opts.edit) m.footer.append(button('Slett', () => doDelete(), 'danger'));
  m.footer.append(button('Avbryt', () => m.close()), save);

  recorder.addEventListener('focus', () => {
    recorder.classList.add('recording');
    renderKeys();
  });
  recorder.addEventListener('blur', () => {
    recorder.classList.remove('recording');
    renderKeys();
  });
  recorder.addEventListener('keydown', (e) => {
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    if (plain && e.key === 'Tab') return; // leave the field
    if (plain && e.key === 'Escape') {
      e.preventDefault();
      recorder.blur();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (MODIFIER_KEYS.has(e.key)) return;
    if (isAltGraph(e)) {
      showWarnings(['Ctrl+Alt er det samme som AltGr på norsk tastatur (for @, { og [). Velg en annen kombinasjon.']);
      return;
    }
    const spec = keySpecFromEvent(e, recorded.length > 0);
    if (!spec) {
      showWarnings(['Begynn med Ctrl, Alt eller en F-tast – vanlige taster skriver jo tekst.']);
      return;
    }
    if (recorded.length >= 3) recorded = [];
    recorded.push(spec);
    renderKeys();
  });

  function setKind(k: 'key' | 'text', focus: boolean): void {
    kind = k;
    keyChoice.classList.toggle('active', k === 'key');
    textChoice.classList.toggle('active', k === 'text');
    keyPane.hidden = k !== 'key';
    textPane.hidden = k !== 'text';
    if (focus) (k === 'key' ? recorder : textInput).focus();
    check();
  }

  /** The recorder says what to do next. */
  function renderKeys(): void {
    const recording = document.activeElement === recorder;
    recordedText.textContent = recorded.length
      ? describeKeys(recorded.join(' '))
      : recording
        ? 'Trykk tastene nå …'
        : 'Klikk her, og trykk tastene';
    recordedHint.textContent = !recorded.length
      ? recording
        ? 'f.eks. Ctrl+Shift+K – begynn med Ctrl, Alt eller en F-tast'
        : ''
      : recording && recorded.length < 3
        ? 'Trykk en tast til for en sekvens'
        : '';
    recorder.classList.toggle('empty', recorded.length === 0);
    again.hidden = recorded.length === 0;
    check();
  }

  function showWarnings(list: string[]): void {
    warnings.replaceChildren(...list.map((w) => el('li', '', w)));
  }

  function output(): string {
    return action ?? field?.editor.latex.trim() ?? '';
  }

  function trigger(): string {
    return kind === 'key' ? recorded.join(' ') : textInput.value.trim();
  }

  function check(): void {
    const t = trigger();
    const list = t ? (kind === 'key' ? keyWarnings(t, opts.edit) : textWarnings(t, opts.edit)) : [];
    showWarnings(list);
    const blocked = !t || !output() || (kind === 'text' && /\s/.test(t));
    save.disabled = blocked;
  }

  function doSave(): void {
    const t = trigger();
    const latex = output();
    if (!t || !latex) return;
    const keys: Record<string, string | null> = {};
    const shortcuts: Record<string, string | null> = {};
    const names: Record<string, string> = {};
    if (opts.edit !== undefined && opts.edit !== t) {
      if (editKind === 'key') keys[opts.edit] = null;
      else shortcuts[opts.edit] = DEFAULT_SHORTCUTS[opts.edit] ?? null;
      names[opts.edit] = '';
    }
    if (kind === 'key') keys[t] = latex;
    else shortcuts[t] = latex;
    names[t] = nameInput.value.trim();
    updateSettings({ math: { keys, shortcuts, names } });
    m.close();
  }

  function doDelete(): void {
    if (opts.edit === undefined) return;
    if (editKind === 'key') updateSettings({ math: { keys: { [opts.edit]: null }, names: { [opts.edit]: '' } } });
    else updateSettings({ math: { shortcuts: { [opts.edit]: DEFAULT_SHORTCUTS[opts.edit] ?? null }, names: { [opts.edit]: '' } } });
    m.close();
  }

  renderKeys();
  setKind(kind, false);
  if (!action) requestAnimationFrame(() => field?.focus());
}

// --- The overview ----------------------------------------------------------------

export function openShortcutManager(getView: () => EditorView): void {
  closeMathField(null);
  const m = openModal('Hurtigtaster for matte');
  const render = () => {
    const settings = getSettings();
    m.body.replaceChildren();

    m.body.append(el('h3', 'sc-step', 'Dine hurtigtaster'));
    const own = [
      ...Object.entries(settings.math.keys)
        .filter((e): e is [string, string] => !!e[1])
        .map(([t, latex]) => ({ t, latex, label: describeKeys(t) })),
      ...Object.entries(settings.math.shortcuts)
        .filter((e): e is [string, string] => !!e[1] && DEFAULT_SHORTCUTS[e[0]] !== e[1])
        .map(([t, latex]) => ({ t, latex, label: `skriv «${t}»` })),
    ];
    if (!own.length) m.body.append(el('p', 'sc-hint', 'Du har ingen egne ennå. Lag en her, eller høyreklikk et symbol i mattepanelet.'));
    const list = el('div', 'sc-list');
    for (const { t, latex, label } of own) {
      const row = el('div', 'sc-row');
      row.append(
        formulaPreview(latex),
        el('span', 'sc-trigger', label),
        el('span', 'sc-row-name', settings.math.names[t] ?? ''),
        button('Endre', () => {
          m.close();
          openShortcutEditor({ getView, edit: t });
        }),
        button('Slett', () => {
          if (settings.math.keys[t]) updateSettings({ math: { keys: { [t]: null } } });
          else updateSettings({ math: { shortcuts: { [t]: DEFAULT_SHORTCUTS[t] ?? null } } });
          render();
        }),
      );
      list.append(row);
    }
    m.body.append(
      list,
      button(
        '+ Ny hurtigtast',
        () => {
          m.close();
          openShortcutEditor({ getView });
        },
        'primary sc-new',
      ),
    );

    m.body.append(el('h3', 'sc-step', 'Innebygde forkortelser'), el('p', 'sc-hint', 'Skriv dem i en formel. Klikk for å slå av eller på.'));
    const builtIn = el('div', 'sc-builtin');
    for (const [t, latex] of Object.entries(DEFAULT_SHORTCUTS)) {
      const off = settings.math.shortcuts[t] === null;
      const b = el('button', `sc-chip${off ? ' off' : ''}`);
      b.type = 'button';
      b.title = off ? 'Av – klikk for å slå på' : 'På – klikk for å slå av';
      const shown = latex.startsWith('@') ? el('span', 'sc-preview', 'opphøyd') : formulaPreview(latex);
      b.append(el('code', '', t), shown);
      b.addEventListener('click', () => {
        updateSettings({ math: { shortcuts: { [t]: off ? latex : null } } });
        render();
      });
      builtIn.append(b);
    }
    m.body.append(builtIn);

    m.body.append(el('h3', 'sc-step', 'Faste taster i formler'));
    const fixed: [string, string][] = [
      ['/', 'brøk (det foran blir teller)'],
      ['^ eller **', 'opphøyd'],
      ['_', 'senket skrift'],
      ['Ctrl+↑ / Ctrl+↓', 'opphøyd / senket'],
      ['( [ { |', 'parenteser og absoluttverdi'],
      ['*', 'gangetegn ·'],
      ['"', 'tekst, f.eks. «eller»'],
      ['\\', 'søk etter symbol med navn'],
      ['mellomrom', 'videre: fra teller til nevner, ut av potens'],
      ['Tab', 'neste tomme felt'],
      ['Enter', 'ny linje i formelblokk / ferdig'],
      ['Esc', 'ut av formelen'],
      [', + mellomrom', 'liste-komma (uten mellomrom: desimalkomma)'],
      ['Ctrl+M', 'ny formel  ·  Ctrl+Shift+M: formelblokk'],
    ];
    const table = el('div', 'sc-fixed');
    for (const [k, what] of fixed) table.append(el('kbd', '', k), el('span', '', what));
    m.body.append(table);
  };
  m.footer.append(button('Lukk', () => m.close(), 'primary'));
  render();
}
