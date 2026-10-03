/**
 * Typed shortcuts in the formula field: what you type → what it becomes.
 *
 * The defaults follow MathLive, AsciiMath and Obsidian's Latex Suite, with
 * a few Norwegian words (rot, grader, vinkel). Replacement happens as soon
 * as the last character is typed; the longest match wins, so «sin» becomes
 * «sinh» when an «h» follows. Backspace right after a replacement takes it
 * back. The value is a LaTeX template (`#?` empty spot, `#0` selection) or
 * '@sup' / '@sub' / '@frac'.
 *
 * Users add their own in `settings.math.shortcuts` (null removes a default).
 */
export const DEFAULT_SHORTCUTS: Record<string, string> = {
  // Relations and operators
  '**': '@sup',
  '<=': '\\le',
  '>=': '\\ge',
  '!=': '\\ne',
  '=/=': '\\ne',
  '~~': '\\approx',
  '+-': '\\pm',
  '-+': '\\mp',
  '->': '\\to',
  '<-': '\\leftarrow',
  '=>': '\\Rightarrow',
  '<==': '\\Leftarrow',
  '<=>': '\\Leftrightarrow',
  '...': '\\ldots',
  xx: '\\times',
  oo: '\\infty',
  inf: '\\infty',
  infty: '\\infty',

  // Functions (written upright)
  sin: '\\sin',
  cos: '\\cos',
  tan: '\\tan',
  cot: '\\cot',
  arcsin: '\\arcsin',
  arccos: '\\arccos',
  arctan: '\\arctan',
  sinh: '\\sinh',
  cosh: '\\cosh',
  tanh: '\\tanh',
  ln: '\\ln',
  log: '\\log',
  lg: '\\lg',
  exp: '\\exp',
  max: '\\max',
  min: '\\min',
  det: '\\det',
  lim: '\\lim_{#? \\to #?}',

  // Structures
  sqrt: '\\sqrt{#0}',
  rot: '\\sqrt{#0}',
  nrot: '\\sqrt[#?]{#0}',
  cbrt: '\\sqrt[3]{#0}',
  int: '\\int',
  dint: '\\int_{#?}^{#?}',
  sum: '\\sum_{#?}^{#?}',
  prod: '\\prod_{#?}^{#?}',
  abs: '\\left|#0\\right|',
  vec: '\\vec{#0}',
  bar: '\\overline{#0}',
  hat: '\\hat{#0}',
  binom: '\\binom{#?}{#?}',
  ddx: '\\frac{d}{dx}',

  // Greek letters
  alpha: '\\alpha',
  beta: '\\beta',
  gamma: '\\gamma',
  Gamma: '\\Gamma',
  delta: '\\delta',
  Delta: '\\Delta',
  epsilon: '\\varepsilon',
  zeta: '\\zeta',
  eta: '\\eta',
  theta: '\\theta',
  Theta: '\\Theta',
  kappa: '\\kappa',
  lambda: '\\lambda',
  Lambda: '\\Lambda',
  mu: '\\mu',
  pi: '\\pi',
  Pi: '\\Pi',
  rho: '\\rho',
  sigma: '\\sigma',
  Sigma: '\\Sigma',
  tau: '\\tau',
  phi: '\\varphi',
  Phi: '\\Phi',
  chi: '\\chi',
  psi: '\\psi',
  Psi: '\\Psi',
  omega: '\\omega',
  Omega: '\\Omega',

  // Number sets, geometry, logic
  RR: '\\mathbb{R}',
  NN: '\\mathbb{N}',
  ZZ: '\\mathbb{Z}',
  QQ: '\\mathbb{Q}',
  CC: '\\mathbb{C}',
  deg: '^{\\circ}',
  grader: '^{\\circ}',
  vinkel: '\\angle',
  perp: '\\perp',
  notin: '\\notin',
};

/** The defaults merged with the user's own (a null value removes a default). */
export function defaultShortcuts(user: Record<string, string | null> = {}): Map<string, string> {
  const map = new Map(Object.entries(DEFAULT_SHORTCUTS));
  for (const [trigger, value] of Object.entries(user)) {
    if (value === null) map.delete(trigger);
    else if (trigger) map.set(trigger, value);
  }
  return map;
}
