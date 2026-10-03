import { describe, expect, it } from 'vitest';
import { parser as pyParser } from '@lezer/python';
import { parser as jsParser } from '@lezer/javascript';
import { diagnose, editDistance, suggest } from '../src/code/assist/diagnose';
import { activeFeatures, featureInfo, levelHas, type CodeHelpFeature } from '../src/code/assist/levels';
import type { Issue } from '../src/code/assist/types';

const all = new Set(featureInfo.map((f) => f.id));

function issues(lang: string, code: string, features: Set<CodeHelpFeature> = all): Issue[] {
  const tree =
    lang === 'python' ? pyParser.parse(code) : jsParser.configure({ dialect: lang === 'typescript' ? 'ts' : 'jsx' }).parse(code);
  return diagnose(tree, code, lang, features);
}

/** "severity text: message" for each problem, e.g. "error cuont: «cuont» er ikke definert". */
function check(lang: string, code: string, features?: Set<CodeHelpFeature>): string[] {
  return issues(lang, code, features).map((i) => `${i.severity} ${code.slice(i.from, i.to)}: ${i.message}`);
}

/** The text after applying the first problem's fix with the given label. */
function fix(lang: string, code: string, label: string): string {
  for (const i of issues(lang, code)) {
    const f = i.fixes?.find((x) => x.label === label);
    if (!f) continue;
    let out = code;
    for (const c of [...f.changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
    return out;
  }
  throw new Error(`No fix «${label}» in ${JSON.stringify(check(lang, code))}`);
}

const py = (code: string, features?: Set<CodeHelpFeature>) => check('python', code, features);
const js = (code: string, features?: Set<CodeHelpFeature>) => check('javascript', code, features);
const ts = (code: string) => check('typescript', code);

describe('Python: names', () => {
  it('suggests what a misspelled name probably was', () => {
    expect(py('count = 0\nprint(cuont)\n')).toEqual([
      'hint count: «count» får en verdi, men brukes aldri',
      'error cuont: «cuont» er ikke definert – mente du «count»?',
    ]);
    expect(py('navn = "Ola"\nprint(Navn)\n')).toContain('error Navn: «Navn» er ikke definert – mente du «navn»?');
    expect(py('pirnt("hei")\n')).toEqual(['error pirnt: «pirnt» er ikke definert – mente du «print»?']);
    expect(fix('python', 'count = 0\nprint(cuont)\n', 'Bytt til «count»')).toBe('count = 0\nprint(count)\n');
  });

  it('knows built-ins and what star imports of known modules bring', () => {
    expect(py('print(len(range(3)), __name__)\n')).toEqual([]);
    expect(py('from turtle import *\nforward(100)\nleft(90)\n')).toEqual([]);
    expect(py('from math import *\nprint(sqroot(2))\n')).toEqual(['error sqroot: «sqroot» er ikke definert – mente du «sqrt»?']);
    // A module we don't know: anything might come from it.
    expect(py('from minmodul import *\nhva_som_helst()\n')).toEqual([]);
  });

  it('checks names in modules it knows', () => {
    expect(py('import math\nprint(math.sqroot(2))\n')).toEqual(['error sqroot: math har ikke noe som heter «sqroot» – mente du «sqrt»?']);
    expect(py('import random as r\nr.randint(1, 6)\n')).toEqual([]);
  });

  it('offers the missing import', () => {
    expect(py('print(sqrt(2))\n')).toEqual(['error sqrt: «sqrt» er ikke definert – mangler du «from math import sqrt»?']);
    expect(fix('python', '"""Doc."""\nprint(math.pi)\n', 'Legg til «import math»')).toBe('"""Doc."""\nimport math\nprint(math.pi)\n');
    expect(fix('python', 'import os\nos.getcwd()\nrandom.random()\n', 'Legg til «import random»')).toBe(
      'import os\nimport random\nos.getcwd()\nrandom.random()\n',
    );
  });

  it('explains words from other languages', () => {
    expect(fix('python', 'ferdig = true\nprint(ferdig)\n', 'Bytt til True')).toBe('ferdig = True\nprint(ferdig)\n');
    expect(py('x = null\nprint(x)\n')).toEqual(['error null: «null» finnes ikke i Python – Python bruker None for «ingenting»']);
  });

  it('points class attributes used in methods to self', () => {
    const code = 'class A:\n    antall = 0\n    def vis(self):\n        print(antall)\nA().vis()\n';
    expect(py(code)).toEqual(['error antall: «antall» er ikke definert – mente du «self.antall»?']);
    expect(fix('python', code, 'Bytt til self.antall')).toContain('print(self.antall)');
  });

  it('warns about names used before they get a value', () => {
    expect(py('print(svar)\nsvar = 42\nprint(svar)\n')).toEqual(['warning svar: «svar» brukes før den har fått en verdi']);
    expect(py('tegn()\ndef tegn():\n    pass\n')).toEqual(['warning tegn: «tegn» brukes før den er definert (linje 2)']);
    // UnboundLocalError: assigning makes it local to the function.
    expect(py('x = 1\ndef f():\n    x += 1\nf()\nprint(x)\n')).toEqual(['warning x: «x» brukes før den har fått en verdi']);
    // A typo of a name that does have a value.
    expect(py('teller = 0\nfor i in range(3):\n    tellr += i\nprint(teller)\n')).toEqual([
      'warning tellr: «tellr» brukes før den har fått en verdi – mente du «teller»?',
    ]);
  });

  it('accepts values from earlier rounds of a loop, functions called later, and built-ins at module level', () => {
    expect(py('forrige = None\nfor t in [1, 2]:\n    if t > 1:\n        print(forrige2)\n    forrige2 = t\nprint(forrige)\n')).toEqual([]);
    expect(py('def main():\n    hjelp()\ndef hjelp():\n    pass\nmain()\n')).toEqual([]);
  });

  it('follows Python scoping: comprehensions, global, nonlocal, class bodies, lambdas', () => {
    const code = [
      'teller = 0',
      'def øk():',
      '    global teller',
      '    teller += 1',
      'def lag():',
      '    n = 0',
      '    def neste():',
      '        nonlocal n',
      '        n += 1',
      '        return n',
      '    return neste',
      'kvadrater = [x * x for x in range(5) if x % 2]',
      'par = {k: v for k, v in zip("ab", "cd")}',
      'f = lambda a, b=2: a + b',
      'print(sum(x for x in kvadrater), par, f(1), lag()(), øk())',
      'args = {"a": 1}',
      'print(", ".join(f"{k}={v!r}" for k, v in args.items()))',
      '',
    ].join('\n');
    expect(py(code)).toEqual([]);
  });

  it('understands keyword arguments, decorators, with/except, match and type parameters', () => {
    const code = [
      'from dataclasses import dataclass',
      '@dataclass',
      'class P:',
      '    x: float',
      '    y: float = 0.0',
      'def f[T](verdi: T, /) -> T:',
      '    return verdi',
      'try:',
      '    with open("f.txt") as fil:',
      '        print(fil.read(),  # comment',
      '              end="")',
      'except OSError as e:',
      '    print(e)',
      'match P(1, 2):',
      '    case P(x=0, y=yy):',
      '        print(yy)',
      '    case [første, *resten]:',
      '        print(første, resten)',
      'print(f(1))',
      '',
    ].join('\n');
    expect(py(code)).toEqual([]);
  });
});

describe('Python: unused code', () => {
  it('fades unused imports, variables, functions and parameters', () => {
    expect(py('import os\n')).toEqual(['hint import os: «os» er importert, men brukes ikke']);
    expect(fix('python', 'import os\nprint(1)\n', 'Fjern importen')).toBe('print(1)\n');
    expect(py('x = 5\n')).toEqual(['hint x: «x» får en verdi, men brukes aldri']);
    expect(py('def tegn():\n    pass\n')).toEqual(['hint tegn: Funksjonen «tegn» brukes aldri']);
    // Parameters before one that's used can't be removed, so only the last ones count.
    expect(py('def f(a, b, c):\n    return b\nf(1, 2, 3)\n')).toEqual(['hint c: Parameteren «c» brukes ikke']);
  });

  it('leaves alone self, _names, class attributes, __future__ and methods', () => {
    expect(py('from __future__ import annotations\nclass A:\n    navn = "a"\n    def m(self, _x):\n        pass\nA()\n_skjult = 1\n')).toEqual([]);
  });

  it('fades code after return, break and raise', () => {
    expect(py('def f():\n    return 1\n    print("aldri")\nf()\n')).toEqual(['hint print("aldri"): Koden kjøres aldri (den står etter «return»)']);
    expect(py('def f():\n    return 1  # ferdig\nf()\n')).toEqual([]);
  });

  it('only shows what the features ask for', () => {
    const basic = activeFeatures({ level: 'basic', overrides: {} });
    expect(py('import os\nprint(cuont)\n', basic)).toEqual(['error cuont: «cuont» er ikke definert']);
  });
});

describe('Python: syntax', () => {
  it('finds a missing colon and offers to add it', () => {
    expect(py('x = 3\nif x > 5\n    print(x)\n')).toEqual(['error 5: Mangler kolon (:) på slutten av linja']);
    expect(fix('python', 'for i in range(3)\n    print(i)\n', 'Legg til :')).toBe('for i in range(3):\n    print(i)\n');
  });

  it('explains elif, == and Python 2 print', () => {
    expect(fix('python', 'x = 1\nif x == 1:\n    pass\nelse if x == 2:\n    pass\n', 'Bytt til elif')).toContain('elif x == 2:');
    expect(fix('python', 'x = 1\nif x = 1:\n    pass\n', 'Bytt til ==')).toBe('x = 1\nif x == 1:\n    pass\n');
    expect(fix('python', 'print "hei"\n', 'Legg til parenteser')).toBe('print("hei")\n');
    expect(py('x = None\nif x is not None: y = x\nprint(y)\n')).toEqual([]);
  });

  it('checks indentation like Python does', () => {
    expect(py('def f():\nprint(1)\n')).toEqual(['hint f: Funksjonen «f» brukes aldri', 'error print(1): Mangler innrykk']);
    expect(py('x = 1\n    y = 2\nprint(x, y)\n')).toEqual(['error y = 2: Uventet innrykk']);
    expect(py('if True:\n        a = 1\n    b = 2\nprint(a, b)\n')).toEqual(['error b = 2: Innrykket passer ikke med linjene over']);
    expect(py('if True:\n')).toEqual(['error :: Mangler kode etter kolon']);
  });

  it('points at the bracket or quote that is missing', () => {
    expect(py('t = (1, 2\nprint(t)\n')).toEqual(['error (: Parentesen ( blir aldri lukket']);
    expect(py('print(1))\n')).toEqual(['error ): Parentesen ) har ingen ( å lukke']);
    expect(py('s = "abc\nprint(s)\n')).toEqual(['error "abc: Teksten mangler avsluttende anførselstegn (")']);
  });

  it('knows Python-only statements', () => {
    expect(py('return 5\n')).toEqual(['error return: «return» kan bare brukes inne i en funksjon']);
    expect(py('break\n')).toEqual(['error break: «break» kan bare brukes inne i en løkke']);
    expect(fix('python', 'let x = 5\nprint(x)\n', 'Fjern let')).toBe('x = 5\nprint(x)\n');
  });

  it('gives tips for beginners', () => {
    expect(py('list = [1, 2]\nprint(list)\n')).toEqual(['info list: «list» er navnet på en innebygd funksjon i Python']);
    expect(py('x = 5\nif x is 5:\n    pass\n')).toEqual(['warning is: Bruk == for å sammenligne verdier']);
  });
});

describe('JavaScript and TypeScript', () => {
  it('finds undefined and undeclared names', () => {
    expect(js('consle.log(1);\n')).toEqual(['error consle: «consle» er ikke definert – mente du «console»?']);
    expect(js('x = 5;\nconsole.log(x);\n')).toEqual(['error x: «x» er ikke deklarert', 'error x: «x» er ikke definert']);
    expect(fix('javascript', 'svar = 5;\n', 'Legg til let')).toBe('let svar = 5;\n');
    expect(js('console.log(typeof ukjent, window, document, Math.PI);\n')).toEqual([]);
    expect(fix('javascript', 'print(True);\n', 'Bytt til console.log')).toBe('console.log(True);\n');
  });

  it('knows const, let and hoisting', () => {
    expect(js('const a = 1;\na = 2;\nconsole.log(a);\n')).toEqual(['error a: «a» er en konstant (const) og kan ikke få ny verdi']);
    expect(fix('javascript', 'const a = 1;\na = 2;\nconsole.log(a);\n', 'Bytt const til let')).toBe('let a = 1;\na = 2;\nconsole.log(a);\n');
    expect(js('console.log(b);\nlet b = 1;\n')).toEqual(['error b: «b» brukes før den er deklarert']);
    expect(js('const d = d + 1;\nconsole.log(d);\n')).toEqual(['error d: «d» brukes før den er deklarert']);
    expect(js('f();\nfunction f() { return v; }\nvar v = 1;\n')).toEqual([]);
    expect(js('class A { b = new B(); }\nclass B {}\nnew A();\n')).toEqual([]);
  });

  it('fades unused code but keeps exports', () => {
    expect(js('import fs from "fs";\n')).toEqual(['hint import fs from "fs";: «fs» er importert, men brukes ikke']);
    expect(js('let x = 1;\nfunction f(a, b) { return a; }\nexport function g(c) { return c; }\nexport { f };\n')).toEqual([
      'hint x: «x» får en verdi, men brukes aldri',
      'hint b: Parameteren «b» brukes ikke',
    ]);
    expect(js('export { a, b as c } from "./m";\n')).toEqual([]);
    expect(js('function g() {\n  return 1;\n  console.log("død");\n}\ng();\n')).toEqual([
      'hint console.log("død");: Koden kjøres aldri (den står etter «return»)',
    ]);
  });

  it('handles destructuring, classes, JSX and switch', () => {
    const code = [
      'import React from "react";',
      'const { a, b: [c], ...rest } = obj();',
      'let [x, y] = [1, 2];',
      '[x, y] = [y, x];',
      'class K { #p = 1; get p() { return this.#p; } set p(v) { this.#p = v; } }',
      'const Vis = ({ tekst = "" }) => <div>{tekst}</div>;',
      'switch (a) { case 1: { const m = "x"; console.log(m); break; } default: break; }',
      'function obj() { return {}; }',
      'console.log(a, c, rest, x, new K(), <Vis tekst="hei" />);',
      '',
    ].join('\n');
    expect(js(code)).toEqual([]);
  });

  it('gives tips', () => {
    expect(js('let x = 1;\nif (x = 2) {}\n')).toEqual([
      'hint x: «x» får en verdi, men brukes aldri',
      'warning =: Mente du === ? (= gir en ny verdi)',
    ]);
  });

  it('counts type uses and ignores what the parser cannot read', () => {
    const code = [
      'import type { Ting } from "./t";',
      'enum E { A, B = A }',
      'let v!: Ting;',
      'interface I { n: number }',
      'export const finn = (xs: unknown[]): I[] => xs.filter((x): x is I => !!x);',
      'export abstract class Base { abstract lag(n: number): E; }',
      'console.log(v);',
      '',
    ].join('\n');
    expect(ts(code)).toEqual([]);
  });
});

describe('levels and suggestions', () => {
  it('turns features on by level, and own choices win', () => {
    expect(levelHas('off', 'syntaxErrors')).toBe(false);
    expect(levelHas('basic', 'names')).toBe(true);
    expect(levelHas('basic', 'unused')).toBe(false);
    expect(levelHas('standard', 'unused')).toBe(true);
    expect(levelHas('standard', 'inlineMessages')).toBe(false);
    expect(levelHas('full', 'inlineMessages')).toBe(true);
    const own = activeFeatures({ level: 'standard', overrides: { bracketColors: false, inlineMessages: true, unused: null } });
    expect(own.has('bracketColors')).toBe(false);
    expect(own.has('inlineMessages')).toBe(true);
    expect(own.has('unused')).toBe(true);
    expect(activeFeatures({ level: 'off', overrides: {} }).size).toBe(0);
  });

  it('measures typos with swapped letters as one edit', () => {
    expect(editDistance('cuont', 'count')).toBe(1);
    expect(editDistance('lenght', 'length')).toBe(1);
    expect(editDistance('abc', 'xyz', 1)).toBe(2);
    expect(suggest('Teller', ['teller', 'tall'])).toBe('teller');
    expect(suggest('xy', ['xz'])).toBe(null);
    // The user's own names win over built-ins at the same distance.
    expect(suggest('summ', ['sum', 'summen', 'sumx'], new Set(['sumx']))).toBe('sumx');
  });
});
