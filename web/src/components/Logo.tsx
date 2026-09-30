import { useId } from 'react';

/**
 * The Claude spark: blunt, round-tipped rays of uneven length around a small hub, like the Claude mark.
 * Drawn in code so it scales crisply and takes the accent color in both themes.
 */
const RAYS = [
  { angle: 0, length: 1, width: 1 },
  { angle: 31, length: 0.8, width: 0.94 },
  { angle: 60, length: 0.94, width: 1 },
  { angle: 92, length: 0.82, width: 0.95 },
  { angle: 123, length: 1, width: 1.02 },
  { angle: 153, length: 0.78, width: 0.92 },
  { angle: 183, length: 0.96, width: 1 },
  { angle: 213, length: 0.84, width: 0.96 },
  { angle: 243, length: 1, width: 1.02 },
  { angle: 274, length: 0.79, width: 0.93 },
  { angle: 304, length: 0.93, width: 1 },
  { angle: 333, length: 0.86, width: 0.96 },
];

const HUB_RADIUS = 6;

function ray(length: number, width: number): string {
  // A wedge from the hub out to a rounded tip, pointing up, in a 100×100 box centered on 0,0.
  const tip = 3 + 43 * length;
  const w = (5.4 * width).toFixed(2);
  const y = (5.4 * width - tip).toFixed(2);
  return `M -1.5 -3 L -${w} ${y} A ${w} ${w} 0 0 1 ${w} ${y} L 1.5 -3 Z`;
}

export function ClaudeMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="-50 -50 100 100" className={className} aria-hidden="true">
      <g fill="currentColor">
        <circle r={HUB_RADIUS} />
        {RAYS.map((r) => (
          <path key={r.angle} d={ray(r.length, r.width)} transform={`rotate(${r.angle})`} />
        ))}
      </g>
    </svg>
  );
}

// ---- wordmark ----

/*
 * "Claude Code" lettered as monoline strokes: rounded-square bowls, flat-cut ends.
 * Units: baseline at y = 0, ascender at y = -72; each stroke is centered on its path.
 */
const STROKE = 11;
const X_HEIGHT = 50;
const CAP_HEIGHT = 70;
const ASCENDER = 72;
const TRACKING = 7.5;
const WORD_SPACE = 26;
/** Corner radius as a share of half the bowl; 1 would make the bowls circles. */
const ROUNDNESS = 0.45;

const half = STROKE / 2;
const yTop = -X_HEIGHT + half;
const yBase = -half;
const yCap = -CAP_HEIGHT + half;
const bowlW = (X_HEIGHT - STROKE) * 1.08;
const bowlR = ((X_HEIGHT - STROKE) / 2) * ROUNDNESS;
const bowlAdvance = bowlW + STROKE;
const capW = (CAP_HEIGHT - STROKE) * 0.86;
const capR = (capW / 2) * ROUNDNESS;

/** Template tag for path data that rounds the interpolated numbers. */
const p = (s: TemplateStringsArray, ...v: number[]) => s.reduce((out, str, i) => out + str + (i < v.length ? +v[i].toFixed(2) : ''), '');

