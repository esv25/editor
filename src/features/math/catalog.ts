/**
 * Everything the math panel offers, grouped the way school maths comes:
 * from counting and the four operations (1.–7. trinn) through algebra and
 * functions (8.–10., 1T) to derivatives, vectors, series and integrals
 * (R1, R2 – including differential equations from the older R2 plan).
 * The list follows the LK20 competence aims (udir.no, MAT01-06, MAT09-01,
 * MAT03-02) and the symbol sets of MathLive, Word and Latex Suite.
 *
 * Each item is a LaTeX template: `#?` an empty spot, `#0` the selection
 * (or an empty spot), `#@` the selection or the term before the cursor.
 * Every item is also a command (`math.<id>`), so it can get a keyboard
 * shortcut in settings.keybindings – or with a right click in the panel.
 */

export interface MathItem {
  id: string;
  /** Norwegian name (tooltip, search). */
  name: string;
  /** Template inserted in the formula. */
  latex: string;
  /** What the button shows, if not the template itself. */
  preview?: string;
  /** Extra search words. */
  keys?: string;
  /** Instead of inserting: an action on the formula (matrix rows …). */
  action?: 'addRow' | 'addRowAbove' | 'addColumn' | 'addColumnLeft' | 'deleteRow' | 'deleteColumn';
  /** Typed instead inside \ce{…}, in mhchem's own syntax (`<=>` for ⇌). */
  chem?: string;
}

export interface MathCategory {
  id: string;
  name: string;
  /** Short tab label (the full name is the tooltip). */
  short: string;
  items: MathItem[];
}

const item = (id: string, name: string, latex: string, keys?: string, preview?: string): MathItem => ({
  id,
  name,
  latex,
  ...(keys ? { keys } : {}),
  ...(preview ? { preview } : {}),
});

/** A unit after a number: «5 cm». */
const unit = (id: string, name: string, latex: string, keys?: string): MathItem =>
  item(`unit.${id}`, name, `\\,${latex}`, `enhet ${keys ?? ''}`, `5\\,${latex}`);

