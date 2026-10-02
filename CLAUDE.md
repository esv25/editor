# Editor – prosjektnotater for Claude

## Formål

En personlig teksteditor, et mellomsteg mellom Word og VS Code. Dokumentene er ren
Markdown (`.md`/`.txt`), men editoren skal være behagelig å skrive i: live styling
à la Obsidian/Typora, knapper for vanlig formatering og litt «smart» oppførsel.
Den skreddersys til eierens behov over tid, så utvidbarhet går foran generalitet.
Den kjører både i nettleseren og som skrivebordsapp med **Tauri 2** (Windows).

UI-tekst er på norsk (bokmål). Kode, identifikatorer og kodekommentarer er på engelsk.

## Teknologi

- Vite + TypeScript (strict), ingen UI-rammeverk – vanlig DOM i `src/ui/`
- CodeMirror 6 som editorkjerne, `@codemirror/lang-markdown` (GFM) +
  `@codemirror/language-data` for språk i kodeblokker (lastes ved behov)
- Vitest for tester av kommandoer og regler (kjører i Node, uten DOM)
- Tauri 2 (`src-tauri/`) med pluginene `dialog` og `fs`; krever Rust + MSVC Build Tools

## Kommandoer

- `npm run dev` – utviklingsserver på http://localhost:5173 (tegnevinduet alene: /diagram.html)
- `npm test` – enhetstester
- `npm run typecheck` / `npm run build`
- `npm run app` – skrivebordsappen i utviklingsmodus (starter Vite selv; port 5173 må være ledig).
  Bruker `src-tauri/tauri.dev.conf.json`: egen identitet «Editor (dev)» (`com.eirik.editor.dev`),
  så den har egne faner/innstillinger og ikke kolliderer med den installerte appen
  (single-instance ville ellers sendt oppstarten videre til den installerte).
- `npm run app:build` – installasjonsfil lokalt (usignert, uten publisering)
- `npm run release` – publiserer en ny versjon som installerte apper oppdaterer seg til
  (se «Oppdateringer» under)

I dev-modus ligger `window.editorView` og `window.workspace` tilgjengelig for feilsøking
i nettleserkonsollen.

Feilsøking i skrivebordsappen: start med miljøvariabelen
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`; da kan webvisningen
styres via Chrome DevTools-protokollen (http://127.0.0.1:9223/json). Ikke drep prosesser
på port 5173 uten å sjekke at de er dine – brukeren kan ha `npm run app` gående. Rust-bygg
kjøres helst med `CARGO_BUILD_JOBS=2` og lav prioritet (`start /low`), ellers bråker viften.

## Arkitektur

```
src/
  main.ts                 inngangspunkt → app/app.ts
  settings.ts             innstillinger (standardverdier + brukerens overstyringer i localStorage)
  appearance.ts           tema og typografi → CSS-variabler / data-theme (delt med tegnevinduet)
  theme.css               fargevariabler for lyst/mørkt tema (delt med tegnevinduet)
  commands/registry.ts    kommandoregisteret (id, navn, ikon, hurtigtast, run, isActive)
  editor/
    createEditor.ts       én EditorView + én EditorState per dokument (Markdown eller kode)
    theme.ts              editortema og HighlightStyle (farger via CSS-variabler)
  code/
    languages.ts          filtyper: Markdown vs. kode, språk fra filendelse, språklasting
    fileTypes.ts          filendelsene som ren data (uten CodeMirror; brukes av storage)
    codeMode.ts           kode-modus: linjenumre, kjør hele filen, utdatapanel
  features/               én CodeMirror-funksjon per fil (se under)
    index.ts              listen over aktive features
    types.ts              Feature-grensesnittet
    util/markdown.ts      felles hjelpere (liste-parsing, valgte linjer, syntakstre)
    headingSuggestion/    overskriftsforslag: index.ts (extension) + rules.ts (heuristikk)
  storage/                fil-laget – ALL fil-I/O går hit
    types.ts              StorageBackend-grensesnittet + FileRef
    fsAccess.ts           File System Access API (Chrome/Edge)
    download.ts           reserve for andre nettlesere (input + nedlasting)
    tauri.ts              skrivebordsappen: native dialoger + plugin-fs (også bilder: readBinary)
    drafts.ts             gammelt enkeltdokument-utkast (leses bare for migrering)
    index.ts              velger backend
  platform/               det som ellers skiller nettleser og skrivebord
    types.ts              Platform: vindustittel, bekreftelsesdialog, lukking, oppstartsfil
    web.ts / tauri.ts     implementasjonene; index.ts velger (`isTauri`)
  app/
    app.ts                kobler sammen editor, arbeidsområde, UI og app-kommandoer
    workspace.ts          grupper (hovedfaner) og dokumenter (underfaner), bytte, åpne/lukke
    document.ts           EditorDocument: én fane – fil, tilstand, ulagret-status, autolagring
    session.ts            husker grupper og faner mellom oppstarter (localStorage)
    fileNames.ts          filnavn fra første linje (autolagring)
    welcome.ts            velkomsttekst første gang
  ui/                     faner (tabs.ts), verktøylinjer (toolbar.ts, codeBar.ts), filtre
                          (fileTree.ts), høyreklikkmeny, disposisjon, statuslinje, updates
  styles.css              editorens layout og klasser (fargene ligger i theme.css)
  diagram/                tegnevinduet – et eget lite program (se «Tegnevinduet» under)
