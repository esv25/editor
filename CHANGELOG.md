# Hva er nytt

Dette vises i appen første gang den starter etter en oppdatering (og med kommandoen
«Hva er nytt»). Skriv nye punkter under «Neste versjon» etter hvert som endringer kommer
inn – `npm run release` gjør overskriften om til versjonsnummeret.

## Neste versjon

- **Angre og Gjør om** har fått egne knapper til venstre i verktøylinja (grå når det ikke er noe å angre). Angre virker som i Word: alt du skriver i ett strekk (også linjeskift) angres samlet, uansett hvor lenge du holder på. Et nytt angresteg begynner når du gjør noe annet – flytter markøren, sletter, limer inn, formaterer eller en liste fortsetter av seg selv. Gjør om virker også med Ctrl+Shift+Z.

## 0.8.0 – 2026-10-05

- **Lagre som PDF og åpne i Word**: den nye knappen øverst til venstre (ved Lagre) lager en PDF-fil av dokumentet, eller en Word-fil som åpnes i Word med en gang. Formler blir ekte Word-formler som kan redigeres, og overskrifter, lister, tabeller, kode og bilder (også tegninger) kommer med. Når fila er lagret, dukker det opp en boble under knappen (som nedlastinger i Chrome) med «Åpne» og «Vis i mappen», og menyen husker det du nylig har lagret. Der finnes også «Skriv ut» (Ctrl+P).

## 0.7.1 – 2026-10-05

- Lettere å se innrykket i kodefiler: innrykkslinjene er litt tydeligere, blokka markøren står i får en farget linje (som i VS Code), og statuslinja viser innrykksnivået («innrykk 2»).

## 0.7.0 – 2026-10-03

- **Kodehjelp** i Python- og JavaScript-filer, som i VS Code: rød bølgestrek under feilstavede navn med forslag til hva du mente («mente du count?» – klikk for å rette), ubrukte variabler, funksjoner og importer tones ned, og kode som aldri kjøres blir grå. Python får egne meldinger for manglende kolon, feil innrykk, `=` i stedet for `==` og glemte importer.
- Fargede parentespar, innrykkslinjer, og alle stedene samme variabel brukes markeres når markøren står på den. Forslag dukker opp mens du skriver.
- Velg hvor mye hjelp du vil ha under **Kodehjelp** i innstillingsmenyen: Av, Litt, Som VS Code eller Mye (da står feilmeldingen på linja, med forklaring). Hver ting kan også slås av og på for seg.
- **Innstillinger** (tannhjulet øverst til høyre): en meny med hva som vises (sidefelt, terminal), lyst/mørkt tema, Kodehjelp, Hurtigtaster og Hva er nytt. Tema- og tastaturknappene øverst er flyttet dit.
- Nye taster i kodefiler: `F8` neste feil, `Ctrl+Shift+M` listen over problemer, `F2` gi nytt navn overalt, `F12` gå til der navnet er definert. Antall feil står nederst til høyre.
- Appen sier fra om nye versjoner mens den er åpen (den ser etter hver halvtime), ikke bare når den starter. Trykker du «Senere», står den nye versjonen ved versjonsnummeret nederst – klikk der for å oppdatere.
- Feilsøking: «Steg tilbake» (Shift+F10 eller knappen ved siden av «Neste linje») viser linja og variablene slik de var ved stoppet før – fint når det kommer en feilmelding eller noe rart skjer. Programmet spoles ikke tilbake; F10 går fram igjen, og F5 tar deg tilbake til nå. Variabler som nettopp ble endret, er markert. Når programmet er ferdig (eller krasjet), blir feilsøkingsvisningen stående, så du fortsatt kan gå tilbake gjennom stoppene.
- Feilsøking: Trykk ☆ ved en variabel (eller sett markøren på den i koden og trykk Shift+F9) for å fremheve den. Fremhevede variabler vises stort øverst i feilsøkingsvisningen, med verdien rett ved linja programmet står på, og de får hver sin farge i koden. De huskes til neste gang du feilsøker samme fil.
- Knappene i feilsøkingen har fått tekst under ikonene («Tilbake», «Neste linje», «Fortsett», «Gå inn», «Gå ut» …), så pilene ikke blandes sammen. «Gå ut» er grå når programmet ikke er inne i en funksjon – før kjørte den da bare programmet ferdig.
- Feilsøking av JavaScript: «Gå ut av funksjonen» i hovedprogrammet (eller et steg forbi siste linje) stopper ikke lenger inne i Node sin egen kode, men kjører videre til programmet er ferdig.

## 0.6.0 – 2026-10-03

- **Sikkerhet**: kode fra en mappe du ikke har kjørt kode fra før, kjøres først når du har sagt ja. Bilder fra nettet vises først når du klikker «Vis bildet». Før en fil overskrives, legges en sikkerhetskopi til side (høyreklikk en fil i filtreet → «Vis sikkerhetskopier»).

- **Hva er nytt**: etter hver oppdatering viser appen hva som er endret. Klikk på versjonsnummeret nederst for å se det igjen.
- Mattepanelet kommer fram mens du skriver en formel, og forsvinner etterpå. Σ-knappen viser det hele tiden, som før.
- Ny dialog **Hurtigtaster** (tastaturknappen øverst, eller høyreklikk på en knapp i verktøylinja): se og endre alle hurtigtaster, også tegnevinduets verktøytaster.
- Mattepanelet: likevektspil (⇌) under Kjemi.

## 0.5.0 – 2026-10-03

- Matte: formler med WYSIWYG-redigering (`Ctrl+M` i linja, `Ctrl+Shift+M` som blokk), mattepanel og egne hurtigtaster.
- Tegnevindu: eget program for diagrammer, koblet til notatene – UML-klasser, ER-modeller, piltyper og frihånd med klikk.
- Tegnevindu: Strek-verktøy for frie rette streker; streker og piler hekter seg på hjørner.
- Tegnevindu: flytt og endre størrelse med dra og slipp.

## 0.4.0 – 2026-10-02

Terminal i editoren (`Ctrl+J`). «Kjør i terminal» (`Ctrl+F5`) for programmer som leser input. Feilsøker for Python og JavaScript: stoppunkter, steg for steg, variabler. Bilder i notatene.

## 0.3.4 – 2026-10-02

Riktig innrykk i kode: Python får 4 mellomrom, Enter holder nivået, og Tab fungerer som i VS Code.

## 0.3.3 – 2026-10-01

Ryddigere filtre: linjer per mappenivå, ikoner for alle filer og roligere utseende.

## 0.3.2 – 2026-10-01

Kodeblokker viser ikke lenger ``` øverst eller nederst. Markøren hopper over de skjulte linjene. Statuslinja viser riktig lagringsmappe.

## 0.3.1 – 2026-10-01

Ingen røde stavekontroll-streker under kode i kodeblokker og inline kode.

## 0.3.0 – 2026-10-01

Grupper kan kobles til en mappe: filene vises i sidefeltet med undermapper, og nye dokumenter lagres der. Høyreklikk på en gruppe for valgene.

## 0.2.0 – 2026-10-01

Første versjon med automatiske oppdateringer. Faner og grupper, kodefiler med kjøring, kjørbare kodeblokker, autolagring og mer.
