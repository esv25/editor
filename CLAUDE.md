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
  `@codemirror/language-data` for språk i kodeblokker (lastes ved behov), `@codemirror/lint` for
  Kodehjelp-strekene (analysen er egen kode i `src/code/assist/`)
- KaTeX (+ mhchem) tegner formler – det eneste biblioteket i matte-delen; selve
  formelredigeringen er egen kode (`src/features/math/`)
- Vitest for tester av kommandoer og regler (kjører i Node, uten DOM)
- Tauri 2 (`src-tauri/`) med pluginene `dialog` og `fs`; krever Rust + MSVC Build Tools
- xterm.js (terminalvisning) og portable-pty (pseudokonsoll i Rust)

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
  commands/keys.ts        tastetrykk ⇄ CodeMirror-notasjon, tastesekvenser (Ctrl+M, F), opptak,
                          og app-hurtigtaster utenfor editoren (terminal, sidefelt)
  editor/
    createEditor.ts       én EditorView + én EditorState per dokument (Markdown eller kode)
    theme.ts              editortema og HighlightStyle (farger via CSS-variabler)
    undo.ts               angrehistorikk som i Word (alt skrevet i ett strekk = ett steg, også
                          Enter; nytt steg ved markørflytting, sletting, kommandoer) + edit.undo/redo
  code/
    languages.ts          filtyper: Markdown vs. kode, språk fra filendelse, språklasting
    fileTypes.ts          filendelsene som ren data (uten CodeMirror; brukes av storage)
    codeMode.ts           kode-modus: linjenumre, kjør hele filen, utdatapanel
    assist/               «Kodehjelp»: feil, ubrukt kode, forslag, visuelle hjelpere (se under)
  terminal/
    terminalPanel.ts      terminalpanelet under editoren (xterm.js, faner, kjør program i fane)
  debug/                  feilsøker (se «Terminal og feilsøking» under)
    types.ts              DebugBackend-grensesnittet (DAP-formet) + datatyper
    controller.ts         DebugController: økt, stopp, kallstakk, variabler, uttrykk, fremhevede
    history.ts            tilbakeblikk (Snapshot per stopp, hva som er endret) og fremhevede
                          variabler – ren logikk
    breakpoints.ts        stoppunkter og pauselinje (StateField + gutter)
    inlineValues.ts       fremhevede variabler i koden: verdier ved pauselinja, farget der de står
    debuggers.ts          språk → feilsøker (standard + settings.debuggers)
    dap.ts                DAP-klient + backend (debugpy for Python)
    node.ts               Node-backend over Chrome DevTools Protocol (JS/TS)
  features/               én CodeMirror-funksjon per fil (se under)
    index.ts              listen over aktive features
    types.ts              Feature-grensesnittet
    util/markdown.ts      felles hjelpere (liste-parsing, valgte linjer, syntakstre)
    headingSuggestion/    overskriftsforslag: index.ts (extension) + rules.ts (heuristikk)
    math/                 formler: $…$ og $$…$$ med WYSIWYG-redigering (se «Matte» under)
  export/                 PDF, Word og utskrift (se «Eksport» under)
  storage/                fil-laget – ALL fil-I/O går hit
    types.ts              StorageBackend-grensesnittet + FileRef
    fsAccess.ts           File System Access API (Chrome/Edge)
    download.ts           reserve for andre nettlesere (input + nedlasting)
    tauri.ts              skrivebordsappen: native dialoger + plugin-fs (også bilder: readBinary)
    drafts.ts             gammelt enkeltdokument-utkast (leses bare for migrering)
    backupRules.ts        sikkerhetskopi før overskriving: navn og opprydding (ren logikk)
    index.ts              velger backend
  platform/               det som ellers skiller nettleser og skrivebord
    types.ts              Platform: vindustittel, bekreftelsesdialog, lukking, oppstartsfil,
                          `processes` (terminaler og feilsøkere, bare skrivebord)
    web.ts / tauri.ts     implementasjonene; index.ts velger (`isTauri`)
  app/
    app.ts                kobler sammen editor, arbeidsområde, UI og app-kommandoer
    workspace.ts          grupper (hovedfaner) og dokumenter (underfaner), bytte, åpne/lukke
    document.ts           EditorDocument: én fane – fil, tilstand, ulagret-status, autolagring
    session.ts            husker grupper og faner mellom oppstarter (localStorage)
    fileNames.ts          filnavn fra første linje (autolagring)
    welcome.ts            velkomsttekst første gang
    changelog.ts          CHANGELOG.md → versjoner, hva som vises etter en oppdatering
  ui/                     faner (tabs.ts), verktøylinjer (toolbar.ts, codeBar.ts), filtre
                          (fileTree.ts), høyreklikkmeny, disposisjon, statuslinje, updates,
                          «Hva er nytt» (whatsNew.ts),
                          feilsøkingsvisningen i sidefeltet (debugPanel.ts), mattepanelet
                          (mathPanel.ts), hurtigtast-dialogene (keybindings.ts for alle
                          kommandoer, mathShortcuts.ts for matte), Kodehjelp-dialogen
                          (codeHelp.ts) og modal.ts
  styles.css              editorens layout og klasser (fargene ligger i theme.css)
  diagram/                tegnevinduet – et eget lite program (se «Tegnevinduet» under)
