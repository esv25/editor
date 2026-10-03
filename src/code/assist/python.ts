/**
 * Name analysis for Python (like pyflakes): scopes, where each name gets its
 * value and where it's used. Python's rules: assigning anywhere in a function
 * makes the name local to it, `global`/`nonlocal` move it, class bodies are
 * invisible to the methods inside them, and comprehensions have their own scope.
 */
import type { SyntaxNode, Tree } from '@lezer/common';
import { pythonBuiltins, pythonModules } from './globals';
import { newScope, type Analysis, type Binding, type BindingKind, type Issue, type Ref, type Scope } from './types';

interface Ctx {
  scope: Scope;
  /** Loops around the current position, inside the current function. */
  loops: readonly { from: number; to: number }[];
  inFunction: boolean;
}

interface PendingDef {
  ref: Ref;
  kind: BindingKind;
  at: number;
  /** `x := …` inside a comprehension belongs to the enclosing scope. */
  walrus?: boolean;
  extra?: Partial<Binding>;
}

const BRACKETS = new Set(['(', ')', '[', ']', '{', '}', ',', '*', '**', ':', '.']);
const TERMINATORS: Record<string, string> = {
  ReturnStatement: 'return',
  RaiseStatement: 'raise',
  BreakStatement: 'break',
  ContinueStatement: 'continue',
};

function children(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  // Comments can sit anywhere (even between a keyword argument and the comma before it).
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.name !== 'Comment') out.push(c);
  return out;
}

export interface PythonAnalysis extends Analysis {
  /** `from x import *` of a module we don't know: any name might exist. */
  unknownStar: boolean;
  /** Names from `from math import *` etc. */
  starNames: Set<string>;
}

class PythonWalker {
  refs: Ref[] = [];
  defs: PendingDef[] = [];
  issues: Issue[] = [];
  starNames = new Set<string>();
  unknownStar = false;
  private members: { object: Ref; from: number; to: number; name: string }[] = [];
  private fnCount = 0;
  readonly module: Scope;

  constructor(
    private text: string,
    length: number,
  ) {
    this.module = newScope('module', 0, length, null);
  }

  private t(node: SyntaxNode): string {
    return this.text.slice(node.from, node.to);
  }

  private ref(node: SyntaxNode, role: Ref['role'], ctx: Ctx, extra: Partial<Ref> = {}): Ref {
    const ref: Ref = { from: node.from, to: node.to, name: this.t(node), role, scope: ctx.scope, binding: null, loops: ctx.loops, ...extra };
    this.refs.push(ref);
    return ref;
  }

  private def(node: SyntaxNode, kind: BindingKind, at: number, ctx: Ctx, extra?: Partial<Binding>, walrus = false): Ref {
    const ref = this.ref(node, 'def', ctx);
    this.defs.push({ ref, kind, at, extra, walrus });
    return ref;
  }

  visitAll(nodes: SyntaxNode[], ctx: Ctx): void {
    for (const n of nodes) this.visit(n, ctx);
  }

