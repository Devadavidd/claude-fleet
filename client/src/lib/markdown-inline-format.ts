// Inline tokenizer for the markdown renderer: code spans first (they suppress
// other markup inside), then links, then emphasis. Builds text/element nodes
// only — never innerHTML — since the source markdown is untrusted file content.

// Inline tokenizer: code spans first (they suppress other markup inside),
// then links, then emphasis. Builds text/element nodes — no innerHTML.
export function appendInline(parent: HTMLElement, text: string): void {
  const codeSplit = text.split(/(`[^`]+`)/g);
  for (const chunk of codeSplit) {
    if (/^`[^`]+`$/.test(chunk)) {
      const code = document.createElement('code');
      code.className = 'md-inline-code';
      code.textContent = chunk.slice(1, -1);
      parent.append(code);
    } else {
      appendLinksAndEmphasis(parent, chunk);
    }
  }
}

function appendLinksAndEmphasis(parent: HTMLElement, text: string): void {
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(text)) !== null) {
    if (m.index > last) appendEmphasis(parent, text.slice(last, m.index));
    const href = m[2].trim();
    if (/^(https?:|\/|#|\.)/i.test(href)) {       // block javascript:/data: schemes
      const a = document.createElement('a');
      a.href = href;
      a.textContent = m[1];
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      parent.append(a);
    } else {
      appendEmphasis(parent, m[0]);
    }
    last = linkRe.lastIndex;
  }
  if (last < text.length) appendEmphasis(parent, text.slice(last));
}

function appendEmphasis(parent: HTMLElement, text: string): void {
  // Underscore emphasis requires non-word boundaries so identifiers like
  // spill_on_rate_limit are NOT italicised (GitHub's intra-word rule).
  const re = /(\*\*[^*]+\*\*|(?<![\w])__[^_]+__(?![\w])|\*[^*]+\*|(?<![\w])_[^_]+_(?![\w])|~~[^~]+~~)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parent.append(document.createTextNode(text.slice(last, m.index)));
    const tok = m[0];
    let el: HTMLElement;
    if (tok.startsWith('**') || tok.startsWith('__')) { el = document.createElement('strong'); el.textContent = tok.slice(2, -2); }
    else if (tok.startsWith('~~')) { el = document.createElement('del'); el.textContent = tok.slice(2, -2); }
    else { el = document.createElement('em'); el.textContent = tok.slice(1, -1); }
    parent.append(el);
    last = re.lastIndex;
  }
  if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
}
