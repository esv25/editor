/**
 * Name analysis for JavaScript and TypeScript (like ESLint's no-undef and
 * no-unused-vars): `var` belongs to the function, let/const/class to the
 * block, function declarations and imports are hoisted, and TypeScript types
 * live in a namespace of their own (they only count as uses here).
 */
import type { SyntaxNode, Tree } from '@lezer/common';
import { newScope, type Analysis, type Binding, type BindingKind, type Issue, type Ref, type Scope } from './types';

interface Ctx {
  scope: Scope;
  /** Where `var` goes. */
  fnScope: Scope;
  /** Declarations here are exported or ambient (`declare`): never unused. */
  keep?: boolean;
  /** Inside a type: names there aren't values. */
  type?: boolean;
}

interface DeclOpts {
  kind: BindingKind;
  at: number;
  keep?: boolean;
  readonly?: boolean;
  lexical?: boolean;
  param?: { fn: number; index: number };
  statement?: Binding['statement'];
  /** 'value', 'type' or both (classes, enums, imports). */
  ns?: 'value' | 'type' | 'both';
}

const TERMINATORS: Record<string, string> = {
  ReturnStatement: 'return',
  ThrowStatement: 'throw',
  BreakStatement: 'break',
  ContinueStatement: 'continue',
};
const PUNCT = new Set(['(', ')', '[', ']', '{', '}', ',', ';', ':', '.', 'Spread', 'Optional', 'Equals']);

function children(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.name !== 'LineComment' && c.name !== 'BlockComment') out.push(c);
  return out;
}

export interface JsAnalysis extends Analysis {
  /** The file has JSX (an unused `React` import is fine then). */
  jsx: boolean;
}