diagram.html              inngangen til tegnevinduet (Vite bygger to sider: index + diagram)
tests/                    Vitest; helpers.ts har `run(command, "tekst med | markør")`
src-tauri/
  tauri.conf.json         vindu, bundling, .md-filtilknytning
  capabilities/default.json  tillatelser for `main` og `diagram-*` (fs-scope er `**` – det er en vanlig editor –
                          men `fs:scope` sperrer mapper med hemmeligheter, se «Sikkerhet»)
  src/lib.rs              Tauri-oppsett, single-instance (videresender «Åpne med» som
                          hendelsen `open-file`) + kommandoen `startup_file`
  src/runner.rs           kommandoen `run_program` (kjøring av kodeblokker)
  src/terminal.rs         terminaler i pseudokonsoll (portable-pty/ConPTY), utdata via Channel
  src/pdf.rs              kommandoen `print_to_pdf` (WebView2 PrintToPdf, A4)
  src/debug.rs            DAP-adaptere over stdin/stdout (rammer meldinger), ledig port,
                          WebSocket-adressen til Node sin inspector
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
`taskList`, `smartLists`, `headingSuggestion`, `closeBrackets`, `math`, `tables`.

### Matte (`features/math/`)

Målet: skrive all skolematte (1. klasse → R2, pluss kjemi) effektivt, også med motoriske
vansker – tastatur først, store klikkflater, ingen dra-bevegelser. Formlene er LaTeX i
Markdown (`$…$`, `$$` på egne linjer), så filene virker i Obsidian/Typora/GitHub/pandoc.

- `syntax.ts`: lezer-utvidelse (InlineMath, BlockMath, MathMark), lagt til i `markdown()` i
  `createEditor.ts` og `tests/helpers.ts`. Uavsluttet `$$`-blokk vises som tekst.
- `model.ts`: formeltreet – rader (`Row`) med noder (sym, cmd, scripts, group, text, env,
  ph, raw …). Potens/indeks er egen node etter grunntallet (som MathQuill).
- `latex.ts`: `parseLatex`/`toLatex`. Ukjent LaTeX blir `Raw` og bevares uendret.
  Skriver ryddig LaTeX (`{,}` for desimalkomma, `\left…\right` bare der det trengs,
  flere linjer → `aligned` med `&` foran første relasjon). Med `marks` pakkes hver node i
  `\htmlData` så feltet kan finne den igjen i tegningen; noder med potens pakkes ikke (da
  plasserer TeX potensen likt som i ferdig formel) – en tom markør står foran dem.
- `editor.ts`: `MathEditor` – all oppførsel uten DOM (testet): `/` brøk av leddet foran,
  `^`/`**` potens, parenteser i par, `"` tekst, `\` kommando, mellomrom «videre»,
  Tab neste tomme felt, Backspace går inn i strukturer og pakker dem ut, forkortelser
  (`sqrt`, `pi`, `<=` …; lengste treff vinner, Backspace rett etter angrer), maler med
  `#?` (tomt felt), `#0` (markeringen), `#@` (markering eller leddet foran).
- `field.ts`: `MathField` – tegner med KaTeX, egen markør, skjult textarea for inndata
  (døde taster som `^` på norsk tastatur; `ê` tolkes som `^e`), klikk → nærmeste symbol.
- `index.ts`: CodeMirror-koblingen. Ferdige formler er widgets; den som redigeres holdes i
  en StateField (`activeField`) og feltet skriver hver endring til dokumentet (angre,
  autolagring og ordtelling virker som ellers; `syncField` laster på nytt ved angre).
  Inn med klikk, piltaster, Backspace/Delete; Ctrl+M / Ctrl+Shift+M lager nye.
- `catalog.ts`: alt i mattepanelet (`ui/mathPanel.ts`; vises mens en formel redigeres, eller
  alltid med Σ – `math.paletteAuto`/`math.palette`), ordnet etter tema (LK20). `shortcuts.ts`: innebygde
  forkortelser. `render.ts`: KaTeX-tegning (cache).
- Egne hurtigtaster (`settings.math.keys`: tast/sekvens → LaTeX-mal, `settings.math.shortcuts`:
  forkortelse → mal) lages i dialogen (høyreklikk i panelet / «Hurtigtaster»), der malen
  bygges i et formelfelt. De går foran alt annet, også inne i formler.

### Bilder (`features/images/`)

- `![alt](sti)` vises som bilde i en blokk-widget *under* linja. Som kodeblokker vises
  Markdown-teksten aldri: et hode erstatter den alltid (bildetekst = alt-tekst, klikk for å
  redigere; uten alt-tekst vises filnavnet; knappene «Bytt bilde» og «Fjern»), og markøren
  hopper over hodet som én enhet (`atomicRanges`). Alt kommer fra én StateField
  (blokkdekorasjoner kan ikke komme fra en ViewPlugin). Med `hideMarkup: false` vises rå
  tekst. Bilder i kode tegnes ikke. Tekstendringene (`commands.ts`) er testet.
