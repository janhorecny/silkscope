// Terminal branding: the Silkscope palette, the crawler mark and a few layout helpers.
// Truecolor when the terminal says it supports it, 256-colour otherwise; plain text when
// NO_COLOR is set or stdout is not a TTY (pipes, CI logs).

const env = process.env;
const color = !('NO_COLOR' in env) && (env.FORCE_COLOR || process.stdout.isTTY) && env.TERM !== 'dumb';
const truecolor = /truecolor|24bit/i.test(env.COLORTERM || '') || env.TERM_PROGRAM === 'iTerm.app' || env.TERM_PROGRAM === 'vscode' || env.WT_SESSION;

// brand/BRAND.md tokens, with the closest xterm-256 index as a fallback.
const PALETTE = {
  silk: ['#ECEEF4', 255], mist: ['#6B7385', 244], spinneret: ['#3FE0C0', 43], venom: ['#FF3D7F', 204],
  warn: ['#FFC23D', 214],
  prompt: ['#ECEEF4', 255], think: ['#16E2FB', 45], read: ['#399FED', 33], search: ['#B55AFE', 135],
  edit: ['#F2D747', 221], exec: ['#5FFCBD', 85], net: ['#E76245', 203], agent: ['#BDFF1D', 154],
};

const sgr = (open, close = '\x1b[0m') => (s) => (color ? `${open}${s}${close}` : String(s));
const fg = (name) => {
  const [hex, n] = PALETTE[name];
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return sgr(truecolor ? `\x1b[38;2;${r};${g};${b}m` : `\x1b[38;5;${n}m`, '\x1b[39m');
};

export const c = Object.fromEntries(Object.keys(PALETTE).map((k) => [k, fg(k)]));
export const bold = sgr('\x1b[1m', '\x1b[22m');
export const dim = sgr('\x1b[2m', '\x1b[22m');
// Clickable links (OSC 8) only where the terminal is known to support them; others get plain text.
export const link = (url, text = url) => (color && truecolor ? `\x1b]8;;${url}\x07${text}\x1b]8;;\x07` : text);

const SECTIONS = ['prompt', 'think', 'read', 'search', 'edit', 'exec', 'net', 'agent'];
export const spectrum = () => SECTIONS.map((s) => c[s]('■')).join(' ');

// The crawler, seen from above: cilia, shell, venom core. Three lines, nine columns wide.
export function mark() {
  const t = c.spinneret, v = c.venom;
  return [
    t(' ╲ ╲│╱ ╱ '),
    ` ${t('─(')}${v(' ◆ ')}${t(')─')} `, // padded by hand: padEnd would count the escape codes
    t(' ╱ ╱│╲ ╲ '),
  ];
}

// Mark on the left, lines of text on the right.
export function lockup(right) {
  const m = mark();
  const rows = Math.max(m.length, right.length);
  const out = [];
  for (let i = 0; i < rows; i++) out.push(`  ${i < m.length ? m[i] : ' '.repeat(9)}   ${right[i] ?? ''}`);
  return out.join('\n');
}

export const home = (p) => (env.HOME && p.startsWith(env.HOME) ? '~' + p.slice(env.HOME.length) : p);
export const row = (label, value) => `  ${dim(label.padEnd(10))}${value}`;
