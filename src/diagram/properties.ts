/**
 * The properties panel on the right: one-click choices for what's
 * selected (line type, texts at the ends, double/dashed outline …), or for
 * new lines while the Pil tool is on. Everything is a button or a text field
 * – nothing needs precise pointing.
 */
import type { DiagramCanvas } from './canvas';
import { edgePresets, presetIcon, sameStyle } from './edges';
import { styleOf, type EdgeStyle } from './model';
import { toSvgString } from './svg';
import { newEdgeStyle, setNewEdgeStyle } from './tools/arrow';

export interface PropertiesBar {
  update(): void;
}

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

  const presetButtons = (current: () => EdgeStyle, choose: (style: EdgeStyle) => void) => {
    for (const preset of edgePresets) {
      button(preset.name, preset.title, () => choose(preset.style), () => sameStyle(current(), preset.style), toSvgString(presetIcon(preset.style)));
    }
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
      heading('Kant');
      button('Dobbel kant', 'To streker rundt (svak entitet, flerverdi-attributt …)', () => canvas.updateSelectedNode({ double: canvas.selectedNode?.double ? undefined : true }), () => !!canvas.selectedNode?.double);
      button('Stiplet kant', 'Stiplet strek (avledet attributt …)', () => canvas.updateSelectedNode({ dashed: canvas.selectedNode?.dashed ? undefined : true }), () => !!canvas.selectedNode?.dashed);
      if (node.shape === 'path') {
        heading('Strek');
        button('Glatt', 'Myk kurve gjennom punktene (av: rette streker)', () => canvas.updateSelectedNode({ smooth: canvas.selectedNode?.smooth === false ? undefined : false }), () => canvas.selectedNode?.smooth !== false);
        button('Lukket', 'Koble siste punkt tilbake til det første', () => canvas.updateSelectedNode({ closed: canvas.selectedNode?.closed ? undefined : true }), () => !!canvas.selectedNode?.closed);
      }
      if (node.shape === 'class') tip('«--» på egen linje deler klassen i navn, felt og metoder.');
      tip('_tekst_ blir understreket (nøkkel, static). *tekst* blir kursiv.');
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