- Stier (`features/util/imagePath.ts`, testet i `tests/imagePath.test.ts`): relative stier
  regnes fra dokumentets mappe (`imageContext.baseDir`, satt i `app.ts`), `<…>` og `%20`
  forstås, `data:` brukes direkte. `http(s):`-bilder hentes ikke før brukeren trykker «Vis bildet»
  eller har lagt nettstedet i `settings.security.imageHosts` («Alltid fra …»); de hentes uten
  referrer. Nye lenker skrives relativt med `/`.
- Filer leses via `storage.readBinary` (bare skrivebord; `fs:allow-read-file`) og caches
  som blob-URL-er i `loader.ts`. `reloadImages(view, stier)` leser filer på nytt (f.eks.
  når en tegning er lagret); `redrawImages(view)` når dokumentet har flyttet mappe.
- `image.insert` («Sett inn bilde», i verktøylinja) velger fil med `storage.pickFile`; i
  nettleseren settes `![]()` inn i stedet.

### Tabeller (`features/tables/`)

- GFM-tabeller. `model.ts` (ren logikk): linjer ⇄ `Table` (celletekster, justering), `formatTable`
  (rette kolonner, `| --- |`), celle ved kolonne, og redigeringene (rad/kolonne inn/ut/flytt, Tab,
  Enter). `commands.ts`: `StateCommand`-er som finner tabellen via syntakstreet (`tableAt`; ikke i
  sitater) og skriver hele tabellen pent tilbake. Testet i `tests/tables.test.ts` (der er `¦`
  markøren, siden tabeller er fulle av `|`).
- `index.ts`: med `hideMarkup` er tabellen *alltid* en blokk-widget, og hver celle er et
  `contenteditable`-felt (som i Word – rå Markdown for hele tabellen ble for rotete). Feltet viser
  bare cellens egen Markdown mens det redigeres; hvert tegn skrives til dokumentet med en gang
  (minimal endring, så angring grupperes som vanlig skriving), og `updateDOM` tegner de andre
  cellene på nytt uten å ta fokus fra feltet. Editorens markør følges med cellen, så kommandoene
  (meny, verktøylinje) virker. Transaksjoner med `tableFocus` flytter fokus til cellen markøren
  står i; Tab/Enter/piltaster/Ctrl+Z i cellen går via kommandoene. CodeMirror ser ikke tastene fra
  widgeten, så app-kommandoer (`commandsForKey`) videresendes, og Ctrl+B/I/E pakker inn i cellen.
  Uten `hideMarkup` er tabellen Markdown med monospace-linjer, og Tab/Enter virker der.
- Formler (`formula.ts`, ren logikk, testet i `tests/tableFormula.test.ts`): celle som starter med
  `=`, adresser A1 (overskriften er rad 1), områder `B2:B4`, + − × ÷ ^ %, sammenligninger, `&`, og
  funksjoner med norske og engelske navn (`SUMMER`/`SUM` …). Lagres som `svar <!-- =formel -->`, så
  andre programmer viser svaret. Svarene skrives når tabellen skrives tilbake (`settled` i
  `commands.ts`: Tab, Enter, meny, når man forlater tabellen), og tegnes live i widgeten
  (`computeTable`). Rad/kolonne inn/ut/flytt flytter adressene (`remapRows`, som i regneark).
  Egen kode – ingenting er hentet fra andre programmer, bare den vanlige formelskrivemåten.

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
CodeMirror. Brukeren styrer med joystick-mus. Flytting og størrelse er vanlig **dra og
slipp** (brukeren ville ha det slik – ikke erstatt vanlige grep med alternativer uten å
spørre), med terskel (`settings.diagram.dragThreshold`, skjerm-px) så et skjelvende klikk
ikke flytter noe. Streker/piler/frihånd er klikk–klikk. Store knapper med tekst, raus treffmargin
(`settings.diagram.hitTolerance`, skjerm-px), alt snapper til rutenettet
(`settings.diagram.grid`), og hint-linja nederst sier alltid hva neste klikk gjør.

- Filformat (`fileFormat.ts`, testet i `tests/diagram.test.ts`): `.diagram.svg` er et vanlig
  SVG-bilde (vises i notater, nettlesere, GitHub) med tegningen som JSON i
  `<metadata id="editor-diagram">`. SVG uten den metadataen er ikke vår og skal **aldri**
  overskrives – vinduet nekter å åpne den. Lagret bilde har faste farger (papir), ikke tema.
