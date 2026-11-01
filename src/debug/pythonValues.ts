/**
 * Python objects without their own `__repr__` show as
 * "<__main__.Hund object at 0x…>". Here they get a summary of their instance
 * variables instead: "Hund(navn='Fido', alder=3)", and the same objects inside
 * other values (lists, dicts) become "Node(…)".
 */

const OBJECT_REPR = /<(?:[\p{L}\p{N}_.]+\.)?([\p{L}_][\p{L}\p{N}_]*) object at 0x[0-9a-fA-F]+>/gu;

/** Python's default text for an object ("<__main__.Hund object at 0x…>"). */
export function isPlainObject(value: string): boolean {
  return new RegExp(`^${OBJECT_REPR.source}$`, 'u').test(value);
}

/** "[None, <__main__.Node object at 0x…>]" → "[None, Node(…)]". */
export function shortenObjects(value: string): string {
  return value.replace(OBJECT_REPR, '$1(…)');
}

/** What `summaryExpression` gives when it works (anything else is the object's own text). */
export function isSummary(value: string): boolean {
  return /^[\p{L}_][\p{L}\p{N}_]*\(/u.test(value);
}

/**
 * A Python expression whose value prints as "Klasse(felt=verdi, …)": the
 * instance variables (`vars`, so not the class variables), objects inside them
 * one level down too. Values are shortened with `reprlib` (long lists and
 * strings get "…"). The object is passed as an argument so names local to the
 * frame (`self`) work; the text comes from a throwaway object's `__repr__`,
 * since the debugger shows the repr of the result.
 */
export function summaryExpression(expression: string): string {
  const describe =
    "lambda f, o, d: type(o).__name__ + '(' + ', '.join(k + '=' + (f(f, v, d - 1) if d > 1 and type(v).__repr__ is object.__repr__ and hasattr(v, '__dict__') else r.repr(v)) for k, v in vars(o).items()) + ')'";
  const shortener = "(lambda r: (setattr(r, 'maxother', 200), r)[1])(__import__('reprlib').Repr())";
  return `(lambda o, r: type('', (), {'__repr__': lambda _: (lambda f: f(f, o, 2))(${describe})})())((${expression}), ${shortener})`;
}