diagram.html              inngangen til tegnevinduet (Vite bygger to sider: index + diagram)
tests/                    Vitest; helpers.ts har `run(command, "tekst med | markør")`
src-tauri/
  tauri.conf.json         vindu, bundling, .md-filtilknytning
  capabilities/default.json  tillatelser for `main` og `diagram-*` (fs-scope er `**` – det er en vanlig editor)
  src/lib.rs              Tauri-oppsett, single-instance (videresender «Åpne med» som
                          hendelsen `open-file`) + kommandoen `startup_file`
  src/runner.rs           kommandoen `run_program` (kjøring av kodeblokker)
  icons/                  generert fra app-icon.svg med `npx tauri icon src-tauri/app-icon.svg`
```

### Features (`src/features/`)

Hver funksjon er en egen fil som eksporterer et `Feature`-objekt:

```ts
export interface Feature {
  id: string;
  commands?: EditorCommand[];                    // registreres i kommandoregisteret
  extension?: (settings: Settings) => Extension; // bygges på nytt når innstillinger endres
}
```

For å legge til en funksjon: lag `src/features/<navn>.ts`, eksporter en `Feature`, og legg
den til i `src/features/index.ts`. Les innstillinger i `extension(settings)`, ikke ved
modul-lasting, ellers fanges ikke endringer opp.

Dagens features: `livePreview` (overskriftsstørrelser, skjuling av markeringstegn, inline
kode), `codeBlocks`, `codeBlockTools`, `images`, `headings`, `inlineFormat`, `lists`,
`taskList`, `smartLists`, `headingSuggestion`, `closeBrackets`.

### Bilder (`features/images/`)

- `![alt](sti)` vises som bilde i en blokk-widget *under* linja. Som kodeblokker vises
  Markdown-teksten aldri: et hode erstatter den alltid (bildetekst = alt-tekst, klikk for å
  redigere; uten alt-tekst vises filnavnet; knappene «Bytt bilde» og «Fjern»), og markøren
  hopper over hodet som én enhet (`atomicRanges`). Alt kommer fra én StateField
  (blokkdekorasjoner kan ikke komme fra en ViewPlugin). Med `hideMarkup: false` vises rå
  tekst. Bilder i kode tegnes ikke. Tekstendringene (`commands.ts`) er testet.
- Stier (`features/util/imagePath.ts`, testet i `tests/imagePath.test.ts`): relative stier
  regnes fra dokumentets mappe (`imageContext.baseDir`, satt i `app.ts`), `<…>` og `%20`
  forstås, `http(s):`/`data:` brukes direkte. Nye lenker skrives relativt med `/`.
- Filer leses via `storage.readBinary` (bare skrivebord; `fs:allow-read-file`) og caches
  som blob-URL-er i `loader.ts`. `reloadImages(view, stier)` leser filer på nytt (f.eks.
  når en tegning er lagret); `redrawImages(view)` når dokumentet har flyttet mappe.
- `image.insert` («Sett inn bilde», i verktøylinja) velger fil med `storage.pickFile`; i
  nettleseren settes `![]()` inn i stedet.

### Faner og dokumenter (`app/workspace.ts`, `app/document.ts`)

- Hovedfaner er brukerens egne **grupper**; hver har sine åpne dokumenter som underfaner.
- Det finnes **én** `EditorView`. Hvert dokument eier sin egen `EditorState`; bytte av fane
  er `view.setState(doc.state)`, så angrehistorikk og markør følger dokumentet. Mens et
  dokument er aktivt holder `Workspace.handleUpdate` `doc.state` oppdatert.
- `setState` går ikke gjennom update-lytteren: alt som viser dokumentet oppdateres via
  `workspace.onActiveChange`; faner/navn/lagrestatus via `workspace.onChange`.
- Innstillingsendringer rekonfigurerer bare den aktive tilstanden; andre dokumenter
  oppdateres når de aktiveres (`settingsVersion`).
- Økten (grupper, faner, markør, innhold for ulagrede/navnløse dokumenter) lagres i
  localStorage og gjenopprettes ved oppstart; filer med sti leses på nytt fra disk.
- Kommandoer har `scope`: `'markdown'` (standard), `'code'` eller `'any'` – keymapen for
  en tilstand bygges bare av kommandoene som gjelder dens type.
- En gruppe *kan* kobles til en mappe (`group.folder`, valgfritt). Da viser sidefeltet et
  filtre (`ui/fileTree.ts`, med undermapper som kan åpnes; skjuler punktfiler,
  `node_modules` og filtyper editoren ikke kan åpne), og nye dokumenter autolagres i
  mappa. Et dokument kan ha `targetFolder` (f.eks. en undermappe valgt i treet) som går
  foran gruppens mappe. Høyreklikk på gruppefanen/treet gir valgene (`ui/contextMenu.ts`).

### Tegnevinduet (`src/diagram/`, `diagram.html`)

Et eget program i samme app, for diagrammer (UML, ER, datastrukturer). Det deler bare
`settings`, `storage`, `platform`, `appearance`/`theme.css` med editoren – ingen
CodeMirror. Brukeren styrer med joystick-mus: **alt er klikk–klikk, ingenting krever å
dra** med knappen nede. Store knapper med tekst, raus treffmargin
(`settings.diagram.hitTolerance`, skjerm-px), alt snapper til rutenettet
(`settings.diagram.grid`), og hint-linja nederst sier alltid hva neste klikk gjør.

- Filformat (`fileFormat.ts`, testet i `tests/diagram.test.ts`): `.diagram.svg` er et vanlig
  SVG-bilde (vises i notater, nettlesere, GitHub) med tegningen som JSON i
  `<metadata id="editor-diagram">`. SVG uten den metadataen er ikke vår og skal **aldri**
  overskrives – vinduet nekter å åpne den. Lagret bilde har faste farger (papir), ikke tema.
- `model.ts`: ren data (`Diagram` = nodes + edges) og rene funksjoner som gir ny `Diagram`
  (addNode, connect, addNeighbor, nodeAt med toleranse …). `history.ts` angrer med
  øyeblikksbilder. `svg.ts`: `SvgNode`-tre → DOM (lerretet) eller tekst (fila), så det man
  ser er det som lagres. `render.ts`: diagram → SvgNode (piler ender på figurenes omriss).
- Figurtyper (`shapes/`, én fil per type: box, ellipse, diamond, text): `render` +
  `boundary` (hvor en pil treffer omrisset). Ny type = ny fil + linje i `shapes/index.ts`;
  den får verktøyknapp automatisk.
- Verktøy (`tools/`, én fil per verktøy, `Tool`-grensesnittet i `tools/types.ts`): Velg
  (klikk = velg, klikk igjen = løft opp, klikk = sett ned; hjørnehåndtaket likt for
  størrelse), ett plasseringsverktøy per figurtype (gjennomsiktig «spøkelse» følger pekeren),
  Pil (klikk fra, klikk til; pilene kjedes, klikk på tomt sted lager ny boks). Høyreklikk =
  Esc.
- `canvas.ts` (`DiagramCanvas`): tegner, zoom/panorering (viewBox), tastatur (Ctrl+pil = ny
  tilkoblet figur, piltaster flytter, Enter skriver tekst, Delete, Ctrl+Z/Y), tekstfelt
  over figuren (figuren vokser så teksten får plass).
- `main.ts`: åpner `?file=`-stien, autolagrer (`settings.diagram.autosaveDelayMs`), og sier
  fra med `platform.notify('file-saved', { path })`. Uten fil (nettleseren): «Lagre som».
- Editoren: `diagram.new` («Ny tegning») lager `figurer/tegning.diagram.svg` ved notatet,
  setter inn bildet og åpner vinduet; bildehodet får «Rediger tegning», og dobbeltklikk på
  tegningen åpner den (`imageContext.openDrawing`, satt i `app.ts`). Ved `file-saved`
  kaller `app.ts` `reloadImages`. Bildecachen sammenligner stier uten å bry seg om store
  bokstaver og `/` vs `\`.

### Kodefiler (`code/`)

- Filer som ikke er .md/.txt åpnes i kode-modus (`createCodeState`): linjenumre,
  språkhighlighting (lastes ved behov), ingen Markdown-features.
- `code.run` (Ctrl+Shift+Enter / ▶ Kjør i `ui/codeBar.ts`) kjører hele filen med samme
  maskineri som kodeblokker; utdata vises i et panel nederst (`showPanel`).
- «Lagre som» med annen filendelse gjør om dokumentet mellom Markdown og kode.
- Innrykk (`code/indentation.ts`): kodefiler får `indentUnit` fra filens eget innrykk
  (`detectIndent`), ellers språkets vanlige (4; 2 for JS/TS/JSON/HTML/CSS/YAML; tab for
  Go). Tab er som i VS Code (`insertIndent`: mellomrom til neste tabulatorstopp ved
  markøren, eller rykk inn markerte linjer). Notater har `indentUnit` 4 for kodeblokkene;
  Tab i kodeblokk = `insertIndent`, i vanlig tekst flyttes linja 2 mellomrom, og
  listekommandoene gjelder ikke inni kodeblokker. Testet i `tests/indentation.test.ts`.

### Kodeblokker: navn, språk og kjøring (`features/codeBlockTools/`)

- Navn og språk står i fence-linja: ` ```python title="navn.py" `. Parsing i
  `features/util/fence.ts` (ren tekst, testet i `tests/fence.test.ts`).
