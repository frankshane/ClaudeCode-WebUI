import { FoldVertical } from 'lucide-react';
import type { ContextUsage } from '../../../shared/protocol.ts';
import { shortTokens } from '../lib/format.ts';
import { refreshContext, sendText, useStore } from '../lib/store.ts';
import { Dropdown, type Placement } from './Dropdown.tsx';

/** Chinese labels for the CLI's /context rows; unknown rows keep the CLI's name. */
const CATEGORY_LABELS: Record<string, string> = {
  'System prompt': '系统提示词',
  'System tools': '内置工具',
  'System tools (deferred)': '内置工具（按需加载）',
  'MCP tools': 'MCP 工具',
  'MCP tools (deferred)': 'MCP 工具（按需加载）',
  'Custom agents': '自定义 Agent',
  'Memory files': '记忆文件（CLAUDE.md）',
  Skills: 'Skills',
  Messages: '对话消息',
  'Free space': '剩余空间',
  'Autocompact buffer': '自动压缩预留',
  'Compact buffer': '压缩预留',
};

/** Colors for the "used" rows, in the order the CLI lists them. */
const PALETTE = ['var(--c-accent)', 'var(--c-plan)', 'var(--c-edit)', '#d4a24c', '#5b8def', '#c0748f', '#8b8a84'];

function label(name: string): string {
  return CATEGORY_LABELS[name] ?? name;
}

/** Warn early: the CLI auto-compacts near the window's end. */
function tone(pct: number): string {
  if (pct >= 90) return 'text-red-600 dark:text-red-400';
  if (pct >= 70) return 'text-amber-600 dark:text-amber-400';
  return 'text-muted';
}

export function ContextMeter({ placement }: { placement: Placement }) {
  const usage = useStore((s) => s.context);
  const busy = useStore((s) => s.live?.status === 'running' || s.live?.status === 'waiting');
  const hasMessages = useStore((s) => s.entries.some((e) => e.type === 'user'));
  if (!usage) return null;

  const pct = Math.max(0, Math.round(usage.percentage));
  return (
    <Dropdown
      placement={placement}
      align="right"
      className={`flex h-8 items-center gap-1 rounded-full px-2 text-xs tabular-nums transition-colors hover:bg-sunken ${tone(pct)}`}
      title={`上下文已用 ${pct}%`}
      panelClassName="w-80 max-w-[calc(100vw-2rem)]"
      onOpen={refreshContext}
      trigger={() => (
        <>
          <Ring pct={pct} />
          {pct}%
        </>
      )}
    >
      {(close) => (
        <Breakdown
          usage={usage}
          canCompact={hasMessages && !busy}
          onCompact={() => {
            close();
            sendText('/compact');
          }}
        />
      )}
    </Dropdown>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 6.5;
  const c = 2 * Math.PI * r;
  const filled = Math.min(pct, 100) / 100;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="-rotate-90" aria-hidden="true">
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--c-line)" strokeWidth="2.5" />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${c * filled} ${c}`}
        className="transition-[stroke-dasharray] duration-500"
      />
    </svg>
  );
}

function Breakdown({ usage, canCompact, onCompact }: { usage: ContextUsage; canCompact: boolean; onCompact: () => void }) {
  const max = usage.maxTokens || 1;
  // The CLI sizes "Messages" as last request's real usage minus its estimate of the fixed rows, so early
  // in a chat it rounds to ~1 token; rows that small are noise.
  const used = usage.categories.filter((c) => c.kind === 'used' && c.tokens >= 50);
  const reserved = usage.categories.filter((c) => c.kind === 'buffer' && c.tokens > 0);
  const free = usage.categories.find((c) => c.kind === 'free');
  const deferred = usage.categories.filter((c) => c.kind === 'deferred' && c.tokens > 0);
  const colorOf = (i: number) => PALETTE[i % PALETTE.length];
  const pct = (t: number) => `${((t / max) * 100).toFixed(t / max < 0.1 ? 1 : 0)}%`;

  return (
    <div>
      <div className="border-b border-line px-3 pt-2.5 pb-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold">上下文窗口</span>
          <span className="text-xs text-muted tabular-nums">
            {shortTokens(usage.totalTokens)} / {shortTokens(max)} · {Math.round(usage.percentage)}%
          </span>
        </div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-sunken">
          {used.map((c, i) => (
            <span key={c.name} style={{ width: `${(c.tokens / max) * 100}%`, background: colorOf(i) }} title={label(c.name)} />
          ))}
          {reserved.map((c) => (
            <span
              key={c.name}
              className="ml-auto"
              style={{
                width: `${(c.tokens / max) * 100}%`,
                background: 'repeating-linear-gradient(135deg, var(--c-line) 0 3px, transparent 3px 6px)',
              }}
              title={label(c.name)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-0.5 px-3 py-2 text-xs tabular-nums">
        {used.map((c, i) => (
          <Row key={c.name} color={colorOf(i)} name={label(c.name)} tokens={c.tokens} share={pct(c.tokens)} />
        ))}
        {reserved.map((c) => (
          <Row key={c.name} color="var(--c-faint)" striped name={label(c.name)} tokens={c.tokens} share={pct(c.tokens)} />
        ))}
        {free && <Row color="var(--c-line)" name={label(free.name)} tokens={free.tokens} share={pct(free.tokens)} muted />}
        {deferred.length > 0 && (
          <div className="pt-1 text-[0.6875rem] text-faint">
            另有 {deferred.map((c) => `${label(c.name)} ${shortTokens(c.tokens)}`).join('、')}，用到时才加载，不占窗口
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-3 py-2">
        <span className="flex-1 text-[0.6875rem] leading-snug text-faint">
          统计口径同终端里的 /context。快满时 Claude Code 会自动压缩，也可以现在手动压缩。
        </span>
        <button
          className="flex shrink-0 items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs transition-colors hover:bg-sunken disabled:opacity-50"
          disabled={!canCompact}
          title={canCompact ? '发送 /compact' : '等 Claude 空闲、且对话里有内容时可用'}
          onClick={onCompact}
        >
          <FoldVertical size={13} /> 压缩
        </button>
      </div>
    </div>
  );
}

function Row(props: { color: string; name: string; tokens: number; share: string; striped?: boolean; muted?: boolean }) {
  const { color, name, tokens, share, striped, muted } = props;
  return (
    <div className={`flex items-center gap-2 ${muted ? 'text-muted' : ''}`}>
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{ background: striped ? `repeating-linear-gradient(135deg, ${color} 0 2px, transparent 2px 4px)` : color }}
      />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span>{shortTokens(tokens)}</span>
      <span className="w-11 text-right text-muted">{share}</span>
    </div>
  );
}
