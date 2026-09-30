import type { EffortLevel, LiveStatus, PermissionMode } from '../../../shared/protocol.ts';

export function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} 天前`;
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Compact age for dense lists: 刚刚 / 5m / 3h / 2d / 2w / 3mo / 1y. */
export function shortTime(ms: number): string {
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

export function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

// ---- status line: mirrors Claude Code's spinner, e.g. "Cascading… (40s · ↓ 1.7k tokens)" ----

/** The CLI's spinner verbs; each turn shows one of them. */
export const SPINNER_VERBS = [
  'Accomplishing', 'Actioning', 'Actualizing', 'Architecting', 'Baking', 'Beaming', "Beboppin'", 'Befuddling',
  'Billowing', 'Blanching', 'Bloviating', 'Boogieing', 'Boondoggling', 'Booping', 'Bootstrapping', 'Brewing',
  'Bunning', 'Burrowing', 'Calculating', 'Canoodling', 'Caramelizing', 'Cascading', 'Catapulting', 'Cerebrating',
  'Channeling', 'Choreographing', 'Churning', 'Clauding', 'Coalescing', 'Cogitating', 'Combobulating', 'Composing',
  'Computing', 'Concocting', 'Considering', 'Contemplating', 'Cooking', 'Crafting', 'Creating', 'Crunching',
  'Crystallizing', 'Cultivating', 'Deciphering', 'Deliberating', 'Determining', 'Dilly-dallying', 'Discombobulating',
  'Doing', 'Doodling', 'Drizzling', 'Ebbing', 'Effecting', 'Elucidating', 'Embellishing', 'Enchanting', 'Envisioning',
  'Fermenting', 'Fiddle-faddling', 'Finagling', 'Flambéing', 'Flibbertigibbeting', 'Flowing', 'Flummoxing',
  'Fluttering', 'Forging', 'Forming', 'Frolicking', 'Frosting', 'Gallivanting', 'Galloping', 'Garnishing',
  'Generating', 'Gesticulating', 'Germinating', 'Gitifying', 'Grooving', 'Gusting', 'Harmonizing', 'Hashing',
  'Hatching', 'Herding', 'Honking', 'Hullaballooing', 'Hyperspacing', 'Ideating', 'Imagining', 'Improvising',
  'Incubating', 'Inferring', 'Infusing', 'Ionizing', 'Jitterbugging', 'Julienning', 'Kerfuffling', 'Kneading',
  'Leavening', 'Levitating', 'Lollygagging', 'Manifesting', 'Marinating', 'Meandering', 'Metamorphosing', 'Misting',
  'Moonwalking', 'Moseying', 'Mulling', 'Mustering', 'Musing', 'Nebulizing', 'Nesting', 'Newspapering', 'Noodling',
  'Nucleating', 'Onioning', 'Orbiting', 'Orchestrating', 'Osmosing', 'Perambulating', 'Percolating', 'Perusing',
  'Philosophizing', 'Photosynthesizing', 'Polishing', 'Pollinating', 'Pondering', 'Pontificating', 'Pouncing',
  'Precipitating', 'Prestidigitating', 'Processing', 'Proofing', 'Propagating', 'Puttering', 'Puzzling',
  'Quantumizing', 'Razzle-dazzling', 'Razzmatazzing', 'Recombobulating', 'Reticulating', 'Roosting', 'Ruminating',
  'Sautéing', 'Scampering', 'Schlepping', 'Scurrying', 'Seasoning', 'Shenaniganing', 'Shimmying', 'Simmering',
  'Skedaddling', 'Sketching', 'Slithering', 'Smooshing', 'Sock-hopping', 'Spelunking', 'Spinning', 'Sprouting',
  'Stewing', 'Sublimating', 'Swirling', 'Swooping', 'Symbioting', 'Synthesizing', 'Tempering', 'Thinking',
  'Thundering', 'Tinkering', 'Tomfoolering', 'Topsy-turvying', 'Transfiguring', 'Transmogrifying', 'Transmuting',
  'Twisting', 'Undulating', 'Unfurling', 'Unraveling', 'Vibing', 'Waddling', 'Wandering', 'Warping',
  'Whatchamacalliting', 'Whirlpooling', 'Whirring', 'Whisking', 'Wibbling', 'Working', 'Wrangling', 'Zesting',
  'Zigzagging',
];

/** Elapsed time as the CLI prints it: 15s, 1m 5s, 1h 2m 3s. */
export function cliDuration(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.floor(ms / 1000))}s`;
  let h = Math.floor(ms / 3_600_000);
  let m = Math.floor((ms % 3_600_000) / 60_000);
  let s = Math.round((ms % 60_000) / 1000);
  if (s === 60) (s = 0), m++;
  if (m === 60) (m = 0), h++;
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

