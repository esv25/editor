/**
 * How much help code files get («Kodehjelp»): a level, plus single
 * features the user has turned on or off regardless of the level.
 */

export type CodeHelpLevel = 'off' | 'basic' | 'standard' | 'full';

export type CodeHelpFeature =
  | 'syntaxErrors'
  | 'names'
  | 'unused'
  | 'unusedParams'
  | 'unreachable'
  | 'tips'
  | 'explanations'
  | 'inlineMessages'
  | 'gutterMarkers'
  | 'occurrences'
  | 'bracketColors'
  | 'indentGuides'
  | 'stickyScroll'
  | 'autocomplete'
  | 'trailingSpace';

export interface CodeHelpSettings {
  level: CodeHelpLevel;
  /** Features turned on/off by hand; missing or null = as the level says. */
  overrides: Partial<Record<CodeHelpFeature, boolean | null>>;
}

export const defaultCodeHelp: CodeHelpSettings = { level: 'standard', overrides: {} };

export interface LevelInfo {
  id: CodeHelpLevel;
  name: string;
  description: string;
}

export const levels: LevelInfo[] = [
  { id: 'off', name: 'Av', description: 'Bare fargene på koden. Ingen streker, forslag eller markeringer.' },
  { id: 'basic', name: 'Litt', description: 'Streker under feil: skrivefeil i koden og navn som ikke finnes.' },
  {
    id: 'standard',
    name: 'Standard',
    description: 'Feil og advarsler, ubrukt kode tones ned, forslag mens du skriver, fargede parenteser og innrykkslinjer.',
  },
  {
    id: 'full',
    name: 'Mye',
    description: 'Alt i «Standard», og i tillegg står feilmeldingen på linja, med forklaringer og råd for nybegynnere.',
  },
];

export interface FeatureInfo {
  id: CodeHelpFeature;
  name: string;
  description: string;
  /** The lowest level that has it. */
  from: Exclude<CodeHelpLevel, 'off'>;
  group: 'problems' | 'show' | 'writing';
}

export const featureInfo: FeatureInfo[] = [
  { id: 'syntaxErrors', group: 'problems', from: 'basic', name: 'Skrivefeil i koden', description: 'Rød strek der koden ikke kan leses: manglende kolon eller parentes, feil innrykk, tekst uten slutt-anførselstegn.' },
  { id: 'names', group: 'problems', from: 'basic', name: 'Navn som ikke finnes', description: 'Rød strek under feilstavede variabler og funksjoner, med forslag til hva du mente. Også navn som brukes før de har fått en verdi.' },
  { id: 'unused', group: 'problems', from: 'standard', name: 'Ubrukte variabler', description: 'Variabler, funksjoner og importer som aldri brukes, tones ned.' },
  { id: 'unusedParams', group: 'problems', from: 'standard', name: 'Ubrukte parametere', description: 'Parametere funksjonen aldri bruker, tones også ned.' },
  { id: 'unreachable', group: 'problems', from: 'standard', name: 'Kode som aldri kjøres', description: 'Kode etter return, break eller raise tones ned.' },
  { id: 'tips', group: 'problems', from: 'full', name: 'Råd for nybegynnere', description: 'Blå strek ved ting som virker, men ofte er feil – som å kalle en variabel «list» eller «sum».' },
  { id: 'explanations', group: 'show', from: 'full', name: 'Forklaringer', description: 'Meldingene forklarer hva som er galt og hvordan du retter det, ikke bare hva det heter.' },
  { id: 'inlineMessages', group: 'show', from: 'full', name: 'Meldingen på linja', description: 'Feilmeldingen står skrevet til høyre på linja, så du slipper å holde musa over streken.' },
  { id: 'gutterMarkers', group: 'show', from: 'basic', name: 'Merker i margen', description: 'Et rødt eller gult merke ved linjenummeret på linjer med feil.' },
  { id: 'occurrences', group: 'show', from: 'standard', name: 'Marker samme variabel', description: 'Står markøren på et navn, markeres alle stedene den samme variabelen brukes.' },
  { id: 'bracketColors', group: 'show', from: 'standard', name: 'Fargede parentespar', description: 'Parenteser som hører sammen, får samme farge.' },
  { id: 'indentGuides', group: 'show', from: 'standard', name: 'Innrykkslinjer', description: 'Tynne loddrette linjer viser hvilke linjer som hører til samme blokk.' },
  { id: 'stickyScroll', group: 'show', from: 'standard', name: 'Blokkstart øverst', description: 'Ruller du forbi linja som starter en funksjon, løkke eller klasse, blir den stående øverst, så du ser hvor du er. Klikk på den for å gå dit.' },
  { id: 'trailingSpace', group: 'show', from: 'full', name: 'Mellomrom på slutten', description: 'Mellomrom på slutten av linjer vises med farge.' },
  { id: 'autocomplete', group: 'writing', from: 'standard', name: 'Forslag mens du skriver', description: 'En liste med navn og kodemaler dukker opp mens du skriver (Ctrl+Mellomrom viser den alltid).' },
];

const ORDER: CodeHelpLevel[] = ['off', 'basic', 'standard', 'full'];

/** Whether a level has a feature (ignoring the user's own choices). */
export function levelHas(level: CodeHelpLevel, feature: CodeHelpFeature): boolean {
  const info = featureInfo.find((f) => f.id === feature);
  return !!info && ORDER.indexOf(level) >= ORDER.indexOf(info.from);
}

/** The features that are on. */
export function activeFeatures(settings: CodeHelpSettings): Set<CodeHelpFeature> {
  const on = new Set<CodeHelpFeature>();
  for (const f of featureInfo) {
    const own = settings.overrides[f.id];
    if (own ?? levelHas(settings.level, f.id)) on.add(f.id);
  }
  return on;
}