- `header.ts`: hode på åpningslinja (navn, språkmeny, ▶ Kjør). Hodet erstatter *alltid*
  rå-teksten, og lukke-``` skjules (linja krymper til blokkens nederste kant), så blokken
  aldri endrer form. Navnet redigeres i et eget `<input>`, språket i menyen; endringer
  skrives tilbake med `rewriteFence()`.
- Bakgrunner på linjer (kode, inline kode) må være halvgjennomsiktige: CodeMirror tegner
  markeringen *bak* teksten, så en ugjennomsiktig linjebakgrunn skjuler den.
- `run.ts`: skrivebord → `platform.runProgram` (Rust-kommandoen `run_program` i
  `src-tauri/src/runner.rs`: skriver koden til en temp-fil, kjører programmet med
  tidsgrense og uten konsollvindu). Nettleser → JavaScript i en Web Worker. HTML vises
  som forhåndsvisning i en sandkasset iframe.
- `runners.ts`: språk → program (python, node, powershell, Git Bash, java). Kan
  overstyres/utvides via `settings.codeRunners`. Kjøring skjer i dokumentets mappe.
- `output.ts`: utdata ligger i en StateField (ikke i teksten), følger blokken og
  forsvinner når blokken slettes.

### Autolagring

`EditorDocument` autolagrer dokumenter som har en fil. Nye dokumenter får på
skrivebordet automatisk en fil i `Dokumenter\Editor` (eller `settings.autosave.folder`)
via `storage.createNew`, med navn fra første overskrift/linje (`app/fileNames.ts`).
I nettleseren tas nye dokumenter vare på som utkast til de lagres med Ctrl+S.

### Kommandoregisteret

Alle brukerhandlinger er kommandoer i `commands/registry.ts`. Knapper
(`ui/toolbar.ts` → `renderButtons(container, ids)`) og hurtigtaster
(`commandKeymap()`) slår opp i registeret, så en ny kommando legges til ett sted.

- `key` er standard hurtigtast i CodeMirror-notasjon (`Mod-Shift-7`); brukeren kan
  overstyre via `settings.keybindings[id]` (null = ingen hurtigtast).
- `isActive(state)` gir aktiv-markering på knappen.
- Hvilke knapper verktøylinja viser styres av `settings.toolbar` (`'|'` = skillelinje).
- App-kommandoer (fil, visning) registreres i `app/app.ts` før editoren lages.

Standard hurtigtaster: Ctrl+Shift+1/2/3 overskrift, Ctrl+B/I fet/kursiv, Ctrl+E inline
kode, Ctrl+Shift+8/7/9 punkt-/nummerert/huskeliste, Ctrl+Shift+E kodeblokk,
Ctrl+Enter kryss av oppgave, Ctrl+Shift+Enter kjør kodeblokk/fil, Ctrl+Shift+H gjør til
overskrift, Ctrl+N nytt dokument, Ctrl+O/S/Shift+S fil, Ctrl+W lukk fane, Ctrl+Tab /
Ctrl+PageDown neste fane, Ctrl+Shift+N ny gruppe, Ctrl+Shift+O disposisjon.
**Unngå Ctrl+Alt-kombinasjoner**: på norsk tastatur er Ctrl+Alt = AltGr (@, {, [ osv.).

### Kommandoer som `StateCommand`

Tekstendrende kommandoer skrives som CodeMirror `StateCommand` (`({state, dispatch}) =>
boolean`) så de kan testes uten DOM. Bruk `applyChanges()` fra `util/markdown.ts` for
linjeprefiks-endringer – den holder markøren etter innsatt markering.
Kommandoer bør bruke syntakstreet (`findEnclosing`, `blockTypeAt`) framfor regex når
det gjelder inline-formatering, så de takler nøstede og uvanlige tilfeller.

### Lagring og plattform

Resten av appen snakker kun med `storage` (et `StorageBackend`) og ser bare `FileRef`
(ugjennomsiktig; backenden legger på handle/sti). `storage/index.ts` velger Tauri →
File System Access API → nedlasting. Autolagring er bare på når backenden har
`canSaveInPlace` og dokumentet har en fil.

Vinduer: `platform.openWindow(side, parametre, { key })` åpner et nytt vindu (skrivebord;
fokuserer det som allerede er åpent for samme `key`, label `diagram-…`) eller en ny fane
(nettleser). `platform.notify`/`listen` sender hendelser mellom vinduene (Tauri-events /
BroadcastChannel). `platform.beforeClose(flush)` lar tegnevinduet lagre før det lukkes.

Annet som varierer (vindustittel, ja/nei-dialog, advarsel ved lukking, fil fra
kommandolinja) går gjennom `platform` – bruk aldri `window.confirm`/`document.title`
direkte. Nye Tauri-API-kall krever ofte en tillatelse i `capabilities/default.json`.

### Oppdateringer (`ui/updates.ts`, `scripts/release.mjs`)

- Repoet er offentlig på https://github.com/esv25/editor. Appen bruker Tauri-updateren
  og sjekker `releases/latest/download/latest.json` ved oppstart (bare i bygget app),
  og når man klikker versjonsnummeret i statuslinja.
- Oppdateringer er signert. Privatnøkkelen ligger i `~/.tauri/editor.key` (utenfor repoet,
  skal **aldri** committes); den offentlige nøkkelen står i `tauri.conf.json`. Mistes
  privatnøkkelen, kan ikke installerte apper oppdateres lenger – da må en ny versjon
  installeres manuelt.
- `npm run release [patch|minor|major|x.y.z] [--notes "…"]`: øker versjonen i
  package.json, tauri.conf.json og Cargo.toml, kjører typesjekk og tester, bygger og
  signerer (lav prioritet), skriver `latest.json`, committer «Versjon x.y.z», tagger,
  pusher og lager GitHub-release med installasjonsfil + `latest.json`. Krever ren
  arbeidsmappe. Publisering er utadrettet – kjør det bare når brukeren ber om det.

### Innstillinger

`settings.ts`: `getSettings()`, `updateSettings(patch)` (dyp fletting), `onSettingsChange`.
Kun overstyringer lagres, så endrede standardverdier slår gjennom. Editor-extensions
bygges på nytt via en Compartment når innstillinger endres. Det finnes ennå ingen
innstillings-UI; endre via konsollen eller standardverdiene.

## Konvensjoner

- Én funksjon per fil under `src/features/`; hold dem uavhengige av hverandre (delte
  hjelpere i `util/`).
- Teksten er kilden til sannhet: dekorasjoner og widgets endrer aldri dokumentet av seg
  selv; bare eksplisitte brukerhandlinger gjør det.
- Markdown som skrives skal være gyldig CommonMark/GFM (f.eks. nøsting av listepunkter
  følger forelderens innholdskolonne).
- Farger kun via CSS-variabler i `styles.css` (både lyst og mørkt tema).
- Legg til tester i `tests/` for nye tekstendrende kommandoer og heuristikker.
- Kjør `npm run typecheck` og `npm test` før du sier at noe er ferdig, og sjekk UI-endringer
  i nettleseren.
