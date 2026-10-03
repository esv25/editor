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

## Matte

Trykk **Ctrl+M** for en formel i linja, eller **Ctrl+Shift+M** for en formelblokk på egen linje. Klikk på en formel for å endre den, eller gå inn i den med piltastene.

Inne i en formel: \`/\` gir brøk, \`^\` (eller \`**\`) opphøyd, \`sqrt\` kvadratrot, \`pi\` gir π, \`<=\` gir ≤ og \`*\` gangetegn. Tab hopper til neste tomme felt, Enter gir ny linje i en formelblokk, og Esc går ut. Mens du er i en formel, kommer mattepanelet fram nederst med symbolene fra 1. klasse til R2 – og under «Hurtigtaster» lager du dine egne. Σ-knappen viser panelet hele tiden.

Løs likningen $2x + 3 = 7$:

$$
\\begin{aligned}
2x + 3 &= 7 \\\\
2x &= 4 \\\\
x &= 2
\\end{aligned}
$$

Andregradsformelen er $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$, og $\\int_0^1 x^2\\,dx = \\frac{1}{3}$.

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