- `model.ts`: ren data (`Diagram` = nodes + edges) og rene funksjoner som gir ny `Diagram`
  (addNode, connect, updateEdge, reverseEdge, addNeighbor, nodeAt med toleranse …). Noder kan
  ha `double`/`dashed` kant; frihånd har `points` som brøkdeler av boksen (så flytting og
  størrelse virker som for andre figurer). Linjer har `head`/`tail` (`EndKind`), `dashed`, `double`
  (to parallelle streker; ikke del av forhåndsvalgene, men en egen bryter som beholdes ved typebytte),
  `route` (hjørner: `'hv'` sidelengs først, `'vh'` opp/ned først, ingen = rett; også på Strek med to punkter)
  og tekst `label`/`fromLabel`/`toLabel`. `routing.ts`: veien en linje tar (`routeBetween` for figurer –
  ett hjørne når de står på skrå, ellers ut–sving midt i mellomrommet–inn; `cornerPath` for Strek, som først går `STUB` rett ut av figuren der en ende sitter fast – retningen
  ligger i `AnchorRef.out`) og
  polylinjehjelpere; `edgePoints` i `render.ts` gir punktene fra omriss til omriss. `normalizeDiagram` tar bare med gyldige felt.
  `history.ts` angrer med øyeblikksbilder. `svg.ts`: `SvgNode`-tre → DOM (lerretet) eller
  tekst (fila), så det man ser er det som lagres. `render.ts`: diagram → SvgNode.
- `attach.ts`: strekender som sitter fast. En åpen frihånd/Strek har `startAt`/`endAt` (`AnchorRef`: figur-id +
  indeks i `ShapeType.anchors`). `settleAnchors(før, etter)` kjøres i `canvas.commit` og på forhåndsvisningen:
  streker som selv ble tegnet/flyttet hektes fast der endene står på et punkt (figurer foran streker), deretter
  følger alle faste ender figuren sin (`followAnchors`, også i kjede). `removeNodes` løsner ender på slettede figurer.
- `align.ts`: på linje. `alignMove`/`alignResize` hekter kant eller midte på andre figurers innenfor
  `settings.diagram.alignTolerance` (skjerm-px, 0 = bare rutenett), ellers rutenettet; `guidesFor` gir
  hjelpelinjene (Velg og plasseringsverktøyene viser dem). Åpne streker teller ikke.
- `edges.ts`: tegning av linjer (pilspiss, åpen pil, tom trekant, rute/fylt rute, stiplet,
  tekst ved endene og midt på) og `edgePresets` – ettklikksvalgene Pil, Linje, Arv,
  Implementerer, Avhengighet, Aggregering, Komposisjon.
- Figurtyper (`shapes/`, én fil per type: box, ellipse, diamond, umlClass, text, path):
  `render` + `boundary` (hvor en linje treffer omrisset), valgfritt `fit` (størrelsen teksten
  trenger), `distance` (klikk nær figuren; frihånd: nær streken), `multiline`/`placeholder`
  for tekstfeltet, `ownTool` (frihånd har eget verktøy). Ny type = ny fil + linje i
  `shapes/index.ts`; den får verktøyknapp automatisk. Tekstmarkering per linje
  (`styledLine`): `_tekst_` understreket (ER-nøkkel, static), `__tekst__` stiplet
  understreket (delnøkkel), `*tekst*` kursiv; understreker tegnes som egne `<line>`-er (`textBlock`),
  og knappene «Understrek»/«Stiplet understrek» setter markeringen på alle linjer.
  UML-klasse: én tekst der linjer med `--` deler i navn/felt/metoder (`classSections`).
  ER (Chen): entitet = boks, attributt = ellipse, relasjon = rombe, Linje + kardinalitet.
- Verktøy (`tools/`, én fil per verktøy, `Tool`-grensesnittet i `tools/types.ts`;
  `pointerDown`/`pointerMove`/`pointerUp`, lerretet fanger pekeren mens knappen er nede):
  Velg (klikk = velg, dra = flytt, dra hjørnehåndtaket = størrelse, dra tomt sted = flytt
  visningen via `ctx.panBy`, Esc under dra = avbryt; Shift/Ctrl+klikk legger til/tar bort, Shift+dra
  tomt sted = marker område), Marker (samme kode, `makeSelectTool` i `select.ts`: hvert klikk legger
  til/tar bort, dra tomt sted = marker alt rektangelet berører). Utvalget er en liste
  (`ctx.selection: Selection[]`); dra en valgt figur, piltaster og Delete gjelder alle, mens tekst,
  panelet og hjørnehåndtaket bare gjelder én (`canvas.single`). Ctrl+A velger alt.
  Ett plasseringsverktøy per figurtype (gjennomsiktig «spøkelse» følger pekeren),
  Strek (klikk start, klikk slutt → rett strek/pil hvor som helst; en frihåndsfigur med to
  punkter og `head`/`tail`; endene hekter seg på figurers hjørner/midtpunkter og andre
  streker via `ctx.snapPoint` og `ShapeType.anchors`, ellers et halvt rutenett), Frihånd (klikk punkter → glatt kurve; klikk første punkt = lukket; Enter/Esc = ferdig),
  Pil (klikk fra, klikk til; linjene kjedes, klikk på tomt sted lager ny figur; nye linjer
  får typen valgt i panelet). Høyreklikk = Esc.