  visit(node: SyntaxNode, ctx: Ctx): void {
    switch (node.name) {
      case 'VariableName': {
        const parent = node.parent;
        this.ref(node, 'read', ctx, { call: parent?.name === 'CallExpression' && parent.firstChild?.from === node.from });
        return;
      }
      case 'PropertyName':
      case 'String':
      case 'Number':
      case 'Comment':
        return;
      case 'Script':
      case 'Body':
        this.statements(node, ctx);
        return;
      case 'MemberExpression':
        this.member(node, ctx);
        return;
      case 'AssignStatement':
        this.assign(node, ctx);
        return;
      case 'UpdateStatement': {
        const [target, ...rest] = children(node);
        if (target.name === 'VariableName') {
          const ref = this.ref(target, 'readwrite', ctx);
          this.defs.push({ ref, kind: 'variable', at: node.to });
        } else this.visit(target, ctx);
        this.visitAll(rest, ctx);
        return;
      }
      case 'ForStatement':
        this.forStatement(node, ctx);
        return;
      case 'WhileStatement': {
        const loop = { ...ctx, loops: [...ctx.loops, { from: node.from, to: node.to }] };
        let afterElse = false;
        for (const c of children(node)) {
          if (c.name === 'else') afterElse = true;
          this.visit(c, afterElse ? ctx : loop);
        }
        return;
      }
      case 'WithStatement':
      case 'TryStatement': {
        let target = false;
        for (const c of children(node)) {
          if (c.name === 'as') target = true;
          else if (target) {
            this.target(c, ctx, c.to);
            target = false;
          } else this.visit(c, ctx);
        }
        return;
      }
      case 'FunctionDefinition':
        this.functionDef(node, ctx);
        return;
      case 'LambdaExpression':
        this.lambda(node, ctx);
        return;
      case 'ClassDefinition':
        this.classDef(node, ctx);
        return;
      case 'ArgList':
        this.argList(node, ctx);
        return;
      case 'ArrayComprehensionExpression':
      case 'ComprehensionExpression':
      case 'SetComprehensionExpression':
      case 'DictionaryComprehensionExpression':
        this.comprehension(children(node).slice(1, -1), ctx);
        return;
      case 'NamedExpression': {
        const [target, ...rest] = children(node);
        if (target.name === 'VariableName') this.def(target, 'variable', node.to, ctx, undefined, true);
        else this.visit(target, ctx);
        this.visitAll(rest, ctx);
        return;
      }
      case 'ImportStatement':
        this.importStatement(node, ctx);
        return;
      case 'ScopeStatement': {
        const global = node.firstChild?.name === 'global';
        for (const c of children(node)) {
          if (c.name !== 'VariableName') continue;
          const name = this.t(c);
          (global ? ctx.scope.globals : ctx.scope.nonlocals).add(name);
          this.ref(c, 'mention', ctx);
        }
        return;
      }
      case 'Decorator': {
        let afterDot = false;
        for (const c of children(node)) {
          if (c.name === 'VariableName' && afterDot) continue;
          afterDot = c.name === '.';
          this.visit(c, ctx);
        }
        return;
      }
      case 'ReturnStatement':
        if (!ctx.inFunction) this.statementError(node, '«return» kan bare brukes inne i en funksjon', 'return avslutter en funksjon og gir tilbake en verdi. Utenfor en funksjon er det ingenting å avslutte.');
        this.visitAll(children(node), ctx);
        return;
      case 'BreakStatement':
      case 'ContinueStatement':
        if (!ctx.loops.length) {
          const word = node.name === 'BreakStatement' ? 'break' : 'continue';
          this.statementError(node, `«${word}» kan bare brukes inne i en løkke`, `${word} hopper ${word === 'break' ? 'ut av' : 'videre i'} en for- eller while-løkke. Her står den utenfor en løkke.`);
        }
        return;
      case 'PrintStatement': {
        const keyword = node.firstChild!;
        const rest = this.text.slice(keyword.to, node.to).trim();
        this.issues.push({
          from: node.from,
          to: node.to,
          severity: 'error',
          feature: 'syntaxErrors',
          message: 'I Python 3 må print ha parenteser: print(…)',
          explanation: 'Gamle Python 2 skrev «print "hei"». I Python 3 er print en funksjon, så det som skal skrives ut, står i parenteser: «print("hei")».',
          fixes: [{ label: 'Legg til parenteser', changes: [{ from: node.from, to: node.to, insert: `print(${rest})` }] }],
        });
        this.visitAll(children(node).slice(1), ctx);
        return;
      }
      case 'MatchClause':
        for (const c of children(node)) {
          if (c.name === 'Guard' || c.name === 'Body' || c.name === 'case') this.visit(c, ctx);
          else this.pattern(c, ctx);
        }
        return;
      case 'TypeDefinition': {
        const name = node.getChild('VariableName');
        if (name) this.def(name, 'class', node.to, ctx);
        this.visitAll(children(node).filter((c) => c.from !== name?.from), ctx);
        return;
      }
      case 'BinaryExpression':
        this.binary(node, ctx);
        return;
      default:
        this.visitAll(children(node), ctx);
    }
  }

  private statementError(node: SyntaxNode, message: string, explanation: string): void {
    const kw = node.firstChild ?? node;
    this.issues.push({ from: kw.from, to: kw.to, severity: 'error', feature: 'syntaxErrors', message, explanation });
  }

