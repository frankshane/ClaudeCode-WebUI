import type { TranscriptEntry } from '../../../shared/protocol.ts';

export interface ToolResult {
  text: string;
  isError: boolean;
  images: number;
}

export interface ToolItem {
  id: string;
  name: string;
  input: any;
  result?: ToolResult;
  /** Transcript of the subagent this tool spawned (Agent/Task). */
  children: Item[];
}

export interface UserFile {
  name: string;
  chars: number;
}

export type Item =
  /** forkPoint: uuid of the last message before this prompt (null = it's the first). */
  | {
      kind: 'user';
      key: string;
      text: string;
      /** data: URLs of attached images ('' when the transcript only kept a placeholder). */
      images: string[];
      files: UserFile[];
      forkPoint: string | null;
    }
  | { kind: 'command'; key: string; name: string; args: string }
  | { kind: 'command-output'; key: string; text: string }
  | { kind: 'text'; key: string; text: string }
  | { kind: 'thinking'; key: string; text: string }
  | { kind: 'tool'; key: string; tool: ToolItem }
  | { kind: 'result'; key: string; entry: TranscriptEntry }
  | { kind: 'notice'; key: string; text: string; tone: 'muted' | 'warning' | 'error' };

const TOOL_USE_TYPES = new Set(['tool_use', 'server_tool_use', 'mcp_tool_use']);
const TOOL_RESULT_TYPES = new Set(['tool_result', 'web_search_tool_result', 'mcp_tool_result']);

/**
 * Turns raw transcript entries into render items. Messages carrying a
 * parent_tool_use_id belong to a subagent and are nested under that tool.
 */
export function buildItems(entries: TranscriptEntry[]): Item[] {
  const buckets = new Map<string | null, TranscriptEntry[]>();
  for (const e of entries) {
    const parent = e.parent_tool_use_id ?? null;
    let list = buckets.get(parent);
    if (!list) buckets.set(parent, (list = []));
    list.push(e);
  }

  const tools = new Map<string, ToolItem>();
  const build = (list: TranscriptEntry[], nested: boolean, prefix: string): Item[] => {
    const items: Item[] = [];
    let lastMessage: string | null = null;
    list.forEach((e, i) => {
      const key = e.uuid ?? `${prefix}${i}`;
      const forkPoint = lastMessage;
      if ((e.type === 'user' || e.type === 'assistant') && e.uuid) lastMessage = e.uuid;
      if (e.type === 'assistant') {
        const content = e.message?.content;
        if (typeof content === 'string') {
          if (content.trim()) items.push({ kind: 'text', key, text: content });
          return;
        }
        (content ?? []).forEach((b: any, j: number) => {
          const k = `${key}:${j}`;
          if (b.type === 'text' && b.text?.trim()) items.push({ kind: 'text', key: k, text: b.text });
          else if (b.type === 'thinking' && b.thinking?.trim()) items.push({ kind: 'thinking', key: k, text: b.thinking });
          else if (TOOL_USE_TYPES.has(b.type)) {
            const tool: ToolItem = { id: b.id, name: b.name, input: b.input ?? {}, children: [] };
            tools.set(b.id, tool);
            items.push({ kind: 'tool', key: b.id, tool });
          }
        });
        if (e.error && typeof e.error === 'string') items.push({ kind: 'notice', key: `${key}:err`, text: `API 错误：${e.error}`, tone: 'error' });
      } else if (e.type === 'user') {
        const content = e.message?.content;
        if (typeof content === 'string') {
          if (!nested) items.push(...userTextItems(content, key, !!e.isSynthetic, [], forkPoint));
          return;
        }
        const texts: string[] = [];
        const images: string[] = [];
        for (const b of content ?? []) {
          if (TOOL_RESULT_TYPES.has(b.type)) {
            const tool = tools.get(b.tool_use_id);
            if (tool) tool.result = toolResult(b);
          } else if (b.type === 'text') texts.push(b.text ?? '');
          else if (b.type === 'image') {
            images.push(b.source?.type === 'base64' ? `data:${b.source.media_type};base64,${b.source.data}` : '');
          }
        }
        if (!nested && (texts.length || images.length)) items.push(...userTextItems(texts.join('\n'), key, !!e.isSynthetic, images, forkPoint));
      } else if (e.type === 'result') {
        if (!nested) items.push({ kind: 'result', key, entry: e });
      } else if (e.type === 'system') {
        const item = systemItem(e, key);
        if (item) items.push(item);
      }
    });
    return items;
  };

  const main = build(buckets.get(null) ?? [], false, 'm');
  // Buckets appear in transcript order, so a subagent's own tools exist before its children are built.
  for (const [parent, list] of buckets) {
    if (parent === null) continue;
    const tool = tools.get(parent);
    if (tool) tool.children = build(list, true, `${parent}:`);
  }
  return main;
}

