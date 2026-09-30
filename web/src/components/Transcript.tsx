import { useState, type ReactNode } from 'react';
import {
  Brain,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Circle,
  CircleDot,
  FileText,
  LoaderCircle,
  Pencil,
  Terminal,
  TriangleAlert,
} from 'lucide-react';
import type { ResultCost, TranscriptEntry } from '../../../shared/protocol.ts';
import { editFromMessage, type Draft } from '../lib/store.ts';
import { AGENT_TOOLS, describeTool } from '../lib/tools.ts';
import type { Item, ToolItem } from '../lib/transcript.ts';
import { duration, shortTokens } from '../lib/format.ts';
import { DiffView } from './DiffView.tsx';
import { Markdown } from './Markdown.tsx';

export function ItemList({ items, running, editable = false }: { items: Item[]; running: boolean; editable?: boolean }) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <ItemView key={item.key} item={item} running={running} editable={editable} />
      ))}
    </div>
  );
}

function ItemView({ item, running, editable }: { item: Item; running: boolean; editable: boolean }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="group flex items-start justify-end gap-1.5">
          {editable && !running && (
            <button
              className="mt-2 rounded-md p-1 text-muted opacity-0 transition-all hover:bg-sunken hover:text-fg group-hover:opacity-100"
              title="编辑并重新发送（在新分支里继续，原会话保留）"
              onClick={() => void editFromMessage(item.text, item.forkPoint)}
            >
              <Pencil size={14} />
            </button>
          )}
          <div className="flex max-w-[85%] flex-col items-end gap-1.5">
            {(item.images.length > 0 || item.files.length > 0) && (
              <div className="flex flex-wrap justify-end gap-1.5">
                {item.images.map((src, n) =>
                  src ? (
                    <a key={n} href={src} target="_blank" rel="noreferrer">
                      <img src={src} alt="" className="h-24 max-w-48 rounded-xl border border-line object-cover shadow-card transition-transform hover:scale-[1.02]" />
                    </a>
                  ) : (
                    <span key={n} className="rounded-lg bg-sunken px-2 py-1 text-xs text-muted">
                      [图片]
                    </span>
                  ),
                )}
                {item.files.map((f, n) => (
                  <span key={n} className="flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2 py-1 text-xs shadow-card">
                    <FileText size={13} className="text-muted" /> {f.name}
                  </span>
                ))}
              </div>
            )}
            {item.text && (
              <div className="whitespace-pre-wrap break-words rounded-[1.25rem] rounded-br-md bg-bubble px-4 py-2.5 text-[0.9375rem] leading-[1.7]">
                {item.text}
              </div>
            )}
          </div>
        </div>
      );
    case 'command':
      return (
        <div className="flex justify-end">
          <code className="rounded-lg border border-line bg-panel px-2 py-1 font-mono text-xs text-muted shadow-card">
            {item.name.startsWith('/') ? item.name : `/${item.name}`} {item.args}
          </code>
        </div>
      );
    case 'command-output':
      return <pre className="whitespace-pre-wrap rounded-xl border border-line bg-panel/60 px-3.5 py-2.5 font-mono text-xs leading-5 text-muted">{item.text}</pre>;
    case 'text':
      return <Markdown text={item.text} />;
    case 'thinking':
      return <Thinking text={item.text} />;
    case 'tool':
      if (item.tool.name === 'TodoWrite') return <TodoList todos={item.tool.input?.todos ?? []} />;
      return <ToolCard tool={item.tool} running={running} />;
    case 'result':
      return <ResultLine entry={item.entry} />;
    case 'notice':
      return (
        <div
          className={`whitespace-pre-wrap text-center text-xs ${
            item.tone === 'error'
              ? 'text-red-600 dark:text-red-400'
              : item.tone === 'warning'
                ? 'text-amber-700 dark:text-amber-400'
                : 'text-muted'
          }`}
        >
          {item.text}
        </div>
      );
  }
}