- `properties.ts`: panelet til høyre (fast bredde, så lerretet aldri flytter seg): linjetype,
  Snu og tekst ved start/midt/slutt for en valgt linje; Skriv tekst, Dobbel/Stiplet kant
  (og Glatt/Lukket for frihånd) for en figur; type for nye linjer når Pil er på.
- `canvas.ts` (`DiagramCanvas`): tegner, zoom/panorering (viewBox; hjul, midtknapp-dra, piltaster
  uten valgt figur, «Vis alt»/Home = `zoomToFit`). Mens noe er halvferdig (`Tool.busy`: figur som
  dras, strek/pil/frihånd mellom klikkene) ruller visningen når pekeren hviler ved kanten
  (`startEdgeScroll`, kort forsinkelse). Tastatur (Ctrl+pil = ny
  tilkoblet figur, piltaster flytter valgt figur, Enter skriver tekst, Delete, Ctrl+Z/Y), tekstfelt
  over figuren eller midt på linja (figuren vokser så teksten får plass). I tekstfeltet
  beholder Esc det som er skrevet (Ctrl+Z angrer); i klasser er Enter ny linje og
  Ctrl+Enter/Esc ferdig.
- `main.ts`: åpner `?file=`-stien, autolagrer (`settings.diagram.autosaveDelayMs`), og sier
  fra med `platform.notify('file-saved', { path })`. Uten fil (nettleseren): «Lagre som».
- Editoren: `diagram.new` («Ny tegning») lager `figurer/tegning.diagram.svg` ved notatet,
  setter inn bildet og åpner vinduet; bildehodet får «Rediger tegning», og dobbeltklikk på
  tegningen åpner den (`imageContext.openDrawing`, satt i `app.ts`). Ved `file-saved`
  kaller `app.ts` `reloadImages`. Bildecachen sammenligner stier uten å bry seg om store
  bokstaver og `/` vs `\`.

### Eksport (`export/`)

Knappen ved Lagre (`file.export`) åpner en meny: `file.exportPdf`, `file.openInWord`, `file.print` (Ctrl+P).
Alt unntatt `index.ts` er ren logikk (testet i `tests/export.test.ts`).

- `document.ts`: Markdown → en liten dokumentmodell (`Block`/`Inline`) med samme Lezer-grammatikk som
  editoren (GFM + matte), uten kodespråk. Rå HTML blir tekst. En kodefil blir én kodeblokk.
- `html.ts`: modell → HTML for PDF/utskrift (tekst escapet, formler med KaTeX). `index.ts` legger den i
  `#print-root`, som `@media print` i `styles.css` viser i stedet for appen (faste papirfarger).
  Skrivebord: `platform.printToPdf` (Rust `print_to_pdf`, ingen dialog). Nettleser: utskriftsdialogen.
- `docx.ts`: modell → .docx skrevet for hånd (stiler, nummerering, tabeller, bilder som PNG/JPEG/GIF –
  SVG-tegninger rastreres i `index.ts`), pakket med `zip.ts` (lagret, ukomprimert).
- `omml.ts`: formler → ekte Word-formler (OMML): KaTeX skriver MathML, som oversettes (brøk, potens,
  rot, ∑/∫ som n-ær med resten fram til en relasjon som kropp, parenteser, aksenter, matriser, `aligned`
  → `eqArr` med `&`, funksjoner som `sin x`, mhchem-indekser hektet på grunnstoffet). `xml.ts` leser MathML uten DOM.
- Skrivebord: «Åpne i Word» spør hvor fila skal lagres (`storage.pickSavePath`/`writeBinary`) og åpner den
  med `platform.openPath` (opener-tillatelsen gjelder bare `.docx`/`.pdf`). Nettleser: nedlasting.
- Lagrede filer meldes til `ExportHost.saved` (i `app.ts`): en boble under knappen (`ui/savedBubble.ts`,
  som nedlastinger i Chrome: Åpne / Vis i mappen, lukker seg selv) og «Nylig lagret» i eksportmenyen.

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
  listekommandoene gjelder ikke inni kodeblokker. Innrykksnivåer (`indentLevels`,
  `activeIndentBlock` – blokka markøren står i, farget innrykkslinje; `describeIndent` i
  statuslinja) ligger også her, og `blockHeaders`/`stickyHeaders`: linjene som åpner blokkene over
  første synlige linje (kommentarer teller ikke; `):` står for linja parentesen åpnet på), som
  `code/stickyScroll.ts` holder fast øverst (Kodehjelp-funksjonen `stickyScroll`). Testet i
  `tests/indentation.test.ts`.

### Kodehjelp (`code/assist/`)

VS Code-lignende skrivestøtte i kodefiler, uten språkserver: egen analyse av Lezer-syntakstreet.
Alt unntatt `index.ts` er ren logikk uten CodeMirror (testet i `tests/codeAssist.test.ts`).

