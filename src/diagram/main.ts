/**
 * The drawing window: a separate little program in the same app. Opened by
 * the editor with `diagram.html?file=<path to .diagram.svg>`; saves on its own
 * (autosave) and tells the editor ("file-saved") so notes show the new picture.
 */
import '../theme.css';
import './diagram.css';
import { initAppearance } from '../appearance';
import { platform } from '../platform';
import { getSettings } from '../settings';
import { storage, type FileRef } from '../storage';
import { DiagramCanvas } from './canvas';
import { DIAGRAM_EXTENSION, exportSvg, parseDiagramSvg } from './fileFormat';
import { emptyDiagram, type Diagram } from './model';
import { renderProperties, type PropertiesBar } from './properties';
import { renderToolbar, type Toolbar } from './toolbar';

const el = (id: string) => document.getElementById(id)!;
const nameOf = (path: string) => path.split(/[\\/]/).pop() ?? path;

function showError(message: string): void {
  const box = document.createElement('div');
  box.className = 'dg-error';
  box.textContent = message;
  el('dg-canvas').replaceChildren(box);
}

async function start(): Promise<void> {
  initAppearance();
  const path = new URLSearchParams(location.search).get('file');
  let file: FileRef | null = null;
  let diagram: Diagram = emptyDiagram();

  if (path) {
    if (!storage.openPath) {
      showError('Tegninger fra disk kan bare åpnes i skrivebordsappen.');
      return;
    }
    try {
      const opened = await storage.openPath(path);
      const parsed = parseDiagramSvg(opened.content);
      if (!parsed) {
        // A picture made elsewhere: never overwrite it.
        showError(`«${nameOf(path)}» er ikke laget i tegneverktøyet, så den kan ikke redigeres her.`);
        return;
      }
      diagram = parsed;
      file = opened.file;
    } catch {
      // The file is gone: start empty and create it again on the first save.
      file = { name: nameOf(path), path };
    }
  }
  const title = () => platform.setWindowTitle(`${file ? file.name.replace(/\.diagram\.svg$/i, '') : 'Ny tegning'} – Tegning`);
  title();

  // --- Saving (automatic once there's a file) ---
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue = Promise.resolve();
  let toolbar!: Toolbar;
  let properties: PropertiesBar | undefined;

  const save = (): Promise<void> => {
    clearTimeout(timer);
    queue = queue.then(async () => {
      if (!dirty || !file || !storage.canSaveInPlace) return;
      dirty = false;
      toolbar.setStatus('Lagrer …');
      try {
        await storage.save(file, exportSvg(canvas.diagram));
        toolbar.setStatus('Lagret');
        if (file.path) platform.notify('file-saved', { path: file.path });
      } catch (err) {
        dirty = true;
        toolbar.setStatus('Kunne ikke lagre');
        console.error(err);
      }
    });
    return queue;
  };

  const saveAs = async () => {
    const ref = await storage.saveAs(exportSvg(canvas.diagram), `tegning.${DIAGRAM_EXTENSION}`);
    if (!ref) return;
    file = ref;
    dirty = false;
    title();
    toolbar.setStatus(storage.canSaveInPlace ? 'Lagret' : 'Lastet ned');
    toolbar.update();
  };

  const canvas = new DiagramCanvas(el('dg-canvas'), diagram, {
    onChange() {
      dirty = true;
      if (file && storage.canSaveInPlace) {
        toolbar.setStatus('Endret');
        clearTimeout(timer);
        timer = setTimeout(() => void save(), getSettings().diagram.autosaveDelayMs);
      } else {
        toolbar.setStatus('Ikke lagret');
      }
    },
    onStateChange: () => {
      toolbar?.update();
      properties?.update();
    },
    onSave: () => void (file && storage.canSaveInPlace ? save() : saveAs()),
  });

  toolbar = renderToolbar(el('dg-toolbar'), el('dg-hint'), canvas, {
    save: () => void saveAs(),
    canSaveAs: () => !(file && storage.canSaveInPlace),
  });
  properties = renderProperties(el('dg-props'), canvas);
  toolbar.setStatus(file ? 'Lagret' : 'Ikke lagret');
  toolbar.update();
  properties.update();

  platform.beforeClose(async () => {
    canvas.finishEditing(true);
    if (dirty) await save();
  });

  // Handy for debugging in the console during development.
  if (import.meta.env.DEV) Object.assign(window, { diagramCanvas: canvas });
}

void start();
