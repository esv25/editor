/**
 * The properties panel on the right: one-click choices for what's
 * selected (line type, texts at the ends, double/dashed outline …), or for
 * new lines while the Pil tool is on. Everything is a button or a text field
 * – nothing needs precise pointing.
 */
import type { DiagramCanvas } from './canvas';
import { edgePresets, presetIcon, sameStyle } from './edges';
import { styleOf, type EdgeStyle } from './model';
import { setUnderline, shapeIcon, textUnderline, type Underline } from './shapes/common';
import { toSvgString } from './svg';
import { newEdgeStyle, setNewEdgeStyle } from './tools/arrow';
import { newLineStyle, setNewLineStyle } from './tools/line';

export interface PropertiesBar {
  update(): void;
}

const underlineIcon = (kind: Underline) =>
  shapeIcon(`<path d="M7 4v7a5 5 0 0 0 10 0V4"/><path d="M4 20h16"${kind === 'dashed' ? ' stroke-dasharray="3 3"' : ''}/>`);

export function renderProperties(bar: HTMLElement, canvas: DiagramCanvas): PropertiesBar {
  let shownFor = '';
  let refreshers: (() => void)[] = [];

  const button = (label: string, title: string, onClick: () => void, isActive?: () => boolean, icon?: string) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'dg-button dg-small';
    el.title = title;
    el.innerHTML = icon ?? '';
    const text = document.createElement('span');
    text.textContent = label;
    el.append(text);
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', onClick);
    if (isActive) {
      refreshers.push(() => {
        el.classList.toggle('active', isActive());
        el.setAttribute('aria-pressed', String(isActive()));
      });
    }
    bar.append(el);
  };

  const field = (label: string, placeholder: string, get: () => string, set: (value: string) => void) => {
    const wrap = document.createElement('label');
    wrap.className = 'dg-field';
    wrap.append(label);
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.value = get();
    input.addEventListener('change', () => set(input.value.trim()));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') input.blur();
    });
    refreshers.push(() => {
      if (document.activeElement !== input) input.value = get();
    });
    wrap.append(input);
    bar.append(wrap);
  };

  const heading = (text: string) => {
    const el = document.createElement('span');
    el.className = 'dg-props-heading';
    el.textContent = text;
    bar.append(el);
  };

  const tip = (text: string) => {
    const el = document.createElement('span');
    el.className = 'dg-props-tip';
    el.textContent = text;
    bar.append(el);
  };

  /** The line types, then «Dobbel linje» (kept when the type changes). */
  const presetButtons = (current: () => EdgeStyle, choose: (style: EdgeStyle) => void) => {
    const withDouble = (style: EdgeStyle, double: boolean): EdgeStyle => ({ ...style, double: double || undefined });
    for (const preset of edgePresets) {
      button(preset.name, preset.title, () => choose(withDouble(preset.style, !!current().double)), () => sameStyle(current(), preset.style), toSvgString(presetIcon(preset.style)));
    }
    button(
      'Dobbel linje',
      'To streker ved siden av hverandre (total deltakelse i ER …)',
      () => choose(withDouble(current(), !current().double)),
      () => !!current().double,
      toSvgString(presetIcon({ head: 'none', tail: 'none', dashed: false, double: true })),
    );
  };

  function build(): void {
    bar.replaceChildren();
    refreshers = [];
    const edge = canvas.selectedEdge;
    const node = canvas.selectedNode;

    if (edge) {
      heading('Linje');
      presetButtons(
        () => styleOf(canvas.selectedEdge ?? edge),
        (style) => {
          setNewEdgeStyle(style);
          canvas.updateSelectedEdge(style);
        },
      );
      button('Snu', 'Snu linja (start og slutt bytter plass)', () => canvas.reverseSelectedEdge());
      heading('Tekst');
      field('Ved start', 'f.eks. 1', () => canvas.selectedEdge?.fromLabel ?? '', (v) => canvas.updateSelectedEdge({ fromLabel: v || undefined }));
      field('Midt på', 'tekst', () => canvas.selectedEdge?.label ?? '', (v) => canvas.updateSelectedEdge({ label: v || undefined }));
      field('Ved slutt', 'f.eks. N', () => canvas.selectedEdge?.toLabel ?? '', (v) => canvas.updateSelectedEdge({ toLabel: v || undefined }));
      return;
    }

    // With Pil on, choosing the type of the next line matters more than the figure it selected.
    if (canvas.tool.id === 'line') {
      heading('Nye streker');
      presetButtons(newLineStyle, (style) => {
        setNewLineStyle(style);
        refresh();
      });
      tip('Nær et hjørne eller et midtpunkt på en figur hekter streken seg fast der (en ring viser det).');
      return;
    }

    if (canvas.tool.id === 'arrow') {
      heading('Nye linjer');
      presetButtons(newEdgeStyle, (style) => {
        setNewEdgeStyle(style);
        refresh();
      });
      return;
    }

    if (node) {
      heading('Figur');
      button('Skriv tekst', 'Skriv eller endre teksten (Enter)', () => canvas.editSelection());
      const toggleDashed = (label: string) =>
        button(label, 'Stiplet strek (avledet attributt …)', () => canvas.updateSelectedNode({ dashed: canvas.selectedNode?.dashed ? undefined : true }), () => !!canvas.selectedNode?.dashed);
      // An open line has no outline: «Dobbel linje» comes with its ends, «Stiplet» under Strek.
      const openLine = node.shape === 'path' && !node.closed;
      if (!openLine) {
        heading('Kant');
        button('Dobbel kant', 'To streker rundt (svak entitet, flerverdi-attributt …)', () => canvas.updateSelectedNode({ double: canvas.selectedNode?.double ? undefined : true }), () => !!canvas.selectedNode?.double);
        toggleDashed('Stiplet kant');
      } else {
        heading('Ender');
        const ends = (): EdgeStyle => {
          const n = canvas.selectedNode;
          return { head: n?.head ?? 'none', tail: n?.tail ?? 'none', dashed: !!n?.dashed, double: n?.double };
        };
        presetButtons(ends, (style) =>
          canvas.updateSelectedNode({
            head: style.head === 'none' ? undefined : style.head,
            tail: style.tail === 'none' ? undefined : style.tail,
            dashed: style.dashed || undefined,
            double: style.double || undefined,
          }),
        );
      }
      if (node.shape === 'path') {
        heading('Strek');
        if (openLine) toggleDashed('Stiplet');
        button('Glatt', 'Myk kurve gjennom punktene (av: rette streker)', () => canvas.updateSelectedNode({ smooth: canvas.selectedNode?.smooth === false ? undefined : false }), () => canvas.selectedNode?.smooth !== false);
        button('Lukket', 'Koble siste punkt tilbake til det første', () => canvas.updateSelectedNode({ closed: canvas.selectedNode?.closed ? undefined : true }), () => !!canvas.selectedNode?.closed);
      }
      if (node.shape !== 'class') {
        heading('Tekst');
        const underlineButton = (kind: Underline, label: string, title: string) =>
          button(
            label,
            title,
            () => {
              const text = canvas.selectedNode?.text ?? '';
              if (!text.trim()) return canvas.editSelection();
              canvas.updateSelectedNode({ text: setUnderline(text, textUnderline(text) === kind ? null : kind) });
            },
            () => textUnderline(canvas.selectedNode?.text ?? '') === kind,
            underlineIcon(kind),
          );
        underlineButton('solid', 'Understrek', 'Heltrukken strek under teksten (nøkkel)');
        underlineButton('dashed', 'Stiplet understrek', 'Stiplet strek under teksten (delnøkkel i en svak entitet)');
      }
      if (node.shape === 'class') tip('«--» på egen linje deler klassen i navn, felt og metoder.');
      tip('_tekst_ blir understreket (nøkkel, static), __tekst__ stiplet understreket (delnøkkel). *tekst* blir kursiv.');
      return;
    }

    tip('Velg en figur eller en linje for å endre den.');
  }

  const refresh = () => {
    for (const fn of refreshers) fn();
  };

  return {
    update() {
      const key = `${canvas.tool.id}:${canvas.selection?.kind ?? ''}:${canvas.selection?.id ?? ''}`;
      if (key !== shownFor) {
        shownFor = key;
        build();
      }
      refresh();
    },
  };
}