  /** Statements of a body; code after return/raise/break/continue is unreachable. */
  private statements(node: SyntaxNode, ctx: Ctx): void {
    const stmts = children(node).filter((c) => c.name !== ':' && c.name !== 'Comment');
    let stop: string | null = null;
    let stopFrom = -1;
    for (const s of stmts) {
      this.visit(s, ctx);
      if (stop === null) {
        const word = TERMINATORS[s.name] ?? (s.name === 'StatementGroup' ? this.groupTerminator(s) : undefined);
        if (word) stop = word;
      } else if (stopFrom < 0 && !s.type.isError) stopFrom = s.from;
    }
    if (stop && stopFrom >= 0) {
      const last = stmts[stmts.length - 1];
      this.issues.push({
        from: stopFrom,
        to: last.to,
        severity: 'hint',
        feature: 'unreachable',
        markClass: 'cm-unreachable',
        message: `Koden kjøres aldri (den står etter «${stop}»)`,
        explanation: `Python hopper ut av blokka ved «${stop}», så linjene etter blir aldri kjørt. Flytt dem over, eller fjern dem.`,
      });
    }
  }

  private groupTerminator(group: SyntaxNode): string | undefined {
    for (const c of children(group)) if (TERMINATORS[c.name]) return TERMINATORS[c.name];
    return undefined;
  }

  private member(node: SyntaxNode, ctx: Ctx): void {
    const [object, ...rest] = children(node);
    this.visit(object, ctx);
    const objectRef = object.name === 'VariableName' ? this.refs[this.refs.length - 1] : null;
    for (const c of rest) {
      if (c.name === 'PropertyName') {
        if (objectRef) this.members.push({ object: objectRef, from: c.from, to: c.to, name: this.t(c) });
      } else this.visit(c, ctx);
    }
  }

  private assign(node: SyntaxNode, ctx: Ctx): void {
    const kids = children(node);
    let last = -1;
    kids.forEach((c, i) => {
      if (c.name === 'AssignOp') last = i;
    });
    kids.forEach((c, i) => {
      if (c.name === 'AssignOp') return;
      if (c.name === 'TypeDef' || (last >= 0 && i > last)) this.visit(c, ctx);
      else this.target(c, ctx, node.to);
    });
  }

  /** Something that gets a value: `x`, `a, b`, `[a, *b]`, `obj.x`, `items[0]`. */
  private target(node: SyntaxNode, ctx: Ctx, at: number): void {
    switch (node.name) {
      case 'VariableName':
        this.def(node, 'variable', at, ctx);
        return;
      case 'TupleExpression':
      case 'ArrayExpression':
      case 'ParenthesizedExpression':
        for (const c of children(node)) if (!BRACKETS.has(c.name)) this.target(c, ctx, at);
        return;
      default:
        if (!BRACKETS.has(node.name)) this.visit(node, ctx);
    }
  }

  private forStatement(node: SyntaxNode, ctx: Ctx): void {
    const loop = { ...ctx, loops: [...ctx.loops, { from: node.from, to: node.to }] };
    let mode: 'start' | 'target' | 'iter' | 'body' | 'else' = 'start';
    for (const c of children(node)) {
      if (c.name === 'for' && mode === 'start') mode = 'target';
      else if (c.name === 'in' && mode === 'target') mode = 'iter';
      else if (c.name === 'Body' && mode !== 'else') {
        mode = 'body';
        this.visit(c, loop);
      } else if (c.name === 'else') mode = 'else';
      else if (mode === 'target') this.target(c, ctx, c.to);
      else this.visit(c, mode === 'else' ? ctx : loop);
    }
  }

  private params(list: SyntaxNode, fnScope: Scope, outer: Ctx, inner: Ctx): void {
    const fn = ++this.fnCount;
    let index = 0;
    let isDefault = false;
    for (const c of children(list)) {
      if (isDefault) {
        this.visit(c, outer);
        isDefault = false;
        continue;
      }
      if (c.name === 'VariableName') {
        const name = this.t(c);
        const self = index === 0 && (name === 'self' || name === 'cls');
        this.def(c, 'parameter', fnScope.from, inner, { param: { fn, index }, keep: self || undefined });
        index++;
      } else if (c.name === 'AssignOp') isDefault = true;
      else if (c.name === 'TypeDef') this.visit(c, outer);
      else if (!BRACKETS.has(c.name) && c.name !== '/') this.visit(c, outer);
    }
  }