/** Each glyph takes its left edge and returns [path, advance]. Stems run to the outer edges so flat ends line up. */
const GLYPHS: Record<string, (x: number) => [string, number]> = {
  C: (x) => {
    const x0 = x + half, x1 = x0 + capW, r = capR;
    return [
      p`M ${x1} ${yCap + r} A ${r} ${r} 0 0 0 ${x1 - r} ${yCap} H ${x0 + r} A ${r} ${r} 0 0 0 ${x0} ${yCap + r}
        V ${yBase - r} A ${r} ${r} 0 0 0 ${x0 + r} ${yBase} H ${x1 - r} A ${r} ${r} 0 0 0 ${x1} ${yBase - r}`,
      capW + STROKE,
    ];
  },
  l: (x) => [p`M ${x + half} ${-ASCENDER} V 0`, STROKE],
  o: (x) => {
    const x0 = x + half, x1 = x0 + bowlW, r = bowlR;
    return [
      p`M ${x0 + r} ${yTop} H ${x1 - r} A ${r} ${r} 0 0 1 ${x1} ${yTop + r} V ${yBase - r} A ${r} ${r} 0 0 1 ${x1 - r} ${yBase}
        H ${x0 + r} A ${r} ${r} 0 0 1 ${x0} ${yBase - r} V ${yTop + r} A ${r} ${r} 0 0 1 ${x0 + r} ${yTop} Z`,
      bowlAdvance,
    ];
  },
  a: (x) => [stemBowl(x, X_HEIGHT), bowlAdvance],
  d: (x) => [stemBowl(x, ASCENDER), bowlAdvance],
  u: (x) => {
    const x0 = x + half, x1 = x0 + bowlW, r = bowlR;
    return [p`M ${x0} ${-X_HEIGHT} V ${yBase - r} A ${r} ${r} 0 0 0 ${x0 + r} ${yBase} H ${x1} M ${x1} ${-X_HEIGHT} V 0`, bowlAdvance];
  },
  e: (x) => {
    const x0 = x + half, x1 = x0 + bowlW, r = bowlR, mid = (yTop + yBase) / 2;
    return [
      p`M ${x0} ${mid} H ${x1} V ${yTop + r} A ${r} ${r} 0 0 0 ${x1 - r} ${yTop} H ${x0 + r} A ${r} ${r} 0 0 0 ${x0} ${yTop + r}
        V ${yBase - r} A ${r} ${r} 0 0 0 ${x0 + r} ${yBase} H ${x1}`,
      bowlAdvance,
    ];
  },
};

/** Bowl with its right side replaced by a stem rising to `height` (a, d). */
function stemBowl(x: number, height: number): string {
  const x0 = x + half, x1 = x0 + bowlW, r = bowlR;
  return p`M ${x1} ${yTop} H ${x0 + r} A ${r} ${r} 0 0 0 ${x0} ${yTop + r} V ${yBase - r} A ${r} ${r} 0 0 0 ${x0 + r} ${yBase} H ${x1}
    M ${x1} ${-height} V 0`;
}

function letter(word: string, start: number): { d: string; end: number } {
  let x = start;
  const parts: string[] = [];
  for (const ch of word) {
    const [d, advance] = GLYPHS[ch](x);
    parts.push(d.replace(/\s+/g, ' '));
    x += advance + TRACKING;
  }
  return { d: parts.join(' '), end: x - TRACKING };
}

const CLAUDE = letter('Claude', 0);
const CODE = letter('Code', CLAUDE.end + WORD_SPACE);
const CARET_X = CODE.end + TRACKING;

/** "Claude Code" as vector lettering; `caret` adds a blinking terminal underscore after it. */
export function Wordmark({ height = 18, caret = false, className = '' }: { height?: number; caret?: boolean; className?: string }) {
  const gradient = `wordmark${useId().replace(/[^\w-]/g, '')}`;
  const width = caret ? CARET_X + bowlAdvance : CODE.end;
  return (
    <svg
      width={(height * width) / ASCENDER}
      height={height}
      viewBox={`0 ${-ASCENDER} ${width} ${ASCENDER}`}
      className={`shrink-0 ${className}`}
      role="img"
      aria-label="Claude Code"
    >
      <defs>
        <linearGradient id={gradient} x1="0" x2="1">
          <stop offset="0" style={{ stopColor: 'var(--c-mark-from)' }} />
          <stop offset="1" style={{ stopColor: 'var(--c-mark-to)' }} />
        </linearGradient>
      </defs>
      <g fill="none" strokeWidth={STROKE} strokeLinejoin="miter">
        <path d={CLAUDE.d} stroke="currentColor" />
        <path d={CODE.d} stroke={`url(#${gradient})`} />
      </g>
      {caret && <rect className="caret-blink" x={CARET_X} y={-STROKE} width={bowlAdvance} height={STROKE} style={{ fill: 'var(--c-mark-to)' }} />}
    </svg>
  );
}

/** Mark + wordmark, as in the sidebar header. */
export function ClaudeCodeLogo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <ClaudeMark size={22} className="text-accent" />
      <Wordmark height={18} />
    </span>
  );
}
