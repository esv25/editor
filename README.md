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

Andre kommandoer:

```bash
npm test          # enhetstester
npm run build     # produksjonsbygg til dist/
```

## Hurtigtaster

| Handling | Tast |
|---|---|
| Overskrift 1/2/3 | Ctrl+Shift+1 / 2 / 3 |
| Fet / kursiv / inline kode | Ctrl+B / Ctrl+I / Ctrl+E |
| Punktliste / nummerert / huskeliste | Ctrl+Shift+8 / 7 / 9 |
| Kodeblokk | Ctrl+Shift+E |
| Kryss av oppgave | Ctrl+Enter |
| Gjør linja til overskrift | Ctrl+Shift+H |
| Rykk inn / ut i liste | Tab / Shift+Tab |
| Åpne / lagre / lagre som | Ctrl+O / Ctrl+S / Ctrl+Shift+S |
| Vis/skjul disposisjon | Ctrl+Shift+O |
| Søk | Ctrl+F |

## Tilpasse

Innstillinger (linjebredde, font, tema, overskriftsforslag, hurtigtaster, knapper)
ligger i `src/settings.ts`. Arkitekturen er beskrevet i `CLAUDE.md`.