- `levels.ts`: nivåene (Av / Litt / Standard / Mye) og funksjonene (`CodeHelpFeature`).
  `settings.codeHelp = { level, overrides }`; en override (`true`/`false`) går foran nivået,
  `null` = følg nivået. `activeFeatures()` gir det som er på. Ny funksjon = linje i `featureInfo`.
- `python.ts` / `javascript.ts`: scopes, bindinger og referanser (pyflakes / ESLint-aktig).
  Python: tilordning gjør navnet lokalt, `global`/`nonlocal`, klassekropper er usynlige for
  metoder, comprehensions har eget scope. JS: `var` → funksjonen, let/const/class → blokka,
  hoisting, TS-typer i eget navnerom (teller bare som bruk). Begge finner også kode etter
  return/break (`unreachable`).
- `pythonLines.ts`: Pythons linjestruktur direkte fra teksten – innrykk (som tokenizeren),
  manglende kolon, `else if`, `=` i betingelse. Presise meldinger der parseren bare sier «feil».
- `syntax.ts`: feilnoder, parenteser som aldri lukkes, tekst uten slutt-anførselstegn (alle
  Lezer-språk). `diagnose.ts` samler alt med norske meldinger, `explanation` (vises med
  «Forklaringer»), `fixes` (knapper i tooltipen) og «mente du …?» (`suggest`, redigeringsavstand).
  Kjente hull i parserne (TS `x is T` i pilfunksjoner, `let x!:`; Python `4.`, `yield` alene)
  filtreres bort der. `globals.ts`: innebygde navn, modulinnhold (math, random, turtle …),
  importforslag og ord fra andre språk (`true` → `True`).
- `index.ts`: CodeMirror-koblingen via `@codemirror/lint` (streker, margmerker, tooltip,
  problempanel), meldingen på linja, samme variabel (`occurrencesAt`), fargede parentespar,
  innrykkslinjer, autofullføring (språkenes egne kilder + modulinnhold for `math.`) og
  kommandoene F2 (alle forekomster blir markører), F12, F8 og Ctrl+Shift+M. Bygges i
  `dynamicExtensions` i `createEditor.ts`, så innstillingsendringer slår gjennom med en gang.
  Analysen caches per syntakstre (`analysisOf`).
- Farger: `--diag-*`, `--bracket-1..3`, `--indent-guide`, `--occurrence*` i `theme.css`;
  tooltip/strek-stiler i `editor/theme.ts`.

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

### Terminal og feilsøking (`terminal/`, `debug/`)

- Bare skrivebord: alt går gjennom `platform.processes` (`ProcessHost` i `platform/types.ts`).
  Rust holder prosessene; `processes_reset` ved oppstart dreper det som var igjen fra før en
  reload. I nettleseren er knappene skjult.
- `TerminalPanel`: én fane per program. Skall (`settings.terminal.shell`, standard
  PowerShell) lukker fanen når de avslutter; programmer editoren starter (`runProgram(kind,
  key, …)`) gjenbruker fanen sin per `key` («run», «debug») og blir stående med utdata.
  xterm.js lastes ved første bruk; farger fra `--term-*`-variablene i `styles.css`.
- Taster i terminalen går til skallet, unntatt F-taster, Ctrl+Tab/PageUp/PageDown og
  Ctrl+J (`isAppKeyInTerminal`). Utenfor editoren kjører `installGlobalKeys` kommandoer med
  scope `'any'`; i installert app blokkeres F5/Ctrl+R (reload).
- «Kjør i terminal» (`code.runInTerminal`, Ctrl+F5) kjører filen på disk med samme
  runner som ▶ Kjør, men interaktivt. ▶ Kjør tilbyr det når programmet ville lese input.
- Feilsøking: `DebugController` snakker bare med `DebugBackend`. Python = debugpy over DAP
  (`python -m debugpy.adapter`; programmet startes i terminalen via `runInTerminal`, så
  `input()` virker). JS/TS = `node --inspect-brk` i terminalen + CDP over WebSocket.
  Nye DAP-språk kan legges til i `settings.debuggers` uten kode. Mangler debugpy, tilbys
  installasjon (`pip install debugpy` i terminalen) og økten startes etterpå.
- Stoppunkter ligger i dokumentets EditorState (`breakpointField`), følger teksten, huskes i
  økten (`SessionDoc.breakpoints`) og sendes til feilsøkeren når de endres (utsatt mens man
  skriver, men alltid før fortsett/steg). Gutteren finnes bare for språk med feilsøker.
- Pauselinja (`executionField`) settes bare i den aktive tilstanden; ved fanebytte settes den
  på nytt (`onActiveChange`). Uttrykk evalueres på nytt ved hvert stopp.
