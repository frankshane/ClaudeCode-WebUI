import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import type { TranscriptEntry } from '../../shared/protocol.ts';

const PROJECTS_DIR = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');

let fileIndex: { at: number; files: Map<string, string> } | null = null;

/** sessionId → transcript path, across every project dir. Rebuilt at most every 10s. */
export async function sessionFiles(): Promise<Map<string, string>> {
  if (fileIndex && Date.now() - fileIndex.at < 10_000) return fileIndex.files;
  const files = new Map<string, string>();
  const dirs = await readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    dirs
      .filter((d) => d.isDirectory())
      .map(async (d) => {
        const entries = await readdir(join(PROJECTS_DIR, d.name)).catch(() => [] as string[]);
        for (const name of entries) {
          if (name.endsWith('.jsonl')) files.set(name.slice(0, -6), join(PROJECTS_DIR, d.name, name));
        }
      }),
  );
  fileIndex = { at: Date.now(), files };
  return files;
}

/** Streams the JSON lines of a transcript file, skipping unparsable ones. */
export async function* readTranscript(file: string, prefilter?: (line: string) => boolean): AsyncGenerator<any> {
  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (prefilter && !prefilter(line)) continue;
      try {
        yield JSON.parse(line);
      } catch {
        // Partially written last line, etc.
      }
    }
  } finally {
    lines.close();
  }
}

/**
 * The running cost total the session file last saved (its latest `cost-state` record), or 0.
 * A resumed CLI continues its `total_cost_usd` from this value, so it is the baseline for
 * working out what the first resumed turn cost.
 */
export async function savedCostTotal(sessionId: string): Promise<number> {
  const file = (await sessionFiles()).get(sessionId);
  if (!file) return 0;
  let total = 0;
  for await (const e of readTranscript(file, (l) => l.includes('"cost-state"'))) {
    if (e.type === 'cost-state' && typeof e.totalCostUSD === 'number') total = e.totalCostUSD;
  }
  return total;
}

/**
 * The session transcript as the live stream would have shaped it.
 *
 * getSessionMessages() returns system entries as a bare `{type, uuid}`, so
 * their subtype and payload (slash-command output, compaction markers…) are
 * restored from the raw file here.
 */
export async function loadTranscript(sessionId: string, dir: string): Promise<TranscriptEntry[]> {
  const messages = (await getSessionMessages(sessionId, { dir, includeSystemMessages: true })) as TranscriptEntry[];
  if (!messages.some((m) => m.type === 'system')) return messages;

  const file = (await sessionFiles()).get(sessionId);
  if (!file) return messages;
  const raw = new Map<string, any>();
  for await (const e of readTranscript(file, (l) => l.includes('"type":"system"'))) {
    if (e.type === 'system' && e.uuid) raw.set(e.uuid, e);
  }
  const out: TranscriptEntry[] = [];
  for (const m of messages) {
    if (m.type !== 'system' || m.subtype) {
      out.push(m);
      continue;
    }
    const restored = m.uuid ? restoreSystem(raw.get(m.uuid)) : null;
    if (restored) out.push({ ...m, ...restored });
  }
  return out;
}

/** Maps an on-disk system entry to the live SDK message shape, or null to drop it. */
function restoreSystem(e: any): Partial<TranscriptEntry> | null {
  switch (e?.subtype) {
    case 'local_command': {
      const content = String(e.content ?? '').replace(/^<local-command-(stdout|stderr)>([\s\S]*)<\/local-command-\1>$/, '$2');
      return content.trim() ? { subtype: 'local_command_output', content } : null;
    }
    case 'compact_boundary':
      return { subtype: 'compact_boundary', compact_metadata: e.compactMetadata ?? e.compact_metadata };
    case 'informational':
      return { subtype: 'informational', content: e.content, level: e.level ?? 'info' };
    default:
      return null;
  }
}