export const categories: MathCategory[] = [
  {
    id: 'basic',
    name: 'Tall og regning',
    short: 'Tall',
    items: [
      item('plus', 'Pluss', '+', 'addisjon'),
      item('minus', 'Minus', '-', 'subtraksjon'),
      item('times', 'Gange', '\\cdot', 'multiplikasjon prikk'),
      item('cross', 'Gange (kryss)', '\\times', 'multiplikasjon kryss'),
      item('divide', 'Dele', ':', 'divisjon kolon'),
      item('div', 'Dele (÷)', '\\div', 'divisjon obelus'),
      item('eq', 'Er lik', '=', 'likhetstegn'),
      item('ne', 'Er ikke lik', '\\ne', 'ulik'),
      item('lt', 'Mindre enn', '<'),
      item('gt', 'Større enn', '>'),
      item('le', 'Mindre enn eller lik', '\\le'),
      item('ge', 'Større enn eller lik', '\\ge'),
      item('approx', 'Omtrent lik', '\\approx', 'tilnærmet avrundet'),
      item('frac', 'Brøk', '\\frac{#@}{#?}', 'teller nevner'),
      item('mixed', 'Blandet tall', '#?\\frac{#?}{#?}', 'brøk hele'),
      item('half', 'En halv', '\\frac{1}{2}', 'brøk'),
      item('percent', 'Prosent', '\\%'),
      item('permille', 'Promille', '\\text{‰}'),
      item('square', 'I andre', '^{2}', 'kvadrat potens'),
      item('pow', 'Potens', '^{#?}', 'eksponent opphøyd'),
      item('sqrt', 'Kvadratrot', '\\sqrt{#0}', 'rot'),
      item('box', 'Tom rute', '\\square', 'luke fyll inn boks'),
      item('paren', 'Parentes', '\\left(#0\\right)', 'parenteser'),
      item('degree', 'Grader', '^{\\circ}', 'vinkel temperatur'),
      item('ldots', 'Og så videre', '\\ldots', 'prikker'),
      item('negative', 'Negativt tall i parentes', '(-#?)', 'minus negativ'),
    ],
  },
  {
    id: 'columns',
    name: 'Oppstilling',
    short: 'Oppstilling',
    items: [
      item(
        'add3',
        'Pluss (oppstilling)',
        '\\begin{array}{cccc} & #? & #? & #? \\\\ & #? & #? & #? \\\\ + & #? & #? & #? \\\\ \\hline & #? & #? & #? \\end{array}',
        'oppstilling addisjon minnetall kolonne',
        '\\begin{array}{cccc} & {\\scriptstyle 1} & & \\\\ & 2 & 4 & 7 \\\\ + & 1 & 8 & 5 \\\\ \\hline & 4 & 3 & 2 \\end{array}',
      ),
      item(
        'sub3',
        'Minus (oppstilling)',
        '\\begin{array}{cccc} & #? & #? & #? \\\\ & #? & #? & #? \\\\ - & #? & #? & #? \\\\ \\hline & #? & #? & #? \\end{array}',
        'oppstilling subtraksjon låne kolonne',
        '\\begin{array}{cccc} & & {\\scriptstyle 13} & \\\\ & 5 & \\cancel{4} & 2 \\\\ - & 1 & 8 & 1 \\\\ \\hline & 3 & 6 & 1 \\end{array}',
      ),
      item(
        'mul',
        'Gange (oppstilling)',
        '\\begin{array}{ccccc} & & #? & #? & #? \\\\ & & & \\cdot & #? \\\\ \\hline & #? & #? & #? & #? \\end{array}',
        'oppstilling multiplikasjon kolonne',
        '\\begin{array}{cccc} & 1 & 2 & 3 \\\\ & & \\cdot & 4 \\\\ \\hline & 4 & 9 & 2 \\end{array}',
      ),
      item(
        'longdiv',
        'Divisjon (oppstilling)',
        '\\begin{array}{llllllll} #? & #? & #? & : & #? & = & #? & #? \\\\ #? & #? & & & & & & \\\\ \\hline #? & #? & #? & & & & & \\end{array}',
        'oppstilling divisjon lang deling',
        '\\begin{array}{lllllll} 1 & 4 & 4 & : & 12 & = & 12 \\\\ 1 & 2 & & & & & \\\\ \\hline & 2 & 4 & & & & \\end{array}',
      ),
      item('cancel', 'Stryk over', '\\cancel{#0}', 'forkorte strek over'),
      item('carry', 'Lite tall (mente)', '{\\scriptstyle #?}', 'minnetall mente låne liten'),
    ],
  },
  {
    id: 'algebra',
    name: 'Algebra',
    short: 'Algebra',
    items: [
      item('frac2', 'Brøk', '\\frac{#@}{#?}', 'teller nevner'),
      item('square2', 'I andre', '^{2}', 'kvadrat'),
      item('cube', 'I tredje', '^{3}', 'kubikk'),
      item('pow2', 'Potens', '^{#?}', 'eksponent opphøyd'),
      item('sub', 'Senket skrift', '_{#?}', 'indeks fotskrift'),
      item('sqrt2', 'Kvadratrot', '\\sqrt{#0}', 'rot'),
      item('cbrt', 'Kubikkrot', '\\sqrt[3]{#0}', 'tredjerot'),
      item('nroot', 'n-te rot', '\\sqrt[#?]{#0}', 'rot'),
      item('pm', 'Pluss minus', '\\pm'),
      item('abs', 'Absoluttverdi', '\\left|#0\\right|', 'tallverdi'),
      item('paren2', 'Parentes', '\\left(#0\\right)'),
      item('bracket', 'Hakeparentes', '\\left[#0\\right]', 'klamme'),
      item('braces', 'Krøllparentes', '\\left\\{#0\\right\\}', 'mengde'),
      item('sci', 'Standardform', '#?\\cdot 10^{#?}', 'tierpotens vitenskapelig'),
      item('implies', 'Medfører', '\\Rightarrow', 'implikasjon pil'),
      item('iff', 'Ekvivalent', '\\Leftrightarrow', 'ekvivalens dobbelpil'),
      item('therefore', 'Altså', '\\therefore', 'derfor'),
      item(
        'system',
        'Likningssett',
        '\\left\\{\\begin{aligned} #? \\\\ #? \\end{aligned}\\right.',
        'likningssystem to likninger',
      ),
      item(
        'abc',
        'abc-formelen',
        'x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}',
        'andregradsformel annengradslikning',
      ),
      item('answer', 'Svar (dobbel strek)', '\\underline{\\underline{#0}}', 'svar understrek dobbel'),
      item('boxed', 'Svar i boks', '\\boxed{#0}', 'ramme svar'),
      item('cancel2', 'Stryk over (forkorte)', '\\cancel{#0}', 'forkorte'),
      item('overset', 'Tekst over tegn', '\\overset{#?}{#0}', 'over likhetstegn forklaring'),
      item('text', 'Tekst', '\\text{#?}', 'ord eller og der', '\\text{abc}'),
    ],
  },
  {
    id: 'functions',
    name: 'Funksjoner',
    short: 'Funksjoner',
    items: [
      item('fx', 'f(x)', 'f(x)', 'funksjon'),
      item('fprime', 'f′(x)', "f'(x)", 'derivert'),
      item('fprime2', 'f″(x)', "f''(x)", 'andrederivert dobbeltderivert'),
      item('finv', 'Omvendt funksjon', 'f^{-1}(x)', 'invers'),
      item('compose', 'Sammensatt funksjon', '(f \\circ g)(x)', 'sammensetning ring'),
      item('domain', 'Definisjonsmengde', 'D_{#?}', 'Df'),
      item('range', 'Verdimengde', 'V_{#?}', 'Vf'),
      item('ln', 'ln', '\\ln', 'naturlig logaritme'),
      item('log', 'log', '\\log', 'logaritme'),
      item('lg', 'lg', '\\lg', 'tierlogaritme briggsk'),
      item('ex', 'e opphøyd i', 'e^{#?}', 'eksponentialfunksjon euler'),
      item('sin', 'sin', '\\sin', 'sinus'),
      item('cos', 'cos', '\\cos', 'cosinus'),
      item('tan', 'tan', '\\tan', 'tangens'),
      item('arcsin', 'Omvendt sinus', '\\sin^{-1}', 'arcsin'),
      item('arccos', 'Omvendt cosinus', '\\cos^{-1}', 'arccos'),
      item('arctan', 'Omvendt tangens', '\\tan^{-1}', 'arctan'),
      item('slope', 'Stigningstall', '\\frac{\\Delta y}{\\Delta x}', 'delta vekstfart'),
      item('avg', 'Gjennomsnittlig vekstfart', '\\frac{f(#?) - f(#?)}{#? - #?}', 'vekstfart'),
      item('lim', 'Grenseverdi', '\\lim_{#? \\to #?}', 'lim går mot'),
      item('liminf', 'Grenseverdi mot uendelig', '\\lim_{x \\to \\infty}', 'lim uendelig'),
      item('infty', 'Uendelig', '\\infty'),
      item('to', 'Går mot', '\\to', 'pil'),
      item(
        'piecewise',
        'Delt funksjonsuttrykk',
        '\\begin{cases} #? & #? \\\\ #? & #? \\end{cases}',
        'stykkevis definert',
      ),
      item(
        'table',
        'Verditabell',
        '\\begin{array}{c|c|c|c|c} x & #? & #? & #? & #? \\\\ \\hline f(x) & #? & #? & #? & #? \\end{array}',
        'tabell verdier',
        '\\begin{array}{c|c|c|c} x & 0 & 1 & 2 \\\\ \\hline f(x) & 1 & 3 & 5 \\end{array}',
      ),
    ],
  },
  {
    id: 'calculus',
    name: 'Derivasjon og integral',
    short: 'Derivasjon',
    items: [
      item('prime', 'Derivert (′)', "'", 'merke'),
      item('dydx', 'dy/dx', '\\frac{dy}{dx}', 'derivert leibniz'),
      item('ddx', 'd/dx', '\\frac{d}{dx}', 'derivere'),
      item('d2ydx2', 'Andrederivert d²y/dx²', '\\frac{d^{2}y}{dx^{2}}', 'andrederivert'),
      item(
        'derivdef',
        'Definisjonen av den deriverte',
        "f'(x) = \\lim_{\\Delta x \\to 0} \\frac{f(x + \\Delta x) - f(x)}{\\Delta x}",
        'grenseverdi derivert definisjon h',
      ),
      item('int', 'Integral', '\\int #? \\, dx', 'ubestemt antiderivert'),
      item('dint', 'Bestemt integral', '\\int_{#?}^{#?} #? \\, dx', 'grenser'),
      item('eval', 'Innsatt grenser [F(x)]', '\\Big[ #? \\Big]_{#?}^{#?}', 'antiderivert innsetting'),
      item('evalbar', 'Innsatt grenser (strek)', '\\Big. #? \\Big|_{#?}^{#?}', 'innsetting'),
      item('dx', 'dx', '\\, dx', 'differensial'),
      item('dt', 'dt', '\\, dt', 'differensial'),
      item('dot', 'Prikk-derivert', '\\dot{#0}', 'tid fart'),
      item('ddot', 'Dobbel prikk', '\\ddot{#0}', 'akselerasjon'),
      item(
        'volume',
        'Omdreiningslegeme',
        'V = \\pi \\int_{#?}^{#?} \\left(f(x)\\right)^{2} \\, dx',
        'volum rotasjon',
      ),
      item('partial', 'Partiell', '\\partial', 'del'),
      item('iint', 'Dobbelintegral', '\\iint', 'integral'),
      item('oint', 'Kurveintegral', '\\oint', 'integral'),
      item('ode1', "y′ + ay = b", "y' + #? y = #?", 'differensiallikning første orden'),
      item('ode2', "y″ + by′ + cy = 0", "y'' + #? y' + #? y = 0", 'differensiallikning andre orden'),
      item('Ce', 'Ce^{kx}', 'C e^{#? x}', 'løsning eksponentiell'),
    ],
  },
  {
    id: 'vectors',
    name: 'Vektorer og geometri',
    short: 'Geometri',
    items: [
      item('vec', 'Vektor', '\\vec{#0}', 'pil over'),
      item('vecAB', 'Vektor AB', '\\overrightarrow{#0}', 'vektor mellom punkter pil'),
      item('coord2', 'Vektor [x, y]', '\\left[#?, #?\\right]', 'koordinater komponenter'),
      item('coord3', 'Vektor [x, y, z]', '\\left[#?, #?, #?\\right]', 'koordinater komponenter rommet'),
      item('point', 'Punkt (x, y)', '(#?, #?)', 'koordinat'),
      item('length', 'Lengde av vektor', '\\left|\\vec{#?}\\right|', 'absoluttverdi'),
      item('dotp', 'Skalarprodukt', '\\cdot', 'prikkprodukt'),
      item('crossp', 'Vektorprodukt', '\\times', 'kryssprodukt'),
      item(
        'crossdet',
        'Vektorprodukt (determinant)',
        '\\begin{vmatrix} \\vec{e}_x & \\vec{e}_y & \\vec{e}_z \\\\ #? & #? & #? \\\\ #? & #? & #? \\end{vmatrix}',
        'kryssprodukt determinant enhetsvektorer',
      ),
      item('unitvec', 'Enhetsvektor', '\\vec{e}_{#?}', 'basis'),
      item(
        'param',
        'Parameterframstilling',
        '\\begin{cases} x = #? \\\\ y = #? \\end{cases}',
        'linje parameter t',
      ),
      item(
        'param3',
        'Parameterframstilling (rommet)',
        '\\begin{cases} x = #? \\\\ y = #? \\\\ z = #? \\end{cases}',
        'linje plan parameter rommet',
      ),
      item('perp', 'Står vinkelrett på', '\\perp', 'normal ortogonal'),
      item('parallel', 'Parallell', '\\parallel'),
      item('angle', 'Vinkel', '\\angle', 'vinkel abc'),
      item('triangle', 'Trekant', '\\triangle', 'trekant abc'),
      item('degree2', 'Grader', '^{\\circ}'),
      item('pi', 'Pi', '\\pi'),
      item('similar', 'Formlik', '\\sim', 'likeformet'),
      item('congruent', 'Kongruent', '\\cong'),
      item('segment', 'Linjestykke', '\\overline{#0}', 'strek over'),
      item('arc', 'Bue', '\\overgroup{#0}', 'sirkelbue'),
      item('hatangle', 'Vinkel (hatt)', '\\widehat{#0}', 'vinkel abc'),
      item('pythagoras', 'Pytagoras', 'a^{2} + b^{2} = c^{2}', 'setning hypotenus'),
      item('sinrule', 'Sinussetningen', '\\frac{\\sin A}{a} = \\frac{\\sin B}{b} = \\frac{\\sin C}{c}', 'trigonometri'),
      item('cosrule', 'Cosinussetningen', 'a^{2} = b^{2} + c^{2} - 2bc \\cos A', 'trigonometri'),
      item('arearule', 'Arealsetningen', 'T = \\frac{1}{2} ab \\sin C', 'trigonometri areal'),
    ],
  },
  {
    id: 'series',
    name: 'Følger og rekker',
    short: 'Rekker',
    items: [
      item('an', 'Ledd nr. n', 'a_{n}', 'følge ledd'),
      item('an1', 'Neste ledd', 'a_{n+1}', 'rekursiv'),
      item('Sn', 'Sum av n ledd', 'S_{n}', 'rekke sum'),
      item('sum', 'Sum (Σ)', '\\sum_{#?}^{#?}', 'summetegn sigma'),
      item('sumi', 'Sum i = 1 til n', '\\sum_{i=1}^{n} #?', 'summetegn'),
      item('suminf', 'Uendelig sum', '\\sum_{n=1}^{\\infty} #?', 'uendelig rekke'),
      item('prod', 'Produkt (Π)', '\\prod_{#?}^{#?}', 'produkttegn'),
      item('arith', 'Aritmetisk rekke', 'S_{n} = \\frac{n(a_{1} + a_{n})}{2}', 'sumformel'),
      item('geom', 'Geometrisk rekke', 'S_{n} = a_{1} \\cdot \\frac{k^{n} - 1}{k - 1}', 'sumformel kvotient'),
      item('geominf', 'Uendelig geometrisk rekke', 'S = \\frac{a_{1}}{1 - k}', 'konvergent'),
      item('converge', 'Konvergens', '|k| < 1', 'kvotient konvergerer'),
      item('factorial', 'Fakultet', '!', 'n fakultet'),
      item('induction', 'Induksjon', 'P(n) \\Rightarrow P(n+1)', 'induksjonsbevis'),
    ],
  },
  {
    id: 'probability',
    name: 'Sannsynlighet',
    short: 'Sannsynlighet',
    items: [
      item('P', 'Sannsynlighet', 'P(#?)', 'P(A)'),
      item('given', 'Betinget sannsynlighet', 'P(#? \\mid #?)', 'gitt'),
      item('mid', 'Gitt (|)', '\\mid', 'loddrett strek betinget'),
      item('favorable', 'Gunstige / mulige', '\\frac{\\text{gunstige}}{\\text{mulige}}', 'sannsynlighet'),
      item('binom', 'Binomialkoeffisient', '\\binom{#?}{#?}', 'n over k kombinasjoner'),
      item('fact', 'Fakultet', '#@!', 'n fakultet'),
      item('complement', 'Komplement', '\\overline{#0}', 'ikke A strek over'),
      item('mean', 'Gjennomsnitt', '\\bar{x}', 'snitt middelverdi x strek'),
      item('sigma', 'Standardavvik', '\\sigma', 'sigma'),
      item('mu', 'Forventning', '\\mu', 'my'),
      item('EX', 'Forventningsverdi', 'E(X)', 'forventning'),
      item('VarX', 'Varians', '\\operatorname{Var}(X)', 'varians'),
      item(
        'binomial',
        'Binomisk sannsynlighet',
        'P(X = k) = \\binom{n}{k} p^{k} (1 - p)^{n - k}',
        'binomisk fordeling',
      ),
    ],
  },
  {
    id: 'sets',
    name: 'Mengder og logikk',
    short: 'Logikk',
    items: [
      item('in', 'Element i', '\\in', 'tilhører'),
      item('notin', 'Ikke element i', '\\notin'),
      item('subset', 'Delmengde', '\\subseteq'),
      item('psubset', 'Ekte delmengde', '\\subset'),
      item('cup', 'Union', '\\cup', 'eller'),
      item('cap', 'Snitt', '\\cap', 'og'),
      item('setminus', 'Minus mengde', '\\setminus', 'differanse'),
      item('empty', 'Tom mengde', '\\emptyset'),
      item('R', 'Reelle tall', '\\mathbb{R}', 'R'),
      item('N', 'Naturlige tall', '\\mathbb{N}', 'N'),
      item('Z', 'Hele tall', '\\mathbb{Z}', 'Z'),
      item('Q', 'Rasjonale tall', '\\mathbb{Q}', 'Q'),
      item('C', 'Komplekse tall', '\\mathbb{C}', 'C'),
      item('set', 'Mengde', '\\{ #? \\}', 'krøllparentes'),
      item('setbuilder', 'Mengde med betingelse', '\\{ #? \\mid #? \\}', 'slik at'),
      item('closed', 'Lukket intervall', '[#?, #?]', 'intervall'),
      item('open', 'Åpent intervall', '\\langle #?, #? \\rangle', 'intervall'),
      item('halfopenr', 'Halvåpent intervall', '[#?, #? \\rangle', 'intervall'),
      item('halfopenl', 'Halvåpent intervall', '\\langle #?, #?]', 'intervall'),
      item('langle', 'Vinkelparentes venstre', '\\langle', 'intervall'),
      item('rangle', 'Vinkelparentes høyre', '\\rangle', 'intervall'),
      item('and', 'Og', '\\land', 'konjunksjon'),
      item('or', 'Eller', '\\lor', 'disjunksjon'),
      item('not', 'Ikke', '\\neg', 'negasjon'),
      item('forall', 'For alle', '\\forall'),
      item('exists', 'Det finnes', '\\exists'),
      item('implies2', 'Medfører', '\\Rightarrow'),
      item('impliedby', 'Følger av', '\\Leftarrow'),
      item('iff2', 'Ekvivalent', '\\Leftrightarrow'),
      item('equiv', 'Identisk lik', '\\equiv', 'kongruent modulo'),
    ],
  },
  {
    id: 'matrices',
    name: 'Matriser og tabeller',
    short: 'Matriser',
    items: [
      item('pmatrix2', 'Matrise 2 × 2', '\\begin{pmatrix} #? & #? \\\\ #? & #? \\end{pmatrix}'),
      item('pmatrix3', 'Matrise 3 × 3', '\\begin{pmatrix} #? & #? & #? \\\\ #? & #? & #? \\\\ #? & #? & #? \\end{pmatrix}'),
      item('bmatrix2', 'Matrise med [ ]', '\\begin{bmatrix} #? & #? \\\\ #? & #? \\end{bmatrix}'),
      item('det2', 'Determinant 2 × 2', '\\begin{vmatrix} #? & #? \\\\ #? & #? \\end{vmatrix}'),
      item('det3', 'Determinant 3 × 3', '\\begin{vmatrix} #? & #? & #? \\\\ #? & #? & #? \\\\ #? & #? & #? \\end{vmatrix}'),
      item('column2', 'Kolonnevektor', '\\begin{pmatrix} #? \\\\ #? \\end{pmatrix}', 'søylevektor'),
      item('column3', 'Kolonnevektor (3)', '\\begin{pmatrix} #? \\\\ #? \\\\ #? \\end{pmatrix}', 'søylevektor'),
      item('cases', 'Klamme med linjer', '\\begin{cases} #? \\\\ #? \\end{cases}', 'likningssett'),
      item('grid', 'Rutenett', '\\begin{array}{ccc} #? & #? & #? \\\\ #? & #? & #? \\end{array}', 'tabell'),
      { ...item('addRow', 'Ny rad under', '', 'matrise tabell', '\\begin{matrix} \\square \\\\ \\htmlClass{mp-plus}{+} \\end{matrix}'), action: 'addRow' },
      { ...item('addRowAbove', 'Ny rad over', '', 'matrise tabell', '\\begin{matrix} \\htmlClass{mp-plus}{+} \\\\ \\square \\end{matrix}'), action: 'addRowAbove' },
      { ...item('addColumn', 'Ny kolonne til høyre', '', 'matrise tabell', '\\square \\; \\htmlClass{mp-plus}{+}'), action: 'addColumn' },
      { ...item('addColumnLeft', 'Ny kolonne til venstre', '', 'matrise tabell', '\\htmlClass{mp-plus}{+} \\; \\square'), action: 'addColumnLeft' },
      { ...item('deleteRow', 'Slett raden', '', 'matrise tabell fjern', '\\begin{matrix} \\square \\\\ \\htmlClass{mp-minus}{\\times} \\end{matrix}'), action: 'deleteRow' },
      { ...item('deleteColumn', 'Slett kolonnen', '', 'matrise tabell fjern', '\\square \\; \\htmlClass{mp-minus}{\\times}'), action: 'deleteColumn' },
    ],
  },
  {
    id: 'greek',
    name: 'Greske bokstaver',
    short: 'Gresk',
    items: [
      ['alpha', 'Alfa'], ['beta', 'Beta'], ['gamma', 'Gamma'], ['delta', 'Delta'], ['varepsilon', 'Epsilon'],
      ['zeta', 'Zeta'], ['eta', 'Eta'], ['theta', 'Theta'], ['iota', 'Jota'], ['kappa', 'Kappa'],
      ['lambda', 'Lambda'], ['mu', 'My'], ['nu', 'Ny'], ['xi', 'Ksi'], ['pi', 'Pi'], ['rho', 'Rho'],
      ['sigma', 'Sigma'], ['tau', 'Tau'], ['varphi', 'Fi'], ['chi', 'Khi'], ['psi', 'Psi'], ['omega', 'Omega'],
      ['Gamma', 'Stor gamma'], ['Delta', 'Stor delta'], ['Theta', 'Stor theta'], ['Lambda', 'Stor lambda'],
      ['Pi', 'Stor pi'], ['Sigma', 'Stor sigma'], ['Phi', 'Stor fi'], ['Psi', 'Stor psi'], ['Omega', 'Stor omega'],
    ].map(([cmd, name]) => item(`greek.${cmd}`, name, `\\${cmd}`, `gresk ${cmd}`)),
  },
  {
    id: 'units',
    name: 'Enheter',
    short: 'Enheter',
    items: [
      unit('mm', 'Millimeter', '\\mathrm{mm}'),
      unit('cm', 'Centimeter', '\\mathrm{cm}'),
      unit('m', 'Meter', '\\mathrm{m}'),
      unit('km', 'Kilometer', '\\mathrm{km}'),
      unit('cm2', 'Kvadratcentimeter', '\\mathrm{cm}^{2}', 'areal'),
      unit('m2', 'Kvadratmeter', '\\mathrm{m}^{2}', 'areal'),
      unit('cm3', 'Kubikkcentimeter', '\\mathrm{cm}^{3}', 'volum'),
      unit('m3', 'Kubikkmeter', '\\mathrm{m}^{3}', 'volum'),
      unit('L', 'Liter', '\\mathrm{L}', 'volum'),
      unit('dL', 'Desiliter', '\\mathrm{dL}', 'volum'),
      unit('mL', 'Milliliter', '\\mathrm{mL}', 'volum'),
      unit('g', 'Gram', '\\mathrm{g}', 'masse vekt'),
      unit('kg', 'Kilogram', '\\mathrm{kg}', 'masse vekt'),
      unit('s', 'Sekund', '\\mathrm{s}', 'tid'),
      unit('min', 'Minutt', '\\mathrm{min}', 'tid'),
      unit('h', 'Time', '\\mathrm{h}', 'tid'),
      unit('kmh', 'Kilometer i timen', '\\mathrm{km/h}', 'fart'),
      unit('ms', 'Meter per sekund', '\\mathrm{m/s}', 'fart'),
      unit('ms2', 'Meter per sekund i andre', '\\mathrm{m/s^{2}}', 'akselerasjon'),
      unit('kr', 'Kroner', '\\text{kr}', 'penger'),
      unit('C', 'Grader celsius', '^{\\circ}\\mathrm{C}', 'temperatur'),
      unit('N', 'Newton', '\\mathrm{N}', 'kraft'),
      unit('J', 'Joule', '\\mathrm{J}', 'energi'),
      unit('W', 'Watt', '\\mathrm{W}', 'effekt'),
    ],
  },
  {
    id: 'chemistry',
    name: 'Kjemi',
    short: 'Kjemi',
    items: [
      item('ce', 'Kjemisk formel (skriv f.eks. H2O, Na+, ->)', '\\ce{}', 'kjemi molekyl stoff', '\\ce{H2O}'),
      item('ceReaction', 'Reaksjonslikning', '\\ce{2H2 + O2 -> 2H2O}', 'kjemi reaksjon pil'),
      item('ceEquilibrium', 'Likevekt', '\\ce{N2 + 3H2 <=> 2NH3}', 'kjemi likevekt'),
      { ...item('equilibrium', 'Likevektspil', '\\rightleftharpoons', 'kjemi likevekt pil reversibel harpun'), chem: '<=>' },
      item('ceIons', 'Ioner', '\\ce{Na+ + Cl- -> NaCl}', 'kjemi ion ladning'),
      item('ceCharge', 'Ladning', '\\ce{SO4^2-}', 'kjemi ion ladning'),
      item('ceState', 'Tilstand', '\\ce{NaCl(aq)}', 'kjemi aq s l g'),
      item('pu', 'Tall med enhet', '\\pu{}', 'fysikk enhet', '\\pu{9,81 m/s^2}'),
    ],
  },
  {
    id: 'misc',
    name: 'Piler og annet',
    short: 'Diverse',
    items: [
      item('rarr', 'Pil høyre', '\\rightarrow'),
      item('larr', 'Pil venstre', '\\leftarrow'),
      item('lrarr', 'Pil begge veier', '\\leftrightarrow'),
      item('mapsto', 'Avbildes på', '\\mapsto'),
      item('uarr', 'Pil opp', '\\uparrow', 'øker'),
      item('darr', 'Pil ned', '\\downarrow', 'minker'),
      item('xrarr', 'Pil med tekst', '\\xrightarrow{#?}', 'over pil'),
      item('cdots', 'Prikker (midt)', '\\cdots'),
      item('vdots', 'Prikker (loddrett)', '\\vdots'),
      item('propto', 'Proporsjonal', '\\propto'),
      item('check', 'Hake', '\\checkmark', 'riktig'),
      item('underbrace', 'Klamme under', '\\underbrace{#0}_{#?}', 'forklaring'),
      item('overbrace', 'Klamme over', '\\overbrace{#0}^{#?}', 'forklaring'),
      item('red', 'Rød farge', '\\textcolor{red}{#0}', 'farge marker'),
      item('blue', 'Blå farge', '\\textcolor{blue}{#0}', 'farge marker'),
      item('space', 'Mellomrom', '\\;', 'luft'),
      item('quad', 'Stort mellomrom', '\\quad', 'luft'),
    ],
  },
];

