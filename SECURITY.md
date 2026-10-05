# Sikkerhet

Editor er en personlig Markdown- og kodeeditor (nettleser og Windows-app med Tauri 2).
Sikkerhetsarbeidet tar utgangspunkt i [NSMs grunnprinsipper for IKT-sikkerhet](https://nsm.no/grunnprinsipper-ikt).
Prinsippene som gjelder en skrivebordsapp, er omtalt her (nettverk og sikkerhetsovervåkning,
2.4 og 3.2–3.3, gjelder ikke).

## Melde fra om en sårbarhet

Bruk **«Report a vulnerability»** under fanen *Security* i repoet
(<https://github.com/esv25/editor/security>). Ikke opprett et offentlig issue for sårbarheter.
Du får svar så snart som mulig, og rettelsen kommer som en ny versjon som installerte apper
oppdaterer seg til.

## Trusselmodell (NSM 1 – identifisere og kartlegge)

**Verdier:** dokumentene til brukeren, maskinen (appen kan starte programmer), og
signeringsnøkkelen for oppdateringer (den som har den, kan sende kode til alle installerte apper).

**Hovedtrusler**

1. *En fil fra noen andre.* En `.md`-, `.diagram.svg`- eller kodefil fra nettet, e-post eller
   en medelev åpnes i appen. Klarer innholdet å kjøre skript i webvisningen, har det samme
   tilgang som appen: lese og skrive filer og starte programmer.
2. *Kode som kjøres.* Kodeblokker og kodefiler kan kjøres (▶ Kjør, terminal, feilsøker). Det er
   meningen, men det skal ikke skje uten at brukeren vet hva som kjøres.
3. *Forsyningskjeden.* npm- og cargo-pakker, byggmaskinen og oppdateringskanalen (GitHub
   Releases).
4. *Personvern.* Innhold i et dokument som henter noe fra nettet (eksterne bilder) avslører at
   og når dokumentet ble åpnet.

**Komponenter med tilgang:** webvisningen (TypeScript i `src/`) snakker med Rust-delen
(`src-tauri/src/`) via Tauri-IPC. Tillatelsene står i `src-tauri/capabilities/default.json`;
egne Rust-kommandoer i `src-tauri/src/lib.rs` (`run_program`, terminaler, feilsøking).

## Tiltak (NSM 2 – beskytte og opprettholde)

| Prinsipp | Tiltak |
|---|---|
| 2.2 / 2.3 Sikker arkitektur og konfigurasjon | Streng Content Security Policy i `tauri.conf.json`: bare appens egne skript, ingen `eval`, ingen `<object>`, ingen skjemaer. Dokumentinnhold settes inn som tekst (`textContent`), aldri som HTML. |
| 2.3 | KaTeX stoler bare på `\htmlData` og `\htmlClass` med formelfeltets egne klasser (`mf-…`/`mp-…`) (`features/math/render.ts`), aldri `trust: true`, så `\href{javascript:…}`, `\includegraphics` og appens egne klasser virker ikke fra et dokument. |
| 2.2 | HTML-forhåndsvisning av kodeblokker kjøres i en sandkasset iframe uten `allow-same-origin`, fra en egen side (`preview`-ordningen i `lib.rs`) med egen CSP. Det ugjennomsiktige opphavet (`null`) gjør at Tauri avviser IPC-kall fra den (prøvd i bygget app) – derfor må `allow-same-origin` aldri legges til. |
| 2.6 Minste privilegium | Filtilgangen er bred (det er en vanlig editor), men mapper med hemmeligheter er sperret: `~/.tauri` (signeringsnøkkelen), `~/.ssh`, `~/.gnupg`, skytjeneste- og pakkeregister-pålogginger. |
| 2.5 Kontroller dataflyt | **Klarerte mapper** (`app/trust.ts`): ▶ Kjør, Kjør i terminal og Feilsøk spør før kode fra en ny mappe kjøres første gang («Stole på mappa og kjøre koden?»). Svaret huskes i `settings.security.trustedFolders`. Nye dokumenter og autolagringsmappa regnes som brukerens egne. |
| 2.2 / 2.6 | **Eksport** (PDF, Word, utskrift, `src/export/`): dokumentet bygges til HTML der all tekst er escapet (`export/html.ts`); bare lenker til `http(s):`/`mailto:` blir lenker, og rå HTML i dokumentet blir tekst. Bilder fra nettet tas bare med fra nettsteder brukeren har godkjent. `opener:allow-open-path` gjelder bare `.docx` og `.pdf` (en `.exe` avvises). |
| 2.5 / 2.8 | **Bilder fra nettet** hentes ikke automatisk: i stedet står «Vis bildet» og «Alltid fra *nettsted*» (`settings.security.imageHosts`). Bilder hentes uten referrer. |
| 2.7 Data i transitt | Oppdateringer hentes over HTTPS og er signert; appen installerer bare pakker signert med prosjektets nøkkel. Feilsøkere lytter bare på `127.0.0.1`. |
| 2.1 / 2.10 Utvikling og endringer | `npm run release` krever ren arbeidsmappe, typesjekk, tester og revisjon av avhengigheter før noe publiseres. |

## Oppdage (NSM 3)

- **3.1 Kjente sårbarheter:** `npm run release` stopper ved alvorlige funn fra
  `npm audit --omit=dev` og `cargo audit` (installer med `cargo install cargo-audit --locked`).
  Dependabot (`.github/dependabot.yml`) foreslår oppdateringer ukentlig.

## Håndtere og gjenopprette (NSM 4)

**Hvis signeringsnøkkelen kan ha lekket** (`~/.tauri/editor.key`):

1. Lag et nytt nøkkelpar (`npx tauri signer generate -w ~/.tauri/editor.key`) og sett den nye
   offentlige nøkkelen i `tauri.conf.json`.
2. Slett eller trekk tilbake GitHub-releaser som ikke er laget av deg.
3. Gi ut en ny versjon. Installerte apper stoler fortsatt på den gamle nøkkelen og kan **ikke**
   oppdatere seg til den nye – installer den nye versjonen manuelt på hver maskin.
4. Bytt GitHub-passord og -tokener (`gh auth refresh`), siden releaser publiseres derfra.

**Hvis en sårbarhet i appen blir kjent:** rett feilen, legg til en test som viser at den er
borte, og gi ut en ny versjon med `npm run release`. Beskriv hva som var galt i
utgivelsesnotatet når rettelsen er ute.

**Dokumenter (2.9):** første gang en fil overskrives i en økt, legges det som lå på disken i
`%LOCALAPPDATA%\com.eirik.editor\backups\<dato>\` (høyreklikk en fil i filtreet → «Vis
sikkerhetskopier»). Kopier eldre enn 30 dager slettes. Dette er ikke en full sikkerhetskopi
av maskinen. Viktige dokumenter bør i tillegg ligge i OneDrive, git eller lignende.

**Signeringsnøkkelen:** ha en kopi offline (minnepinne e.l.). Mistes den, kan
installerte apper ikke oppdateres lenger.