function Thinking({ text, live = false }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(live);
  return (
    <div className="text-sm text-muted">
      <button className="flex items-center gap-1.5 transition-colors hover:text-fg" onClick={() => setOpen(!open)}>
        <Brain size={14} className={live ? 'animate-pulse' : ''} />
        {live ? '思考中…' : '思考过程'}
        {text && (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
      </button>
      {open && text && (
        <div className="mt-1.5 whitespace-pre-wrap border-l-2 border-accent/25 pl-3 text-[0.8125rem] leading-relaxed">{text}</div>
      )}
    </div>
  );
}

function ResultLine({ entry }: { entry: TranscriptEntry }) {
  const e = entry as any;
  const ok = e.subtype === 'success' && !e.is_error;
  // Local slash commands (/context, /usage…) answer instantly; a footer is just noise.
  if (ok && e.local_command) return null;
  const tokens = turnTokens(e.usage);
  const parts: string[] = [];
  if (!ok) parts.push(errorLabel(e.subtype));
  if (tokens) parts.push(`输入 ${shortTokens(tokens.input)} · 输出 ${shortTokens(tokens.output)}`);
  if (typeof e.duration_ms === 'number') parts.push(duration(e.duration_ms));
  if (typeof e.num_turns === 'number') parts.push(`${e.num_turns} 轮`);
  const cost = turnCost(e);
  if (cost) parts.push(cost.label);
  if (parts.length === 0) parts.push('完成');
  const title = [tokens?.detail, cost?.detail].filter(Boolean).join('\n\n') || undefined;
  return (
    <div
      className={`flex items-center gap-1.5 text-xs tabular-nums ${ok ? 'text-faint' : 'text-red-600 dark:text-red-400'}`}
      title={title}
    >
      {ok ? <CircleCheck size={13} /> : <TriangleAlert size={13} />}
      {parts.join(' · ')}
      {!ok && Array.isArray(e.errors) && e.errors.length > 0 && <span className="truncate">— {e.errors.join('; ')}</span>}
    </div>
  );
}

/**
 * This turn's tokens from the result's `usage`, which the CLI zeroes at the start of each turn and sums over
 * every main-loop request in it (unlike total_cost_usd, which is cumulative). Input counts cached tokens too:
 * with caching on, `input_tokens` alone is often single digits.
 */
function turnTokens(usage: any): { input: number; output: number; detail: string } | null {
  if (!usage) return null;
  const n = (v: unknown) => (typeof v === 'number' && v > 0 ? v : 0);
  const fresh = n(usage.input_tokens);
  const written = n(usage.cache_creation_input_tokens);
  const read = n(usage.cache_read_input_tokens);
  const output = n(usage.output_tokens);
  const thinking = n(usage.output_tokens_details?.thinking_tokens);
  const input = fresh + written + read;
  if (input + output === 0) return null;
  const f = (v: number) => v.toLocaleString('en-US');
  const detail = [
    `输入 ${f(input)}：未缓存 ${f(fresh)} · 缓存写入 ${f(written)} · 缓存读取 ${f(read)}`,
    `输出 ${f(output)}${thinking ? `（其中思考 ${f(thinking)}）` : ''}`,
    '本轮所有请求合计，不含子 Agent',
  ].join('\n');
  return { input, output, detail };
}

/**
 * The server adds turn_cost_usd / session_cost_usd to live results (see ResultCost): the CLI's
 * total_cost_usd is a running total, so on its own it would repeat the whole session's spend.
 */
function turnCost(e: TranscriptEntry & ResultCost & { total_cost_usd?: number }): { label: string; detail: string } | null {
  const turn = e.turn_cost_usd;
  const total = e.session_cost_usd;
  if (typeof turn !== 'number' || typeof total !== 'number') {
    // Results recorded before the server started annotating them.
    return typeof e.total_cost_usd === 'number' && e.total_cost_usd > 0
      ? { label: `累计 ${usd(e.total_cost_usd)}`, detail: '会话累计费用（按 API 价格估算，不是账单）' }
      : null;
  }
  if (total <= 0) return null;
  const label = total - turn > 0.0005 ? `本轮 ${usd(turn)} · 累计 ${usd(total)}` : usd(turn);
  return {
    label,
    detail: '按 API 价格估算，不是账单（订阅账号登录时不按 token 扣费）\n累计：这个会话至今的总额，恢复的会话包含恢复前的轮次',
  };
}

function usd(v: number): string {
  if (v > 0 && v < 0.001) return '<$0.001';
  return '$' + v.toFixed(3);
}

function errorLabel(subtype: string): string {
  switch (subtype) {
    case 'error_max_turns':
      return '达到最大轮数';
    case 'error_during_execution':
      return '执行出错';
    case 'error_max_budget_usd':
      return '超出预算';
    default:
      return subtype || '出错';
  }
}

// ---- tool cards ----

function ToolCard({ tool, running }: { tool: ToolItem; running: boolean }) {
  const isAgent = AGENT_TOOLS.has(tool.name);
  const [open, setOpen] = useState(isAgent || tool.result?.isError === true);
  const { icon: Icon, label, detail } = describeTool(tool.name, tool.input);
  const state = tool.result ? (tool.result.isError ? 'error' : 'done') : running ? 'running' : 'stopped';

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel text-sm shadow-card">
      <button
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-sunken/40"
        onClick={() => setOpen(!open)}
      >
        <StatusIcon state={state} />
        <Icon size={15} className="shrink-0 text-muted" />
        <span className="shrink-0 font-medium">{label}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted/90">{detail}</span>
        {open ? <ChevronDown size={15} className="shrink-0 text-muted" /> : <ChevronRight size={15} className="shrink-0 text-muted" />}
      </button>
      {open && (
        <div className="space-y-2 border-t border-line/80 px-3 py-2.5">
          <ToolBody tool={tool} running={running} />
        </div>
      )}
    </div>
  );
}

function StatusIcon({ state }: { state: 'running' | 'done' | 'error' | 'stopped' }) {
  if (state === 'running') return <LoaderCircle size={15} className="shrink-0 animate-spin text-accent" />;
  if (state === 'done') return <CircleCheck size={15} className="shrink-0 text-green-600 dark:text-green-400" />;
  if (state === 'error') return <CircleX size={15} className="shrink-0 text-red-600 dark:text-red-400" />;
  return <Circle size={15} className="shrink-0 text-muted" />;
}

function ToolBody({ tool, running }: { tool: ToolItem; running: boolean }) {
  const i = tool.input ?? {};
  const r = tool.result;
  switch (tool.name) {
    case 'Bash':
    case 'PowerShell':
      return (
        <>
          <Pre>
            <span className="select-none text-muted">$ </span>
            {i.command}
          </Pre>
          {r && <Output result={r} />}
        </>
      );
    case 'Edit':
      return (
        <>
          <DiffView oldText={i.old_string ?? ''} newText={i.new_string ?? ''} />
          {r?.isError && <Output result={r} />}
        </>
      );
    case 'MultiEdit':
      return (
        <>
          {(i.edits ?? []).map((e: any, n: number) => (
            <DiffView key={n} oldText={e.old_string ?? ''} newText={e.new_string ?? ''} />
          ))}
          {r?.isError && <Output result={r} />}
        </>
      );
    case 'Write':
      return (
        <>
          <DiffView oldText="" newText={i.content ?? ''} />
          {r?.isError && <Output result={r} />}
        </>
      );
    case 'Agent':
    case 'Task':
      return (
        <>
          <Collapsible label="任务说明">
            <div className="whitespace-pre-wrap text-xs leading-relaxed text-muted">{i.prompt}</div>
          </Collapsible>
          {tool.children.length > 0 && (
            <div className="border-l-2 border-accent/20 pl-3">
              <ItemList items={tool.children} running={running && !r} />
            </div>
          )}
          {r && (r.isError ? <Output result={r} /> : <Markdown text={r.text} className="rounded-lg bg-sunken/60 px-3 py-2 dark:bg-bg/70" />)}
        </>
      );
    case 'ExitPlanMode':
      return (
        <>
          {typeof i.plan === 'string' && <Markdown text={i.plan} />}
          {r && <Output result={r} />}
        </>
      );
    case 'AskUserQuestion':
      return (
        <>
          {(i.questions ?? []).map((q: any, n: number) => (
            <div key={n}>
              <div className="font-medium">{q.question}</div>
              <div className="text-xs text-muted">{(q.options ?? []).map((o: any) => o.label).join(' / ')}</div>
            </div>
          ))}
          {r && <Output result={r} />}
        </>
      );
    default:
      return (
        <>
          <Pre>{JSON.stringify(i, null, 2)}</Pre>
          {r && <Output result={r} />}
        </>
      );
  }
}

function Output({ result }: { result: { text: string; isError: boolean; images: number } }) {
  if (!result.text && !result.images) return <div className="text-xs text-muted">（无输出）</div>;
  return (
    <>
      {result.text && <Pre error={result.isError}>{result.text}</Pre>}
      {result.images > 0 && <div className="text-xs text-muted">[{result.images} 张图片]</div>}
    </>
  );
}

function Pre({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <pre
      className={`scroll-thin max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-sunken/60 px-3 py-2 font-mono text-xs leading-5 dark:bg-bg/70 ${
        error ? 'text-red-700 dark:text-red-300' : ''
      }`}
    >
      {children}
    </pre>
  );
}

function Collapsible({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="flex items-center gap-1 text-xs text-muted transition-colors hover:text-fg" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {label}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

function TodoList({ todos }: { todos: Array<{ content: string; status: string; activeForm?: string }> }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm shadow-card">
      <div className="mb-1.5 text-xs font-medium tracking-wide text-muted">任务列表</div>
      <ul className="space-y-1">
        {todos.map((t, n) => (
          <li key={n} className="flex items-start gap-2">
            {t.status === 'completed' ? (
              <CircleCheck size={15} className="mt-0.5 shrink-0 text-green-600 dark:text-green-400" />
            ) : t.status === 'in_progress' ? (
              <CircleDot size={15} className="mt-0.5 shrink-0 text-accent" />
            ) : (
              <Circle size={15} className="mt-0.5 shrink-0 text-muted" />
            )}
            <span className={t.status === 'completed' ? 'text-muted line-through' : t.status === 'in_progress' ? 'font-medium' : ''}>
              {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- streaming ----

export function DraftView({ draft }: { draft: Draft }) {
  const blocks = draft.blocks.slice(draft.consumed).filter(Boolean);
  if (blocks.length === 0) return null;
  return (
    <div className="space-y-3">
      {blocks.map((b, n) =>
        b.type === 'text' ? (
          <Markdown key={n} text={b.text} />
        ) : b.type === 'thinking' ? (
          // Hidden thinking has no text to show; the status line below already says it's thinking.
          b.text ? <Thinking key={n} text={b.text} live /> : null
        ) : b.type === 'tool_use' || b.type === 'server_tool_use' ? (
          <div key={n} className="flex items-center gap-2 text-sm text-muted">
            <Terminal size={14} className="animate-pulse" />
            正在准备 {b.name ?? '工具调用'}…
          </div>
        ) : null,
      )}
    </div>
  );
}
