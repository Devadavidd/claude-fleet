// Lightweight, language-agnostic syntax highlighter. Not a full parser — it
// colors the four things that make code readable at a glance (comments,
// strings, numbers, a shared keyword set) and works "well enough" across the
// JS/TS/Python/Go/Rust/Java files agents actually edit. Builds spans via
// textContent, so file content stays untrusted-safe.

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'break', 'continue', 'class', 'extends', 'new', 'this', 'super',
  'import', 'export', 'from', 'default', 'async', 'await', 'yield', 'try', 'catch',
  'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void', 'null',
  'true', 'false', 'undefined', 'def', 'elif', 'lambda', 'pass', 'with', 'as', 'not',
  'and', 'or', 'None', 'True', 'False', 'self', 'func', 'type', 'struct', 'interface',
  'package', 'map', 'range', 'go', 'defer', 'chan', 'fn', 'let', 'mut', 'impl', 'pub',
  'use', 'match', 'enum', 'trait', 'public', 'private', 'protected', 'static', 'final',
  'void', 'int', 'string', 'bool', 'float',
]);

// Order matters: comment > string > number > word. Each alternative captures a
// full lexeme so we never split a string mid-token.
const TOKEN_RE = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_.eExXa-fA-F]*\b)|([A-Za-z_$][\w$]*)/g;

export function highlightCode(source: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(source)) !== null) {
    if (m.index > last) frag.append(document.createTextNode(source.slice(last, m.index)));
    // Capture groups don't all participate in a given match — the lib type
    // says `string`, but non-participating groups are `undefined` at runtime.
    const [full, comment, str, num, word] = m as unknown as [string, string?, string?, string?, string?];
    if (comment !== undefined) frag.append(span('tok-comment', full));
    else if (str !== undefined) frag.append(span('tok-string', full));
    else if (num !== undefined) frag.append(span('tok-number', full));
    else if (word !== undefined && KEYWORDS.has(word)) frag.append(span('tok-keyword', full));
    else frag.append(document.createTextNode(full));
    last = TOKEN_RE.lastIndex;
  }
  if (last < source.length) frag.append(document.createTextNode(source.slice(last)));
  return frag;
}

function span(cls: string, text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
}