const compactTokens = new Intl.NumberFormat('en-US', { notation: 'compact', minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Token counts as the CLI prints them: 230, 1.7k, 12.4k. */
export function cliTokens(n: number): string {
  return n >= 1000 ? compactTokens.format(n).toLowerCase() : String(n);
}

/** Token totals for the turn footer: 230, 41.6k, 1.2M (a capital M, so it can't be misread as minutes). */
export function shortTokens(n: number): string {
  if (n < 1000) return String(n);
  const [value, unit] = n < 999_950 ? [n / 1000, 'k'] : [n / 1_000_000, 'M'];
  return `${value.toFixed(1).replace(/\.0$/, '')}${unit}`;
}

/** The CLI's wording as one thinking block runs on. */
export function thinkingPhrase(ms: number): string {
  if (ms >= 45_000) return 'deep in thought';
  if (ms >= 30_000) return 'thinking some more';
  if (ms >= 20_000) return 'thinking more';
  if (ms >= 10_000) return 'still thinking';
  return 'thinking';
}

/** Last path segment, for compact project labels (handles both / and \). */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
};

/** Label for "no explicit effort": the CLI's own name for this is `/effort auto`. */
export const AUTO_EFFORT_LABEL = 'Auto';

export const EFFORT_HINTS: Record<EffortLevel | 'auto', string> = {
  auto: '使用模型默认值',
  low: '最快，适合简单任务',
  medium: '速度与质量均衡',
  high: '深入思考',
  xhigh: '更深入，适合难题',
  max: '最大投入，最慢',
};

export const ALL_EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export const MODE_LABELS: Partial<Record<PermissionMode, string>> = {
  default: '始终询问',
  acceptEdits: '自动接受编辑',
  auto: '自动模式',
  bypassPermissions: '完全权限',
  plan: '计划模式',
};

export const MODE_HINTS: Partial<Record<PermissionMode, string>> = {
  default: '修改文件、执行命令前都会征求你的同意',
  acceptEdits: '文件编辑直接生效，执行命令仍会询问',
  auto: '由分类器判断哪些操作需要你确认',
  bypassPermissions: '跳过所有确认，Claude 可直接改文件、执行命令',
  plan: '只读分析、先出方案，批准后才动手',
};

/**
 * Modes offered by the permission chip. Auto mode is left out: through third-party API gateways its
 * classifier requests aren't covered by Claude Code's current billing. Its label stays above for
 * sessions that still report it.
 */
export const PICKER_MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];

/**
 * Human label for a model id or alias: "claude-opus-5-5[1m]" → "Opus 5.5",
 * "claude-haiku-4-5-20251001" → "Haiku 4.5", "sonnet" → "Sonnet".
 * Strings that already look like display names are returned unchanged.
 */
export function prettyModel(raw: string | null | undefined): string {
  if (!raw) return '';
  if (/\s/.test(raw) || /^[A-Z]/.test(raw)) return raw;
  const id = raw.replace(/^claude-/, '').replace(/\[1m\]$/i, '').replace(/-\d{8}$/, '');
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  if (/^[a-z]+$/.test(id)) return cap(id);
  const m = id.match(/^([a-z]+)-(\d+(?:-\d+)*)$/);
  return m ? `${cap(m[1])} ${m[2].replace(/-/g, '.')}` : raw;
}

export const STATUS_LABELS: Record<LiveStatus, string> = {
  starting: '启动中',
  idle: '就绪',
  running: '运行中',
  waiting: '等待确认',
  closed: '进程已结束',
};