/** What you type for an item without any shortcut (structure keys of the formula field). */
export const TYPED: Record<string, string> = {
  frac: '/',
  frac2: '/',
  pow: '^  eller  **',
  pow2: '^  eller  **',
  square: '^2',
  square2: '^2',
  cube: '^3',
  sub: '_',
  paren: '(',
  paren2: '(',
  bracket: '[',
  braces: '{',
  abs: '|',
  times: '*',
  text: '"',
  degree: 'grader',
  prime: "'",
  factorial: '!',
};

/** All items by id. */
export const itemsById = new Map<string, MathItem>();
for (const category of categories) for (const it of category.items) if (!itemsById.has(it.id)) itemsById.set(it.id, it);

/** LaTeX for showing an item on a button: empty spots as faint boxes. */
export function previewLatex(it: MathItem): string {
  const box = '\\htmlClass{mf-ph}{\\square}';
  return (it.preview ?? it.latex).replace(/#[?0@]/g, box).replace(/^([_^])/, `${box}$1`);
}

/** Lowercase, without diacritics, for searching. */
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae');
}

/** Items matching a search (Norwegian name, search words, LaTeX command names). */
export function searchItems(query: string, limit = 50): MathItem[] {
  const q = fold(query.trim().replace(/^\\/, ''));
  if (!q) return [];
  const scored: { it: MathItem; score: number }[] = [];
  for (const it of itemsById.values()) {
    const name = fold(it.name);
    const words = fold(`${it.name} ${it.keys ?? ''} ${it.id} ${it.latex.match(/\\[a-zA-Z]+/g)?.join(' ') ?? ''}`).replace(/\\/g, '');
    let score = -1;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (words.split(/\s+/).some((w) => w === q)) score = 2;
    else if (words.split(/\s+/).some((w) => w.startsWith(q))) score = 3;
    else if (words.includes(q)) score = 4;
    if (score >= 0) scored.push({ it, score });
  }
  scored.sort((a, b) => a.score - b.score || a.it.name.length - b.it.name.length);
  return scored.slice(0, limit).map((s) => s.it);
}

/** Template for a command name typed after «\» (LaTeX name or Norwegian word). */
export function lookupCommand(name: string): string | undefined {
  if (!name) return undefined;
  const exact = [...itemsById.values()].find((it) => !it.action && it.latex.startsWith(`\\${name}`) && /^\\[a-zA-Z]+/.exec(it.latex)?.[0] === `\\${name}`);
  if (exact) return exact.latex;
  return undefined;
}