function toolResult(block: any): ToolResult {
  const content = block.content;
  let images = 0;
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    text = content
      .map((c: any) => {
        if (c.type === 'text') return c.text;
        if (c.type === 'image') images++;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  } else if (content != null) text = JSON.stringify(content, null, 2);
  return { text, isError: !!block.is_error, images };
}

/** Classifies a user text: real prompt, slash-command echo, command output, or noise to hide. */
/** How the server wraps a text-file attachment (see buildContent in server/src/live.ts). */
const ATTACHMENT_RE = /<attachment filename="([^"]*)">\n([\s\S]*?)\n<\/attachment>\n?/g;

function userTextItems(raw: string, key: string, synthetic: boolean, images: string[], forkPoint: string | null): Item[] {
  const files: UserFile[] = [];
  const text = raw
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(ATTACHMENT_RE, (_, name: string, body: string) => {
      files.push({ name, chars: body.length });
      return '';
    })
    .trim();
  if (!text && !images.length && !files.length) return [];
  if (text.startsWith('<local-command-caveat>')) return [];
  const cmd = text.match(/<command-name>([\s\S]*?)<\/command-name>/);
  if (cmd) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1] ?? '';
    return [{ kind: 'command', key, name: cmd[1].trim(), args: args.trim() }];
  }
  const out = text.match(/^<local-command-(stdout|stderr)>([\s\S]*?)<\/local-command-\1>$/);
  if (out) {
    const body = stripAnsi(out[2]).trim();
    return body ? [{ kind: 'command-output', key, text: body }] : [];
  }
  if (/^\[Request interrupted by user/.test(text)) return [{ kind: 'notice', key, text: '已中断', tone: 'muted' }];
  if (synthetic) return [];
  // A prompt typed as "/name args" (live echo; on disk it's stored in the <command-name> form above).
  const slash = !images.length && !files.length && text.match(/^\/([\w:.-]+)(?:\s+([\s\S]*))?$/);
  if (slash) return [{ kind: 'command', key, name: slash[1], args: slash[2]?.trim() ?? '' }];
  return [{ kind: 'user', key, text, images, files, forkPoint }];
}

function systemItem(e: any, key: string): Item | null {
  switch (e.subtype) {
    case 'compact_boundary':
      return { kind: 'notice', key, text: '— 上下文已压缩 —', tone: 'muted' };
    case 'local_command_output': {
      // Live, the CLI streams this output as assistant markdown; render the restored copy the same way.
      const text = stripAnsi(String(e.content ?? '')).trim();
      return text ? { kind: 'text', key, text } : null;
    }
    case 'informational':
      return e.content ? { kind: 'notice', key, text: e.content, tone: e.level === 'warning' ? 'warning' : 'muted' } : null;
    case 'notification':
      return e.text
        ? { kind: 'notice', key, text: e.text, tone: e.priority === 'high' || e.priority === 'immediate' ? 'warning' : 'muted' }
        : null;
    case 'api_retry': {
      const status = e.error_status ? `（${e.error_status}）` : '';
      const wait = Math.round((e.retry_delay_ms ?? 0) / 1000);
      return { kind: 'notice', key, text: `API 请求失败${status}，${wait} 秒后重试（第 ${e.attempt}/${e.max_retries} 次）`, tone: 'warning' };
    }
    case 'permission_denied':
      return { kind: 'notice', key, text: `已自动拒绝 ${e.tool_name}：${e.message}`, tone: 'warning' };
    case 'model_refusal_fallback':
    case 'model_refusal_no_fallback':
      return e.content ? { kind: 'notice', key, text: e.content, tone: 'warning' } : null;
    default:
      return null;
  }
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}