  private functionDef(node: SyntaxNode, ctx: Ctx): void {
    // `def f[T](x: T) -> T`: the type parameters are visible to the annotations too.
    const typeParams = node.getChild('TypeParamList');
    const outer: Ctx = typeParams ? { ...ctx, scope: newScope('function', node.from, node.to, ctx.scope) } : ctx;
    const fnScope = newScope('function', node.from, node.to, outer.scope);
    const inner: Ctx = { scope: fnScope, loops: [], inFunction: true };
    for (const c of children(node)) {
      if (c.name === 'VariableName') this.def(c, 'function', node.to, ctx, { keep: ctx.scope.kind === 'class' || undefined });
      else if (c.name === 'TypeParamList') {
        for (const p of c.getChildren('TypeParam')) {
          for (const part of children(p)) {
            if (part.name === 'VariableName') this.def(part, 'class', node.from, outer, { keep: true });
            else this.visit(part, outer);
          }
        }
      } else if (c.name === 'ParamList') this.params(c, fnScope, outer, inner);
      else if (c.name === 'Body') this.visit(c, inner);
      else this.visit(c, outer);
    }
  }

  private lambda(node: SyntaxNode, ctx: Ctx): void {
    const fnScope = newScope('function', node.from, node.to, ctx.scope);
    const inner: Ctx = { scope: fnScope, loops: [], inFunction: true };
    let body = false;
    for (const c of children(node)) {
      if (c.name === 'ParamList') this.params(c, fnScope, ctx, inner);
      else if (c.name === ':') body = true;
      else if (body) this.visit(c, inner);
    }
  }

  private classDef(node: SyntaxNode, ctx: Ctx): void {
    const classScope = newScope('class', node.from, node.to, ctx.scope);
    for (const c of children(node)) {
      if (c.name === 'VariableName') this.def(c, 'class', node.to, ctx, { keep: ctx.scope.kind === 'class' || undefined });
      else if (c.name === 'Body') this.visit(c, { scope: classScope, loops: [], inFunction: false });
      else this.visit(c, ctx);
    }
  }

  /** Call arguments: keyword names aren't references; `f(x for x in y)` is a comprehension. */
  private argList(node: SyntaxNode, ctx: Ctx): void {
    const kids = children(node).filter((c) => c.name !== '(' && c.name !== ')');
    // `f(x for k, v in items)`: a generator is the only argument, and its commas aren't separators.
    if (kids.some((c) => c.name === 'for')) return this.comprehension(kids, ctx);
    const segments: SyntaxNode[][] = [[]];
    for (const c of kids) {
      if (c.name === ',') segments.push([]);
      else segments[segments.length - 1].push(c);
    }
    for (let seg of segments) {
      if (seg[0]?.name === 'VariableName' && seg[1]?.name === 'AssignOp') {
        if (this.t(seg[1]) === ':=') this.def(seg[0], 'variable', seg[seg.length - 1].to, ctx, undefined, true);
        seg = seg.slice(2);
      }
      if (seg.some((c) => c.name === 'for')) this.comprehension(seg, ctx);
      else this.visitAll(seg, ctx);
    }
  }

  /** `element for target in iterable if condition …`, in a scope of its own. */
  private comprehension(nodes: SyntaxNode[], ctx: Ctx): void {
    if (!nodes.length) return;
    const scope = newScope('comprehension', nodes[0].from, nodes[nodes.length - 1].to, ctx.scope);
    const inner: Ctx = { ...ctx, scope };
    const firstFor = nodes.findIndex((c) => c.name === 'for');
    if (firstFor < 0) return this.visitAll(nodes, ctx);
    let mode: 'target' | 'iter' | 'cond' = 'target';
    let firstIter = true;
    for (const c of nodes.slice(firstFor)) {
      if (c.name === 'for') {
        if (mode !== 'target') firstIter = false;
        mode = 'target';
      } else if (c.name === 'in' && mode === 'target') mode = 'iter';
      else if (c.name === 'if') {
        if (mode === 'iter') firstIter = false;
        mode = 'cond';
      } else if (c.name === 'async') continue;
      else if (mode === 'target') this.target(c, inner, c.to);
      // The first iterable is evaluated outside (it matters in class bodies).
      else this.visit(c, mode === 'iter' && firstIter ? ctx : inner);
    }
    this.visitAll(nodes.slice(0, firstFor), inner);
  }