class JsWalker {
  refs: Ref[] = [];
  bindings: Binding[] = [];
  issues: Issue[] = [];
  jsx = false;
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
    const ref: Ref = { from: node.from, to: node.to, name: this.t(node), role, scope: ctx.scope, binding: null, ...extra };
    this.refs.push(ref);
    return ref;
  }

  private declare(node: SyntaxNode, scope: Scope, ctx: Ctx, opts: DeclOpts): void {
    const name = this.t(node);
    const ns = opts.ns ?? 'value';
    const maps = ns === 'both' ? [scope.names, scope.types] : [ns === 'type' ? scope.types : scope.names];
    let b = maps[0].get(name);
    if (!b) {
      b = {
        name,
        kind: opts.kind,
        scope,
        defs: [],
        reads: 0,
        keep: opts.keep || ctx.keep || undefined,
        readonly: opts.readonly,
        lexical: opts.lexical,
        param: opts.param,
        statement: opts.statement,
      };
      for (const m of maps) m.set(name, b);
      this.bindings.push(b);
    }
    b.defs.push({ from: node.from, to: node.to, at: opts.at });
    const ref = this.ref(node, 'def', { ...ctx, scope });
    ref.binding = b;
  }

  private visitAll(nodes: SyntaxNode[], ctx: Ctx): void {
    for (const n of nodes) this.visit(n, ctx);
  }

  visit(node: SyntaxNode, ctx: Ctx): void {
    switch (node.name) {
      case 'VariableName': {
        const parent = node.parent;
        this.ref(node, 'read', ctx, { call: parent?.name === 'CallExpression' && parent.firstChild?.from === node.from });
        return;
      }
      case 'TypeName':
        this.ref(node, 'read', ctx, { type: true, quiet: true });
        return;
      case 'VariableDefinition':
      case 'PropertyName':
      case 'PropertyDefinition':
      case 'PrivatePropertyName':
      case 'PrivatePropertyDefinition':
      case 'Label':
      case 'String':
      case 'Number':
      case 'RegExp':
      case 'LineComment':
      case 'BlockComment':
        return;
      case 'Script':
        this.statements(children(node), ctx);
        return;
      case 'Block': {
        const scope = newScope('block', node.from, node.to, ctx.scope);
        this.statements(children(node), { ...ctx, scope, keep: false });
        return;
      }
      case 'SwitchBody': {
        const scope = newScope('block', node.from, node.to, ctx.scope);
        this.statements(children(node), { ...ctx, scope, keep: false });
        return;
      }
      case 'VariableDeclaration':
        this.variableDeclaration(node, ctx);
        return;
      case 'FunctionDeclaration': {
        const name = node.getChild('VariableDefinition');
        if (name) this.declare(name, ctx.scope, ctx, { kind: 'function', at: ctx.scope.from });
        this.fn(node, ctx, null, !node.getChild('Block'));
        return;
      }
      case 'FunctionExpression':
      case 'ArrowFunction':
        this.fn(node, ctx, node.getChild('VariableDefinition'));
        return;
      case 'PropertyDeclaration': {
        // Field initializers run when an object is made, like a method body.
        const scope = newScope('function', node.from, node.to, ctx.scope);
        this.visitAll(children(node), { scope, fnScope: scope });
        return;
      }
      case 'MethodDeclaration':
      case 'StaticBlock': {
        // Setters must take a value; abstract methods and overloads have no body to use them in.
        const kids = children(node);
        this.fn(node, ctx, null, kids.some((c) => c.name === 'set') || !kids.some((c) => c.name === 'Block'));
        return;
      }
      case 'Property': {
        const kids = children(node);
        if (kids.some((c) => c.name === 'ParamList')) this.fn(node, ctx, null, kids.some((c) => c.name === 'set'));
        else if (kids.length === 1 && kids[0].name === 'PropertyDefinition') this.ref(kids[0], 'read', ctx);
        else this.visitAll(kids, ctx);
        return;
      }
      case 'ClassDeclaration':
      case 'ClassExpression': {
        const name = node.getChild('VariableDefinition');
        const scope = newScope('block', node.from, node.to, ctx.scope);
        if (name && node.name === 'ClassDeclaration') {
          this.declare(name, ctx.scope, ctx, { kind: 'class', at: node.to, lexical: true, ns: 'both' });
        } else if (name) this.declare(name, scope, ctx, { kind: 'class', at: node.from, keep: true, ns: 'both' });
        this.typeParams(node, scope, ctx);
        const inner = { ...ctx, scope, keep: false };
        for (const c of children(node)) if (c.from !== name?.from && c.name !== 'TypeParamList') this.visit(c, inner);
        return;
      }
      case 'ImportDeclaration':
        this.importDeclaration(node, ctx);
        return;
      case 'ExportDeclaration':
        this.exportDeclaration(node, ctx);
        return;
      case 'ForStatement':
        this.forStatement(node, ctx);
        return;
      case 'CatchClause': {
        const scope = newScope('block', node.from, node.to, ctx.scope);
        const inner = { ...ctx, scope };
        for (const c of children(node)) {
          if (c.name === 'Block') this.statements(children(c), inner);
          else if (c.name === 'VariableDefinition' || c.name === 'ObjectPattern' || c.name === 'ArrayPattern') {
            this.declarePattern(c, scope, inner, { kind: 'variable', at: node.from, keep: true });
          } else this.visit(c, inner);
        }
        return;
      }
      case 'AssignmentExpression': {
        const [left, op, ...rest] = children(node);
        if (left.name === 'VariableName') this.ref(left, op?.name === 'Equals' ? 'write' : 'readwrite', ctx);
        else if (left.name === 'ObjectPattern' || left.name === 'ArrayPattern') this.assignPattern(left, ctx);
        else this.visit(left, ctx);
        this.visitAll(rest, ctx);
        return;
      }
      case 'PostfixExpression': {
        const [operand, op] = children(node);
        if (operand.name === 'VariableName' && op && /^(\+\+|--)$/.test(this.t(op))) this.ref(operand, 'readwrite', ctx);
        else this.visit(operand, ctx);
        return;
      }
      case 'UnaryExpression': {
        const [op, operand] = children(node);
        if (operand?.name === 'VariableName') {
          const word = this.t(op);
          if (word === 'typeof') return void this.ref(operand, 'read', ctx, { quiet: true });
          if (word === '++' || word === '--') return void this.ref(operand, 'readwrite', ctx);
        }
        this.visitAll(children(node), ctx);
        return;
      }
      case 'MemberExpression': {
        const [object, ...rest] = children(node);
        this.visit(object, ctx);
        this.visitAll(rest, ctx);
        return;
      }
      case 'ParenthesizedExpression': {
        const parent = node.parent?.name;
        const inner = node.firstChild?.nextSibling;
        if (inner?.name === 'AssignmentExpression' && inner.getChild('Equals') && (parent === 'IfStatement' || parent === 'WhileStatement' || parent === 'DoStatement')) {
          const eq = inner.getChild('Equals')!;
          this.issues.push({
            from: eq.from,
            to: eq.to,
            severity: 'warning',
            feature: 'tips',
            message: 'Mente du === ? (= gir en ny verdi)',
            explanation: 'Ett likhetstegn gir variabelen en ny verdi, så betingelsen blir alltid det du tilordner. For å sammenligne skriver du === .',
            fixes: [{ label: 'Bytt til ===', changes: [{ from: eq.from, to: eq.to, insert: '===' }] }],
          });
        }
        this.visitAll(children(node), ctx);
        return;
      }
      case 'TypeAliasDeclaration':
      case 'InterfaceDeclaration': {
        const name = node.getChild('TypeDefinition');
        if (name) this.declare(name, ctx.scope, ctx, { kind: 'type', at: ctx.scope.from, ns: 'type', keep: true });
        const scope = newScope('block', node.from, node.to, ctx.scope);
        this.typeParams(node, scope, ctx);
        for (const c of children(node)) if (c.from !== name?.from && c.name !== 'TypeParamList') this.visit(c, { ...ctx, scope, type: true });
        return;
      }
      case 'EnumDeclaration': {
        const name = node.getChild('TypeDefinition');
        if (name) this.declare(name, ctx.scope, ctx, { kind: 'constant', at: node.to, lexical: true, ns: 'both' });
        // Members can refer to each other by name (`B = A`).
        const body = node.getChild('EnumBody');
        const members = new Set(body ? body.getChildren('PropertyName').map((m) => this.t(m)) : []);
        const start = this.refs.length;
        for (const c of children(node)) if (c.from !== name?.from) this.visit(c, ctx);
        for (const r of this.refs.slice(start)) if (members.has(r.name)) r.quiet = true;
        return;
      }
      case 'NamespaceDeclaration': {
        const name = node.getChild('VariableDefinition');
        if (name) this.declare(name, ctx.scope, ctx, { kind: 'constant', at: ctx.scope.from, keep: true, ns: 'both' });
        for (const c of children(node)) if (c.from !== name?.from) this.visit(c, ctx);
        return;
      }
      case 'AmbientDeclaration':
        this.visitAll(children(node), { ...ctx, keep: true });
        return;
      case 'TypeAnnotation':
      case 'TypeArgList':
      case 'TypePredicate':
      case 'ObjectType':
        this.visitAll(children(node), { ...ctx, type: true });
        return;
      case 'TypeParamList':
        return;
      case 'JSXOpenTag':
      case 'JSXSelfClosingTag':
      case 'JSXCloseTag':
        this.jsx = true;
        for (const c of children(node)) {
          if (c.name === 'JSXIdentifier' && /^[A-Z_$]/.test(this.t(c))) this.ref(c, 'read', ctx);
          else if (c.name === 'JSXMemberExpression') {
            const first = c.firstChild;
            if (first?.name === 'JSXIdentifier') this.ref(first, 'read', ctx);
          } else if (c.name === 'JSXAttribute' || c.name === 'JSXSpreadAttribute') {
            for (const a of children(c)) if (a.name !== 'JSXIdentifier' && a.name !== 'JSXNamespacedName') this.visit(a, ctx);
          }
        }
        return;
      default:
        this.visitAll(children(node), ctx);
    }
  }

  /** Statements of a block; code after return/throw/break/continue is unreachable. */
  private statements(stmts: SyntaxNode[], ctx: Ctx): void {
    let stop: string | null = null;
    let run: { from: number; to: number } | null = null;
    const flush = () => {
      if (stop && run) {
        this.issues.push({
          from: run.from,
          to: run.to,
          severity: 'hint',
          feature: 'unreachable',
          markClass: 'cm-unreachable',
          message: `Koden kjøres aldri (den står etter «${stop}»)`,
          explanation: `Programmet hopper ut ved «${stop}», så det som står etter, blir aldri kjørt. Flytt det over, eller fjern det.`,
        });
      }
      run = null;
    };
    for (const s of stmts) {
      this.visit(s, ctx);
      if (s.name === 'CaseLabel' || s.name === 'DefaultLabel') {
        flush();
        stop = null;
        continue;
      }
      if (PUNCT.has(s.name) || s.type.isError || s.name === 'LineComment' || s.name === 'BlockComment') continue;
      if (stop) {
        // Function declarations are hoisted: they can still be used.
        if (s.name === 'FunctionDeclaration') flush();
        else run = run ? { from: run.from, to: s.to } : { from: s.from, to: s.to };
      } else if (TERMINATORS[s.name]) stop = TERMINATORS[s.name];
    }
    flush();
  }

  private variableDeclaration(node: SyntaxNode, ctx: Ctx): void {
    const kids = children(node);
    const word = kids.find((c) => ['let', 'var', 'const', 'using'].includes(c.name))?.name ?? 'let';
    const scope = word === 'var' ? ctx.fnScope : ctx.scope;
    const constant = word === 'const' || word === 'using';
    let pattern: SyntaxNode | null = null;
    let end = node.from;
    let init = false;
    const finish = () => {
      if (pattern) {
        this.declarePattern(pattern, scope, ctx, {
          kind: constant ? 'constant' : 'variable',
          at: word === 'var' ? scope.from : end,
          readonly: constant,
          lexical: word !== 'var',
        });
      }
      pattern = null;
      init = false;
    };
    for (const c of kids) {
      if (c.name === ',') finish();
      else if (c.name === 'Equals') init = true;
      else if (init) {
        this.visit(c, ctx);
        end = c.to;
      } else if (c.name === 'TypeAnnotation') {
        this.visit(c, ctx);
        end = c.to;
      } else if (c.name === 'VariableDefinition' || c.name === 'ObjectPattern' || c.name === 'ArrayPattern') {
        pattern = c;
        end = c.to;
      }
    }
    finish();
  }

  /** Declare the names in `x`, `{a, b: [c], ...d}`, `[e = 1]`. */
  private declarePattern(node: SyntaxNode, scope: Scope, ctx: Ctx, opts: DeclOpts): void {
    if (node.name === 'VariableDefinition') return this.declare(node, scope, ctx, opts);
    if (node.name !== 'ObjectPattern' && node.name !== 'ArrayPattern' && node.name !== 'PatternProperty') return this.visit(node, ctx);
    let isDefault = false;
    let computed = false;
    for (const c of children(node)) {
      if (isDefault) {
        this.visit(c, ctx);
        isDefault = false;
      } else if (c.name === 'Equals') isDefault = true;
      else if (c.name === '[' && node.name === 'PatternProperty') computed = true;
      else if (c.name === ']') computed = false;
      else if (computed) this.visit(c, ctx);
      else if (c.name === 'PropertyName' || PUNCT.has(c.name)) continue;
      else this.declarePattern(c, scope, ctx, opts);
    }
  }

  /** `({a, b} = obj)`, `[x, y] = [y, x]`: the names get new values. */
  private assignPattern(node: SyntaxNode, ctx: Ctx): void {
    let isDefault = false;
    for (const c of children(node)) {
      if (isDefault) {
        this.visit(c, ctx);
        isDefault = false;
      } else if (c.name === 'Equals') isDefault = true;
      else if (c.name === 'VariableDefinition') this.ref(c, 'write', ctx);
      else if (c.name === 'ObjectPattern' || c.name === 'ArrayPattern' || c.name === 'PatternProperty') this.assignPattern(c, ctx);
      else if (c.name !== 'PropertyName' && !PUNCT.has(c.name)) this.visit(c, ctx);
    }
  }

  private typeParams(node: SyntaxNode, scope: Scope, ctx: Ctx): void {
    const list = node.getChild('TypeParamList');
    if (!list) return;
    for (const c of children(list)) {
      if (c.name === 'TypeDefinition') this.declare(c, scope, ctx, { kind: 'type', at: scope.from, ns: 'type', keep: true });
      else this.visit(c, { ...ctx, scope, type: true });
    }
  }

  /** A function: its own scope, parameters, body. `ownName`: a function expression's name. */
  private fn(node: SyntaxNode, ctx: Ctx, ownName: SyntaxNode | null, keepParams = false): void {
    const scope = newScope('function', node.from, node.to, ctx.scope);
    const inner: Ctx = { scope, fnScope: scope };
    if (ownName) this.declare(ownName, scope, inner, { kind: 'function', at: scope.from, keep: true });
    this.typeParams(node, scope, inner);
    for (const c of children(node)) {
      if (c.name === 'ParamList') this.params(c, scope, inner, keepParams);
      else if (c.name === 'Block') this.statements(children(c), inner);
      else if (c.name === 'VariableDefinition' || c.name === 'TypeParamList') continue;
      else if (c.name === 'Decorator') this.visit(c, ctx);
      else this.visit(c, inner);
    }
  }

  private params(list: SyntaxNode, scope: Scope, ctx: Ctx, keepAll: boolean): void {
    const fn = ++this.fnCount;
    let index = 0;
    let isDefault = false;
    let property = false;
    for (const c of children(list)) {
      if (isDefault) {
        this.visit(c, ctx);
        isDefault = false;
      } else if (c.name === ',') {
        index++;
        property = false;
      } else if (c.name === 'Equals') isDefault = true;
      // `constructor(private x: number)` makes a class property.
      else if (c.name === 'Privacy' || c.name === 'readonly') property = true;
      else if (c.name === 'VariableDefinition' || c.name === 'ObjectPattern' || c.name === 'ArrayPattern') {
        this.declarePattern(c, scope, ctx, { kind: 'parameter', at: scope.from, param: { fn, index }, keep: keepAll || property });
      } else if (!PUNCT.has(c.name) && c.name !== 'this') this.visit(c, ctx);
    }
  }

  private importDeclaration(node: SyntaxNode, ctx: Ctx): void {
    const names: SyntaxNode[] = [];
    for (const c of children(node)) {
      if (c.name === 'VariableDefinition') names.push(c);
      else if (c.name === 'ImportGroup') names.push(...c.getChildren('VariableDefinition'));
    }
    const statement = { from: node.from, to: node.to, only: names.length === 1 };
    for (const n of names) {
      this.declare(n, this.module, ctx, { kind: 'import', at: this.module.from, readonly: true, statement, ns: 'both' });
    }
  }

  private exportDeclaration(node: SyntaxNode, ctx: Ctx): void {
    const exported = { ...ctx, keep: true };
    // `export { a } from './x'` passes names on from another module: nothing local is used.
    const reexport = children(node).some((c) => c.name === 'from');
    let afterAs = false;
    for (const c of children(node)) {
      if (c.name === 'as') afterAs = true;
      else if (c.name === 'VariableName' && afterAs) afterAs = false;
      else if (c.name === 'ExportGroup') {
        let alias = false;
        for (const e of children(c)) {
          if (e.name === 'as') alias = true;
          else if (e.name === 'VariableName') {
            if (!alias && !reexport) this.ref(e, 'read', ctx);
            alias = false;
          } else if (e.name === ',') alias = false;
        }
      } else this.visit(c, exported);
    }
  }

  private forStatement(node: SyntaxNode, ctx: Ctx): void {
    const scope = newScope('block', node.from, node.to, ctx.scope);
    const inner = { ...ctx, scope, keep: false };
    for (const c of children(node)) {
      if (c.name === 'ForInSpec' || c.name === 'ForOfSpec') {
        let word: string | null = null;
        let target = true;
        for (const s of children(c)) {
          if (['let', 'var', 'const', 'using'].includes(s.name)) word = s.name;
          else if (s.name === 'in' || s.name === 'of') target = false;
          else if (PUNCT.has(s.name)) continue;
          else if (target && word) {
            const constant = word === 'const' || word === 'using';
            this.declarePattern(s, word === 'var' ? ctx.fnScope : scope, inner, {
              kind: constant ? 'constant' : 'variable',
              at: s.to,
              readonly: constant,
              lexical: word !== 'var',
            });
          } else if (target && s.name === 'VariableName') this.ref(s, 'write', inner);
          else if (target && (s.name === 'ObjectPattern' || s.name === 'ArrayPattern')) this.assignPattern(s, inner);
          else this.visit(s, inner);
        }
      } else this.visit(c, inner);
    }
  }

  finish(): JsAnalysis {
    for (const ref of this.refs) {
      if (ref.role === 'def') continue;
      for (let s: Scope | null = ref.scope; s; s = s.parent) {
        const b = (ref.type ? s.types : s.names).get(ref.name);
        if (b) {
          ref.binding = b;
          if (ref.role !== 'write') b.reads++;
          break;
        }
      }
    }
    this.refs.sort((a, b) => a.from - b.from);
    return { refs: this.refs, bindings: this.bindings, module: this.module, issues: this.issues, jsx: this.jsx };
  }
}

export function analyzeJavaScript(tree: Tree, text: string): JsAnalysis {
  const walker = new JsWalker(text, tree.length);
  walker.visit(tree.topNode, { scope: walker.module, fnScope: walker.module });
  return walker.finish();
}
