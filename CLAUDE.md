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

- `npm run dev` – utviklingsserver på http://localhost:5173
- `npm test` – enhetstester
- `npm run typecheck` / `npm run build`
- `npm run app` – skrivebordsappen i utviklingsmodus (starter Vite selv; port 5173 må være ledig)
- `npm run app:build` – installasjonsfiler (NSIS/MSI) i `src-tauri/target/release/bundle/`

I dev-modus ligger `window.editorView` og `window.editorDoc` tilgjengelig for feilsøking
i nettleserkonsollen.

## Arkitektur

```
src/
  main.ts                 inngangspunkt → app/app.ts
  settings.ts             innstillinger (standardverdier + brukerens overstyringer i localStorage)
  commands/registry.ts    kommandoregisteret (id, navn, ikon, hurtigtast, run, isActive)
  editor/
    createEditor.ts       setter sammen CodeMirror: grunnoppsett + alle features
    theme.ts              editortema og HighlightStyle (farger via CSS-variabler)
  features/               én CodeMirror-funksjon per fil (se under)
    index.ts              listen over aktive features
    types.ts              Feature-grensesnittet
    util/markdown.ts      felles hjelpere (liste-parsing, valgte linjer, syntakstre)
    headingSuggestion/    overskriftsforslag: index.ts (extension) + rules.ts (heuristikk)
  storage/                fil-laget – ALL fil-I/O går hit
    types.ts              StorageBackend-grensesnittet + FileRef
    fsAccess.ts           File System Access API (Chrome/Edge)
    download.ts           reserve for andre nettlesere (input + nedlasting)
    tauri.ts              skrivebordsappen: native dialoger + plugin-fs
    drafts.ts             sikkerhetskopi av ulagret arbeid i localStorage
    index.ts              velger backend
  platform/               det som ellers skiller nettleser og skrivebord
    types.ts              Platform: vindustittel, bekreftelsesdialog, lukking, oppstartsfil
    web.ts / tauri.ts     implementasjonene; index.ts velger (`isTauri`)
  app/
    app.ts                kobler sammen editor, dokument, UI og app-kommandoer
    document.ts           DocumentController: fil, ulagret-status, lagring, autolagring
    appearance.ts         tema og typografi → CSS-variabler / data-theme
    welcome.ts            velkomsttekst første gang
  ui/                     verktøylinje, disposisjon, tittel/statuslinje
  styles.css              layout, temafarger (CSS-variabler) og editorklasser
tests/                    Vitest; helpers.ts har `run(command, "tekst med | markør")`
src-tauri/
  tauri.conf.json         vindu, bundling, .md-filtilknytning
  capabilities/default.json  tillatelser (fs-scope er `**` – det er en vanlig editor)
  src/lib.rs              Tauri-oppsett + kommandoen `startup_file` («Åpne med»)
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
kode), `codeBlocks`, `codeBlockTools`, `headings`, `inlineFormat`, `lists`, `taskList`,
`smartLists`, `headingSuggestion`, `closeBrackets`.

### Kodeblokker: navn, språk og kjøring (`features/codeBlockTools/`)

- Navn og språk står i fence-linja: ` ```python title="navn.py" `. Parsing i
  `features/util/fence.ts` (ren tekst, testet i `tests/fence.test.ts`).
- `header.ts`: hode på åpningslinja (navn, språkmeny, ▶ Kjør). Når markøren er utenfor
  blokken erstatter hodet rå-teksten; inni blokken vises rå-teksten og kontrollene flyter
  til høyre.
- `run.ts`: skrivebord → `platform.runProgram` (Rust-kommandoen `run_program` i
  `src-tauri/src/runner.rs`: skriver koden til en temp-fil, kjører programmet med
  tidsgrense og uten konsollvindu). Nettleser → JavaScript i en Web Worker. HTML vises
  som forhåndsvisning i en sandkasset iframe.
- `runners.ts`: språk → program (python, node, powershell, Git Bash, java). Kan
  overstyres/utvides via `settings.codeRunners`. Kjøring skjer i dokumentets mappe.
- `output.ts`: utdata ligger i en StateField (ikke i teksten), følger blokken og
  forsvinner når blokken slettes.

### Autolagring

`DocumentController` autolagrer dokumenter som har en fil. Nye dokumenter får på
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
Ctrl+Enter kryss av oppgave, Ctrl+Shift+Enter kjør kodeblokk, Ctrl+Shift+H gjør til
overskrift, Ctrl+O/S/Shift+S fil, Ctrl+Shift+O disposisjon.
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

Annet som varierer (vindustittel, ja/nei-dialog, advarsel ved lukking, fil fra
kommandolinja) går gjennom `platform` – bruk aldri `window.confirm`/`document.title`
direkte. Nye Tauri-API-kall krever ofte en tillatelse i `capabilities/default.json`.

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