  private importStatement(node: SyntaxNode, ctx: Ctx): void {
    const kids = children(node);
    const bound: { node: SyntaxNode; module?: string }[] = [];
    if (kids[0]?.name === 'import') {
      // import a.b.c, d as e
      let dotted: SyntaxNode[] = [];
      let alias: SyntaxNode | null = null;
      let afterAs = false;
      const flush = () => {
        if (dotted.length) {
          const module = dotted.map((d) => this.t(d)).join('.');
          bound.push(alias ? { node: alias, module } : { node: dotted[0], module: this.t(dotted[0]) });
        }
        dotted = [];
        alias = null;
        afterAs = false;
      };
      for (const c of kids.slice(1)) {
        if (c.name === ',') flush();
        else if (c.name === 'as') afterAs = true;
        else if (c.name === 'VariableName') {
          if (afterAs) alias = c;
          else dotted.push(c);
        }
      }
      flush();
    } else {
      // from m import a, b as c   /   from m import *
      const importAt = kids.findIndex((c) => c.name === 'import');
      const module = this.text.slice(kids[0].to, importAt >= 0 ? kids[importAt].from : node.to).replace(/\s+/g, '');
      let pending: SyntaxNode | null = null;
      let afterAs = false;
      for (const c of kids.slice(importAt + 1)) {
        if (c.name === '*') {
          const names = pythonModules[module];
          if (names) for (const n of names) this.starNames.add(n);
          else this.unknownStar = true;
        } else if (c.name === 'as') afterAs = true;
        else if (c.name === 'VariableName') {
          if (afterAs) {
            pending = null;
            bound.push({ node: c });
            afterAs = false;
          } else {
            if (pending) bound.push({ node: pending });
            pending = c;
          }
        } else if (c.name === ',') {
          if (pending) bound.push({ node: pending });
          pending = null;
        }
      }
      if (pending) bound.push({ node: pending });
    }
    const statement = { from: node.from, to: node.to, only: bound.length === 1 };
    // `from __future__ import annotations` switches a feature on; nothing to use.
    const future = kids[0]?.name === 'from' && /^from\s+__future__\b/.test(this.t(node));
    for (const b of bound) this.def(b.node, 'import', node.to, ctx, { statement, module: b.module, keep: future || undefined });
  }

  /** match/case patterns: capture names get values, the rest are read. */
  private pattern(node: SyntaxNode, ctx: Ctx): void {
    switch (node.name) {
      case 'CapturePattern': {
        const name = node.getChild('VariableName');
        if (name && this.t(name) !== '_') this.def(name, 'variable', node.to, ctx);
        return;
      }
      case 'AsPattern': {
        const kids = children(node);
        this.pattern(kids[0], ctx);
        const name = kids[kids.length - 1];
        if (name.name === 'VariableName') this.def(name, 'variable', node.to, ctx);
        return;
      }
      case 'KeywordPattern':
        // `name=pattern`: the name is an attribute, not a variable.
        for (const c of children(node).slice(1)) this.pattern(c, ctx);
        return;
      case 'AttributePattern': {
        const first = node.firstChild;
        if (first?.name === 'VariableName') this.ref(first, 'read', ctx);
        return;
      }
      case 'LiteralPattern':
        return;
      case 'VariableName':
        this.ref(node, 'read', ctx);
        return;
      case 'OrPattern':
      case 'StarPattern':
      case 'SequencePattern':
      case 'MappingPattern':
      case 'ClassPattern':
      case 'PatternArgList':
        for (const c of children(node)) this.pattern(c, ctx);
        return;
      default:
        if (!BRACKETS.has(node.name) && node.name !== 'LogicOp') this.visit(node, ctx);
    }
  }

