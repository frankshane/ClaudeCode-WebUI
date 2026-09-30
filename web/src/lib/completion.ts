import type { FileMatch, SlashCommand } from '../../../shared/protocol.ts';

/** The token under the cursor that a popup can complete. */
export type Trigger =
  | { kind: 'slash'; query: string; start: number; end: number }
  | { kind: 'mention'; query: string; start: number; end: number };

export interface Suggestion {
  key: string;
  label: string;
  detail: string;
  hint?: string;
  badge?: string;
  /** Text that replaces the trigger token. */
  insert: string;
  /** Keep the popup open after inserting (descending into a directory). */
  keepOpen?: boolean;
}

/**
 * `/` only completes at the very start of the message (that's where the CLI
 * treats it as a command); `@` completes anywhere after whitespace.
 */
export function findTrigger(text: string, cursor: number): Trigger | null {
  const before = text.slice(0, cursor);
  const slash = before.match(/^\/([\w:.-]*)$/);
  if (slash) return { kind: 'slash', query: slash[1], start: 0, end: cursor };
  const mention = before.match(/(^|\s)@("?)([^\s"]*)$/);
  if (mention) {
    const start = cursor - mention[3].length - mention[2].length - 1;
    return { kind: 'mention', query: mention[3], start, end: cursor };
  }
  return null;
}

/** Commands the web UI replaces with its own controls (see handleLocalCommand in the store). */
const HANDLED_LOCALLY = new Set(['clear', 'new', 'model', 'effort']);

export function commandSuggestions(commands: SlashCommand[], terminalOnly: string[], query: string): Suggestion[] {
  const q = query.toLowerCase();
  const hidden = new Set(terminalOnly);
  const seen = new Set<string>();
  const scored: Array<[number, Suggestion]> = [];
  for (const c of commands) {
    if (hidden.has(c.name) || c.name.startsWith('__') || seen.has(c.name)) continue;
    // Tombstones the CLI keeps so old muscle memory gets a hint, e.g. "(removed) Ask Claude to…".
    if (/^\(removed\)/i.test(c.description)) continue;
    seen.add(c.name);
    const names = [c.name, ...(c.aliases ?? [])].map((n) => n.toLowerCase());
    const score = q ? Math.max(...names.map((n) => (n === q ? 3 : n.startsWith(q) ? 2 : n.includes(q) ? 1 : 0))) : 1;
    if (!score) continue;
    scored.push([
      score + (c.builtin ? 0 : 0.5),
      {
        key: c.name,
        label: `/${c.name}`,
        detail: c.description,
        hint: c.argumentHint || undefined,
        badge: c.builtin ? undefined : c.name.includes(':') ? '插件' : 'skill',
        insert: `/${c.name} `,
      },
    ]);
  }
  for (const name of HANDLED_LOCALLY) {
    if (seen.has(name) || (q && !name.startsWith(q))) continue;
    if (name === 'new' || name === 'clear') {
      scored.push([q === name ? 3 : 1.5, { key: name, label: `/${name}`, detail: '开始新对话', insert: `/${name}` }]);
    }
  }
  return scored
    .sort((a, b) => b[0] - a[0] || a[1].label.localeCompare(b[1].label))
    .map(([, s]) => s)
    .slice(0, 50);
}

export function fileSuggestions(files: FileMatch[]): Suggestion[] {
  return files.map((f) => {
    const quoted = /\s/.test(f.path) ? `"${f.path}"` : f.path;
    return {
      key: f.path,
      label: f.path,
      detail: '',
      badge: f.isDir ? '目录' : undefined,
      // Directories stay open so the user can keep drilling down.
      insert: f.isDir ? `@${f.path}` : `@${quoted} `,
      keepOpen: f.isDir,
    };
  });
}
