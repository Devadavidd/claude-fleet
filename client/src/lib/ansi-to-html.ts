// Parses ANSI SGR (color/attribute) sequences from UNTRUSTED transcript text
// into safe styled runs. Only SGR (ESC[…m) is interpreted; every other escape
// (cursor moves, ESC[2J, OSC titles, …) is consumed and dropped so it can
// neither corrupt following text nor smuggle markup. The DOM layer emits text
// nodes + class-styled <span> only — never innerHTML.
//
// Split in two: parseAnsi() is pure (DOM-free, unit-testable) and returns runs;
// ansiToFragment() maps runs to a DocumentFragment.

const BASIC = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
const BRIGHT = BASIC.map((c) => `bright-${c}`);

interface AnsiState {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
}

/** One styled run: a slice of text plus the CSS classes active for it. */
export interface AnsiRun {
  text: string;
  classes: string[];
}

function freshState(): AnsiState {
  return { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false };
}

// 256-palette index → basic/bright name (only the first 16 map; the rest degrade
// to no color so following text is never mis-styled).
function name256(idx: number): string | null {
  if (idx >= 0 && idx < 8) return BASIC[idx];
  if (idx >= 8 && idx < 16) return BRIGHT[idx - 8];
  return null;
}

function applySgr(state: AnsiState, paramStr: string): void {
  const codes = paramStr.split(';').map((p) => (p === '' ? 0 : Number.parseInt(p, 10)));
  for (let k = 0; k < codes.length; k++) {
    const n = codes[k];
    if (Number.isNaN(n)) continue;
    if (n === 0) Object.assign(state, freshState());
    else if (n === 1) state.bold = true;
    else if (n === 2) state.dim = true;
    else if (n === 3) state.italic = true;
    else if (n === 4) state.underline = true;
    else if (n === 7) state.inverse = true;
    else if (n === 22) { state.bold = false; state.dim = false; }
    else if (n === 23) state.italic = false;
    else if (n === 24) state.underline = false;
    else if (n === 27) state.inverse = false;
    else if (n === 39) state.fg = null;
    else if (n === 49) state.bg = null;
    else if (n >= 30 && n <= 37) state.fg = BASIC[n - 30];
    else if (n >= 90 && n <= 97) state.fg = BRIGHT[n - 90];
    else if (n >= 40 && n <= 47) state.bg = BASIC[n - 40];
    else if (n >= 100 && n <= 107) state.bg = BRIGHT[n - 100];
    else if (n === 38 || n === 48) {
      // Extended color: consume its params so later codes are read correctly.
      const target = n === 38 ? 'fg' : 'bg';
      const mode = codes[k + 1];
      if (mode === 5) { state[target] = name256(codes[k + 2]); k += 2; }
      else if (mode === 2) { state[target] = null; k += 4; } // truecolor → degrade
      else state[target] = null;
    }
    // any other code: ignore
  }
}

function stateClasses(s: AnsiState): string[] {
  let fg = s.fg;
  let bg = s.bg;
  if (s.inverse) { const t = fg; fg = bg || 'term-bg'; bg = t || 'term-fg'; }
  const cls: string[] = [];
  if (fg) cls.push(`ansi-fg-${fg}`);
  if (bg) cls.push(`ansi-bg-${bg}`);
  if (s.bold) cls.push('ansi-bold');
  if (s.dim) cls.push('ansi-dim');
  if (s.italic) cls.push('ansi-italic');
  if (s.underline) cls.push('ansi-underline');
  return cls;
}

// A carriage return rewinds the cursor to column 0; a following write overwrites.
// Terminals show only the final state of such a line (progress bars). Keep the
// segment after the last CR (fall back to the last non-empty one for a bare
// trailing CR). Collapses docker/pip/npm progress spam to its final line.
export function collapseCarriageReturns(text: string): string {
  if (!text.includes('\r')) return text;
  return text.split('\n').map((line) => {
    if (!line.includes('\r')) return line;
    const segs = line.split('\r');
    return segs[segs.length - 1] || segs.filter(Boolean).pop() || '';
  }).join('\n');
}

// Pure: string → [{ text, classes: string[] }]. DOM-free for testing.
export function parseAnsi(text: string): AnsiRun[] {
  const runs: AnsiRun[] = [];
  const state = freshState();
  let buf = '';
  const flush = () => {
    if (buf) { runs.push({ text: buf, classes: stateClasses(state) }); buf = ''; }
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '\x1b') { buf += ch; continue; }
    const next = text[i + 1];
    if (next === '[') {
      // CSI: parameter/intermediate bytes until a final byte (0x40–0x7E).
      let j = i + 2;
      let params = '';
      while (j < text.length) {
        const code = text.charCodeAt(j);
        if (code >= 0x40 && code <= 0x7e) break;
        params += text[j];
        j++;
      }
      if (text[j] === 'm') { flush(); applySgr(state, params); }
      // else cursor/clear/etc. → drop the whole sequence
      i = j;
    } else if (next === ']') {
      // OSC: skip to string terminator — BEL (1 byte) or ST = ESC '\' (2 bytes).
      let j = i + 2;
      while (j < text.length && text[j] !== '\x07' && text[j] !== '\x1b') j++;
      if (text[j] === '\x1b' && text[j + 1] === '\\') j += 1; // consume the '\' of ST
      i = j;
    } else {
      // Lone ESC or a two-byte escape → drop ESC and its following byte.
      i += 1;
    }
  }
  flush();
  return runs;
}

export function ansiToFragment(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const run of parseAnsi(text)) {
    if (!run.classes.length) { frag.append(document.createTextNode(run.text)); continue; }
    const span = document.createElement('span');
    span.className = run.classes.join(' ');
    span.textContent = run.text; // untrusted → text only
    frag.append(span);
  }
  return frag;
}