  /** `x is 5`: works by accident at best. */
  private binary(node: SyntaxNode, ctx: Ctx): void {
    const kids = children(node);
    const is = kids.find((c) => c.name === 'is');
    if (is) {
      const literal = kids.some((c) => c.name === 'Number' || c.name === 'String' || c.name === 'ContinuedString');
      if (literal) {
        const not = is.nextSibling?.name === 'not' ? is.nextSibling : null;
        const end = not ? not.to : is.to;
        this.issues.push({
          from: is.from,
          to: end,
          severity: 'warning',
          feature: 'tips',
          message: `Bruk ${not ? '!=' : '=='} for å sammenligne verdier`,
          explanation: '«is» sjekker om to ting er nøyaktig samme objekt, ikke om de har samme verdi. For tall og tekst gir det tilfeldige svar.',
          fixes: [{ label: `Bytt til ${not ? '!=' : '=='}`, changes: [{ from: is.from, to: end, insert: not ? '!=' : '==' }] }],
        });
      }
    }
    this.visitAll(kids, ctx);
  }

  // ---- Resolution ----

  /** The scope a definition belongs to (`global`/`nonlocal` move it). */
  private placeOf(d: PendingDef): Scope {
    let scope = d.ref.scope;
    if (d.walrus) while (scope.kind === 'comprehension' && scope.parent) scope = scope.parent;
    const name = d.ref.name;
    if (scope.globals.has(name)) return this.module;
    if (scope.nonlocals.has(name)) {
      for (let p = scope.parent; p; p = p.parent) if (p.kind === 'function' && p.names.has(name)) return p;
    }
    return scope;
  }

  private lookup(scope: Scope, name: string): Binding | null {
    if (scope.globals.has(name)) return this.module.names.get(name) ?? null;
    const own = scope.names.get(name);
    if (own) return own;
    // Names in enclosing class bodies aren't visible.
    for (let p = scope.parent; p; p = p.parent) {
      if (p.kind === 'class') continue;
      const b = p.names.get(name);
      if (b) return b;
    }
    return null;
  }

  finish(): PythonAnalysis {
    const bindings: Binding[] = [];
    const place = (d: PendingDef) => {
      const scope = this.placeOf(d);
      const name = d.ref.name;
      let b = scope.names.get(name);
      if (!b) {
        b = { name, kind: d.kind, scope, defs: [], reads: 0, ...d.extra };
        scope.names.set(name, b);
        bindings.push(b);
      } else if (d.extra?.keep) b.keep = true;
      b.defs.push({ from: d.ref.from, to: d.ref.to, at: d.at });
      d.ref.binding = b;
    };
    // nonlocal names point at definitions in enclosing functions, so those go first.
    const isNonlocal = (d: PendingDef) => d.ref.scope.nonlocals.has(d.ref.name);
    for (const d of this.defs) if (!isNonlocal(d)) place(d);
    for (const d of this.defs) if (isNonlocal(d)) place(d);

    for (const ref of this.refs) {
      if (ref.role === 'def') continue;
      const b = ref.role === 'mention' && ref.scope.globals.has(ref.name) ? this.module.names.get(ref.name) ?? null : this.lookup(ref.scope, ref.name);
      ref.binding = b;
      if (b && (ref.role === 'read' || ref.role === 'readwrite')) b.reads++;
    }

    // `math.sqroot`: modules we know everything in.
    for (const m of this.members) {
      const module = m.object.binding?.kind === 'import' ? m.object.binding.module : undefined;
      const names = module ? pythonModules[module] : undefined;
      if (!names || names.has(m.name)) continue;
      this.issues.push({
        from: m.from,
        to: m.to,
        severity: 'error',
        feature: 'names',
        message: `${module} har ikke noe som heter «${m.name}»`,
        explanation: `Modulen ${module} har ingen funksjon eller verdi med dette navnet. Sjekk stavemåten.`,
        candidates: names,
      });
    }

    this.refs.sort((a, b) => a.from - b.from);
    return {
      refs: this.refs,
      bindings,
      module: this.module,
      issues: this.issues,
      unknownStar: this.unknownStar,
      starNames: this.starNames,
    };
  }
}

export function analyzePython(tree: Tree, text: string): PythonAnalysis {
  const walker = new PythonWalker(text, tree.length);
  walker.visit(tree.topNode, { scope: walker.module, loops: [], inFunction: false });
  return walker.finish();
}

export function isPythonBuiltin(analysis: PythonAnalysis, name: string): boolean {
  return pythonBuiltins.has(name) || analysis.starNames.has(name);
}
