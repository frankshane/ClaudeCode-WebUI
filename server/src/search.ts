import { listSessions } from '@anthropic-ai/claude-agent-sdk';
import { readTranscript, sessionFiles } from './history.ts';
import type { SearchHit } from '../../shared/protocol.ts';

const SNIPPET_RADIUS = 60;
const MAX_SNIPPETS = 3;
const MAX_HITS = 50;

/** Full-text search over the user/assistant text of every session in `dir` (all projects when omitted). */
export async function searchSessions(dir: string | undefined, query: string): Promise<SearchHit[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const [sessions, files] = await Promise.all([listSessions({ dir, includeProgrammatic: true }), sessionFiles()]);
  const hits: SearchHit[] = [];
  for (const s of sessions) {
    const file = files.get(s.sessionId);
    if (!file) continue;
    const snippets = await searchFile(file, needle);
    if (snippets.length) hits.push({ sessionId: s.sessionId, snippets });
    if (hits.length >= MAX_HITS) break;
  }
  return hits;
}

async function searchFile(file: string, needle: string): Promise<SearchHit['snippets']> {
  const snippets: SearchHit['snippets'] = [];
  // Cheap prefilter on the raw line before paying for JSON.parse.
  for await (const entry of readTranscript(file, (line) => line.toLowerCase().includes(needle))) {
    if ((entry.type !== 'user' && entry.type !== 'assistant') || entry.isMeta) continue;
    for (const text of messageTexts(entry.message?.content)) {
      const at = text.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      const from = Math.max(0, at - SNIPPET_RADIUS);
      const to = Math.min(text.length, at + needle.length + SNIPPET_RADIUS);
      const prefix = from > 0 ? '…' : '';
      // Offsets are recomputed after whitespace collapsing.
      const start = prefix.length + text.slice(from, at).replace(/\s+/g, ' ').length;
      snippets.push({
        role: entry.type,
        text: prefix + text.slice(from, to).replace(/\s+/g, ' ') + (to < text.length ? '…' : ''),
        start,
        end: start + needle.length,
      });
      if (snippets.length >= MAX_SNIPPETS) return snippets;
    }
  }
  return snippets;
}

function messageTexts(content: unknown): string[] {
  if (typeof content === 'string') return isNoise(content) ? [] : [content];
  if (!Array.isArray(content)) return [];
  return content
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string' && !isNoise(b.text))
    .map((b: any) => b.text);
}

/** Harness-injected text that isn't really part of the conversation. */
function isNoise(text: string): boolean {
  return /^\s*<(system-reminder|local-command-caveat|command-name|local-command-stdout)/.test(text);
}
