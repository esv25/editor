# Editor

En Markdown-editor som er behagelig å skrive i: ren tekst i bunnen, live formatering,
knapper for vanlig formatering, smarte lister og forslag om overskrifter.

## Kjøre

Krever Node 20 eller nyere.

```bash
npm install
npm run dev
```

Åpne http://localhost:5173 i **Chrome eller Edge**. Da kan filer åpnes og lagres direkte
og autolagres. I andre nettlesere lagres filer som nedlasting.

## Skrivebordsapp (Tauri)

Engangsoppsett på Windows:

1. Installer **Visual Studio Build Tools**: https://aka.ms/vs/17/release/vs_BuildTools.exe –
   velg arbeidsmengden «Skrivebordsutvikling med C++» (Desktop development with C++).
2. Installer **Rust**: https://rustup.rs (last ned `rustup-init.exe`, velg standardvalgene).
3. Åpne en ny terminal.

Deretter:

```bash
npm run app        # start skrivebordsappen i utviklingsmodus
npm run app:build  # lag installasjonsfil
```

Første bygg tar noen minutter (Rust-avhengigheter kompileres). Installasjonsfilene havner i
`src-tauri/target/release/bundle/` (`nsis/*-setup.exe` og `msi/*.msi`). Etter installasjon
kan `.md`-filer åpnes med «Åpne med → Editor».

Andre kommandoer:

```bash
npm test          # enhetstester
npm run build     # produksjonsbygg til dist/
```

## Oppdateringer

Programmet ser etter nye versjoner når det starter (og når du klikker versjonsnummeret
nederst til høyre). Finnes det en, får du «Ny versjon er klar – Oppdater nå»; programmet
lagrer, installerer og starter på nytt.

Ny versjon publiseres med:

```bash
npm run release
```

Det bygger, signerer og laster opp til https://github.com/esv25/editor/releases.
Signeringsnøkkelen ligger i `C:\Users\<deg>\.tauri\editor.key` – ta vare på den.

## Hurtigtaster

| Handling | Tast |
|---|---|
| Overskrift 1/2/3 | Ctrl+Shift+1 / 2 / 3 |
| Fet / kursiv / inline kode | Ctrl+B / Ctrl+I / Ctrl+E |
| Punktliste / nummerert / huskeliste | Ctrl+Shift+8 / 7 / 9 |
| Kodeblokk | Ctrl+Shift+E |
| Kjør kodeblokken markøren står i | Ctrl+Shift+Enter |
| Kryss av oppgave | Ctrl+Enter |
| Gjør linja til overskrift | Ctrl+Shift+H |
| Rykk inn / ut i liste | Tab / Shift+Tab |
| Åpne / lagre / lagre som | Ctrl+O / Ctrl+S / Ctrl+Shift+S |
| Vis/skjul disposisjon | Ctrl+Shift+O |
| Søk | Ctrl+F |
| Nytt dokument / ny gruppe | Ctrl+N / Ctrl+Shift+N |
| Lukk fane | Ctrl+W |
| Neste / forrige fane | Ctrl+Tab / Ctrl+Shift+Tab (eller Ctrl+PageDown / PageUp) |

## Faner

Øverste rad er grupper du lager selv (+ for ny, dobbeltklikk for å gi nytt navn). Hver
gruppe har sine åpne dokumenter som faner i raden under. ● betyr ulagrede endringer;
midtklikk eller ✕ lukker en fane. Fanene huskes til neste gang du åpner programmet.

## Kodefiler

Filer som .py, .js og .ts åpnes som ren kode med linjenumre. Velg språk øverst og trykk
▶ Kjør (Ctrl+Shift+Enter) for å kjøre hele filen; utdataene vises nederst. Lag en ny
kodefil med { } ved siden av fanene.

## Kodeblokker

Skriv ` ```python title="navn.py" ` for å gi en blokk språk og navn, eller bruk hodet på
blokken (klikk på navnet, velg språk i menyen). ▶ Kjør kjører koden og viser utdataene
under blokken. Skrivebordsappen kan kjøre Python, JavaScript, TypeScript, PowerShell,
Bash (Git Bash) og Java; HTML vises som forhåndsvisning. I nettleseren kan bare
JavaScript og HTML kjøres.

## Autolagring

Dokumenter som er lagret til en fil, lagres automatisk mens du skriver. I
skrivebordsappen får nye dokumenter automatisk en fil i `Dokumenter\Editor`, oppkalt
etter første overskrift.

## Tilpasse

Innstillinger (linjebredde, font, tema, overskriftsforslag, hurtigtaster, knapper)
ligger i `src/settings.ts`. Arkitekturen er beskrevet i `CLAUDE.md`.