- **Steg tilbake** (`debug.stepBack`, Shift+F10): verken debugpy eller Node kan kjøre baklengs, så
  hvert stopp lagres som et `Snapshot` (linje, kallstakk, variabler, uttrykk, åpnede barn) i
  `controller.history`, og tilbakeblikket viser et tidligere (som Thonny/IntelliTrace). Programmet
  står der det står: i tilbakeblikket går F10/F11/Shift+F11 ett stopp fram, F5 til nå. Bare det
  nåværende stoppet kan spørre feilsøkeren (`isLive`); svar som kommer etter at programmet gikk
  videre, kastes. Endrede variabler sammenlignes med forrige stopp i *samme funksjonskall*
  (`previousInCall`: navn, fil og dybde i stakken). Avslutter programmet av seg selv, blir
  visningen stående (`finished`, `visible`) så man kan se tilbake; Shift+F5 lukker, F5 starter på nytt.
- Panelknappene har tekst under ikonet (pilene alene ble forvekslet). «Gå ut» er av når det ikke
  finnes en kaller i brukerens kode (`canStepOut`), ellers ville den bare kjørt programmet ferdig.
- Node: et steg som ender i Nodes egen kode (ut av hovedprogrammet) vises ikke – `NodeBackend`
  går videre ut til brukerens kode eller kjører ferdig (`stepping` + `isUserCode`).
- **Fremhevede variabler** (☆ i panelet, `debug.pin`/Shift+F9 = variabelen ved markøren): uttrykk
  med hver sin farge (`--pin-1…5`), huskes per program i localStorage (`editor.debugPins.v1`).
  Verdien tas fra variabellista når det er et navn (virker da også for gamle stopp), ellers
  evalueres uttrykket. `ExecutionLine.pins` bærer verdiene til editoren (`inlineValues.ts`).
- Feilsøking i dev: `window.debug` og `window.terminal`. Testes uten DOM:
  `tests/breakpoints.test.ts`, `tests/debugProtocols.test.ts`, `tests/keys.test.ts`.

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
  overstyre via `settings.keybindings[id]` (null = ingen hurtigtast) – i dialogen
  «Hurtigtaster» (`ui/keybindings.ts`: tastaturknappen øverst, eller høyreklikk på en knapp i
  verktøylinja). Der ligger også tegnevinduets verktøytaster (`settings.diagram.toolKeys`).
- `isActive(state)` gir aktiv-markering på knappen.
- Hvilke knapper verktøylinja viser styres av `settings.toolbar` (`'|'` = skillelinje).
- App-kommandoer (fil, visning) registreres i `app/app.ts` før editoren lages.

Standard hurtigtaster: Ctrl+Z angre, Ctrl+Y / Ctrl+Shift+Z gjør om (knappene til venstre i verktøylinja), Ctrl+Shift+1/2/3 overskrift, Ctrl+B/I fet/kursiv, Ctrl+E inline
kode, Ctrl+Shift+8/7/9 punkt-/nummerert/huskeliste, Ctrl+Shift+E kodeblokk,
Ctrl+Enter kryss av oppgave, Ctrl+Shift+Enter kjør kodeblokk/fil, Ctrl+Shift+H gjør til
overskrift, Ctrl+N nytt dokument, Ctrl+O/S/Shift+S fil, Ctrl+P skriv ut, Ctrl+W lukk fane, Ctrl+Tab /
Ctrl+PageDown neste fane, Ctrl+Shift+N ny gruppe, Ctrl+Shift+O disposisjon, Ctrl+J
terminal, Ctrl+F5 kjør i terminal, F5 feilsøk/fortsett, F9 stoppunkt, F10/F11/Shift+F11
steg, Shift+F10 steg tilbake, Shift+F9 fremhev variabel, F6 pause, Shift+F5 stopp, Ctrl+Shift+F5
start på nytt, Ctrl+M formel, Ctrl+Shift+M formelblokk (inne i formler: Ctrl+↑/↓ potens/indeks).
I kodefiler: F8/Shift+F8 neste/forrige problem, Ctrl+Shift+M problemlisten, F2 nytt navn overalt,
F12 gå til definisjon, Ctrl+Mellomrom forslag.
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

### Oppdateringer (`ui/updates.ts`, `ui/whatsNew.ts`, `scripts/release.mjs`)

- Repoet er offentlig på https://github.com/esv25/editor. Appen bruker Tauri-updateren
  og sjekker `releases/latest/download/latest.json` ved oppstart og deretter hvert
  `settings.updates.checkMinutes` (standard 30; bare i bygget app), og når man klikker
  versjonsnummeret i statuslinja. Bakgrunnssjekker viser ikke samme versjon på nytt etter
  «Senere»; da står den nye versjonen ved versjonsnummeret (`.has-update`).
- Oppdateringer er signert. Privatnøkkelen ligger i `~/.tauri/editor.key` (utenfor repoet,
  skal **aldri** committes); den offentlige nøkkelen står i `tauri.conf.json`. Mistes
  privatnøkkelen, kan ikke installerte apper oppdateres lenger – da må en ny versjon
  installeres manuelt.
