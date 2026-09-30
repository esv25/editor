/** Shown on first start so the features are discoverable. */
export const welcomeText = `# Velkommen

Dette er en Markdown-editor som prøver å være behagelig å skrive i. Teksten lagres som ren Markdown, men vises formatert mens du skriver.

## Formatering

Skriv **fet**, *kursiv* og \`inline kode\` – eller marker tekst og bruk knappene over. Markeringstegnene vises bare på linja markøren står på.

## Lister

- Trykk Enter for et nytt punkt
- Enter på et tomt punkt avslutter lista
  - Tab og Shift+Tab rykker inn og ut

1. Nummererte lister
2. fortsetter også av seg selv

- [ ] Klikk på boksen for å krysse av
- [x] Ctrl+Enter gjør det samme fra tastaturet

## Kode

Kodeblokker får navn og språk i hodet sitt, og kan kjøres med ▶ Kjør (eller Ctrl+Shift+Enter). Utdataene vises under blokken.

\`\`\`python title="hilsen.py"
for navn in ["Kari", "Ola"]:
    print(f"Hei, {navn}!")
\`\`\`

## Overskriftsforslag

Skriv en kort linje med tom linje over og under, uten punktum til slutt, og stopp litt. Da dukker det opp et lite hint i margen. Prøv å sette markøren på linja under:

Neste kapittel

Ctrl+O åpner en fil, Ctrl+S lagrer. Alt lagres automatisk mens du skriver – i skrivebordsappen havner nye dokumenter i Dokumenter\\Editor, oppkalt etter første linje.
`;