- `npm run release [patch|minor|major|x.y.z] [--notes "…"]`: øker versjonen i
  package.json, tauri.conf.json og Cargo.toml, kjører typesjekk og tester, bygger og
  signerer (lav prioritet), skriver `latest.json`, committer «Versjon x.y.z», tagger,
  pusher og lager GitHub-release med installasjonsfil + `latest.json`. Krever ren
  arbeidsmappe. Publisering er utadrettet – kjør det bare når brukeren ber om det.
- «Hva er nytt»: `CHANGELOG.md` (rotmappa) bygges inn i appen (`?raw`). Første oppstart med
  en ny versjon viser seksjonene siden forrige versjon som kjørte (`editor.lastVersion` i
  localStorage; bare i bygget app, ikke for nye brukere). Ellers via kommandoen
  `app.whatsNew` og knappen i «Du har nyeste versjon»-varselet.
- Endringer brukeren merker skrives som et punkt under `## Neste versjon` i `CHANGELOG.md`
  (kort, på norsk, for brukeren – ikke commit-meldingen). `release` gjør den seksjonen om til
  `## x.y.z – dato`, legger en tom «Neste versjon» over, og bruker teksten (pluss `--notes`)
  i `latest.json` og GitHub-releasen. Er den tom, brukes commit-titlene siden forrige tag.

### Innstillinger

`settings.ts`: `getSettings()`, `updateSettings(patch)` (dyp fletting), `onSettingsChange`.
Kun overstyringer lagres, så endrede standardverdier slår gjennom. Editor-extensions
bygges på nytt via en Compartment når innstillinger endres. Endres de i et annet vindu
(tegnevinduet), følger de andre etter via `storage`-hendelsen. Tannhjulet øverst (`app.settings`) åpner
en nedtrekksmeny (`showMenuUnder` i `ui/contextMenu.ts`) med visning, tema og dialogene
(Kodehjelp, Hurtigtaster); nye innstillinger hører hjemme der (`settingsMenu` i `app.ts`); ellers endres de via konsollen eller
standardverdiene.

## Sikkerhet (`SECURITY.md`)

Arbeidet følger NSMs grunnprinsipper; trusselmodell og tiltak står i `SECURITY.md`. Det viktigste
er at en fil fra noen andre aldri skal kunne kjøre skript i webvisningen, for den har fs-tilgang
og kan starte programmer.

- **CSP** i `tauri.conf.json` (`script-src 'self'`, ingen `eval`). Den gjelder bare i bygget app
  (dev-serveren på Windows går utenom), så CSP-endringer må prøves i et bygg:
  `npx tauri build --no-bundle --config '{"identifier":"com.eirik.editor.csptest",…}'` og kjør
  `src-tauri/target/release/editor.exe` med remote debugging. `style-src` har `'unsafe-inline'`
  (CodeMirror, KaTeX) og `dangerousDisableAssetCspModification: ["style-src"]`, ellers legger
  Tauri på en nonce som slår av `'unsafe-inline'`.
- Aldri `innerHTML` med tekst fra dokumenter eller filer – bare egne ikoner/KaTeX. KaTeX bruker
  alltid `trust` fra `features/math/render.ts`, aldri `trust: true`.
- **HTML-forhåndsvisning** (`output.ts`): i appen lastes `http://preview.localhost/` (URI-ordningen
  `preview` i `lib.rs`, egen løs CSP) i en iframe med `sandbox="allow-scripts"`, og HTML-en sendes
  med `postMessage`. En `srcdoc`-ramme ville arvet appens CSP. **Aldri `allow-same-origin`**: det
  ugjennomsiktige opphavet er det som får Tauri til å avvise IPC fra rammen.
- **Klarerte mapper** (`app/trust.ts`, regler i `trustRules.ts`): alt som kjører kode som et
  program (`runContext.allow`, `runInTerminal`, `DebugController.launch`) spør via
  `allowRunning(sti)` først. Ny kjørevei → bruk den.
- **Sikkerhetskopi** (`storage/tauri.ts`): første overskriving av en fil per økt kopierer det
  gamle innholdet til `$APPLOCALDATA/backups/<dag>/`; `fs:allow-remove` gjelder bare der.
- `npm run release` kjører `npm audit --omit=dev --audit-level=high` og `cargo audit` (hvis
  installert) før den bygger.

## Konvensjoner

- Én funksjon per fil under `src/features/`; hold dem uavhengige av hverandre (delte
  hjelpere i `util/`).
- Teksten er kilden til sannhet: dekorasjoner og widgets endrer aldri dokumentet av seg
  selv; bare eksplisitte brukerhandlinger gjør det.
- Markdown som skrives skal være gyldig CommonMark/GFM (f.eks. nøsting av listepunkter
  følger forelderens innholdskolonne).
- Farger kun via CSS-variabler i `styles.css` (både lyst og mørkt tema).
- Legg til tester i `tests/` for nye tekstendrende kommandoer og heuristikker.
- Nye ting brukeren merker får et punkt under «Neste versjon» i `CHANGELOG.md`.
- Kjør `npm run typecheck` og `npm test` før du sier at noe er ferdig, og sjekk UI-endringer
  i nettleseren.
