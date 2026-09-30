import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Check, ChevronDown, FolderOpen, FolderPlus, LoaderCircle, PanelLeftOpen, SquarePen, WifiOff, X } from 'lucide-react';
import type { LiveInfo } from '../../../shared/protocol.ts';
import { buildItems, type Item } from '../lib/transcript.ts';
import { baseName, cliDuration, cliTokens, SPINNER_VERBS, STATUS_LABELS, thinkingPhrase } from '../lib/format.ts';
import {
  addProject,
  currentMode,
  dismissNotice,
  isBlankChat,
  newChat,
  openSession,
  samePath,
  toggleSidebar,
  useProjectOptions,
  useStore,
} from '../lib/store.ts';
import { Composer } from './Composer.tsx';
import { Dropdown } from './Dropdown.tsx';
import { ClaudeMark, Wordmark } from './Logo.tsx';
import { OpenFolder } from './OpenFolder.tsx';
import { PermissionPanel } from './PermissionPanel.tsx';
import { sessionTitle } from './Sidebar.tsx';
import { DraftView, ItemList } from './Transcript.tsx';

export function ChatView() {
  const blank = useStore((s) => isBlankChat(s));
  return blank ? <StartPage /> : <Conversation />;
}

/** Shown in the pane's top-left corner when the sidebar is collapsed. */
function SidebarReopen() {
  const open = useStore((s) => s.sidebarOpen);
  if (open) return null;
  return (
    <div className="flex items-center gap-1">
      <button
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-sunken hover:text-fg"
        title="展开侧边栏"
        onClick={toggleSidebar}
      >
        <PanelLeftOpen size={17} />
      </button>
      <button
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-sunken hover:text-fg"
        title="新会话"
        onClick={() => newChat()}
      >
        <SquarePen size={16} />
      </button>
    </div>
  );
}

/** Blank chat: logo, title and a centered composer; sending from it starts the conversation. */
function StartPage() {
  const conn = useStore((s) => s.conn);
  const notice = useStore((s) => s.notice);
  const version = useStore((s) => s.meta?.claudeCodeVersion);
  return (
    <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="absolute top-3 left-3">
        <SidebarReopen />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6 pt-16 pb-[16vh]">
        <div className="fade-up @container w-full max-w-[46rem]">
          {/* Sized off the column width (cqw) so the big logo shrinks instead of overflowing narrow windows. */}
          <div className="mb-6 flex items-center justify-center gap-4">
            <ClaudeMark size={64} className="size-[min(64px,8.7cqw)] text-accent" />
            {/* The version hangs off the wordmark's top-right so the logo itself stays centered. */}
            <span className="relative">
              <Wordmark height={56} caret className="h-[min(56px,7.6cqw)] w-auto" />
              {version && (
                <span className="absolute top-0 left-full ml-2 rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 font-mono text-[0.6875rem] font-medium whitespace-nowrap text-accent-strong @max-[38rem]:hidden">
                  v{version}
                </span>
              )}
            </span>
          </div>

          <div className="mb-2 flex items-center gap-1 px-1">
            <ProjectPicker />
            <div className="flex-1" />
            {conn !== 'open' && <ConnBadge conn={conn} />}
          </div>
          {notice && <Notice text={notice} />}
          <BypassBanner />
          <Composer variant="hero" />
        </div>
      </div>
    </main>
  );
}

function ProjectPicker() {
  const cwd = useStore((s) => s.view?.cwd ?? null);
  const options = useProjectOptions();
  const [opening, setOpening] = useState(false);

  return (
    <Dropdown
      placement="bottom"
      className="flex h-8 max-w-80 items-center gap-1.5 rounded-lg px-2 text-sm font-medium transition-colors hover:bg-sunken"
      title={cwd ?? '选择项目文件夹'}
      panelClassName="w-96 max-w-[calc(100vw-2rem)]"
      // Reopening starts from the folder list, not from an OS folder dialog left over from last time.
      onOpen={() => setOpening(false)}
      trigger={() => (
        <>
          <FolderOpen size={16} className="shrink-0 text-accent" />
          <span className="truncate">{cwd ? baseName(cwd) : '选择项目文件夹'}</span>
          <ChevronDown size={13} className="shrink-0 text-muted" />
        </>
      )}
    >
      {(close) =>
        opening ? (
          <div className="p-3">
            <OpenFolder
              onOpen={(path) => {
                addProject(path);
                openSession(path, null);
                setOpening(false);
                close();
              }}
              onCancel={() => setOpening(false)}
            />
          </div>
        ) : (
          <div className="p-1">
            <div className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted">在哪个文件夹里开始？</div>
            <div className="scroll-thin max-h-72 overflow-y-auto">
              {options.map((p) => (
                <button
                  key={p}
                  className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sunken ${samePath(p, cwd) ? 'bg-sunken/60' : ''}`}
                  onClick={() => {
                    if (!samePath(p, cwd)) openSession(p, null);
                    close();
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{baseName(p)}</span>
                    <span className="block truncate font-mono text-[0.6875rem] text-muted">{p}</span>
                  </span>
                  <Check size={14} className={`mt-1 shrink-0 text-accent ${samePath(p, cwd) ? '' : 'invisible'}`} />
                </button>
              ))}
            </div>
            <div className="my-1 border-t border-line" />
            <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-sunken" onClick={() => setOpening(true)}>
              <FolderPlus size={14} className="text-muted" /> 打开其他文件夹…
            </button>
          </div>
        )
      }
    </Dropdown>
  );
}

function Conversation() {
  const view = useStore((s) => s.view)!;
  const live = useStore((s) => s.live);
  const entries = useStore((s) => s.entries);
  const draft = useStore((s) => s.draft);
  const pending = useStore((s) => s.pending);
  const conn = useStore((s) => s.conn);
  const notice = useStore((s) => s.notice);
  const title = useStore((s) => {
    const info = s.sessions?.find((x) => x.sessionId === s.view?.sessionId);
    return info ? sessionTitle(info) : null;
  });

  const items = useMemo(() => buildItems(entries), [entries]);
  const todo = useMemo(() => activeTodo(items), [items]);
  const running = live?.status === 'running' || live?.status === 'waiting';
  const loading = !view.liveId || !!view.reqId;

  // Stick to the bottom while the user hasn't scrolled up.
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items, draft, pending]);
  useLayoutEffect(() => {
    stick.current = true;
  }, [view.sessionId]);

  const status = live?.status ?? 'starting';
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 px-4">
        <SidebarReopen />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted">
            <FolderOpen size={15} className="text-accent/80" /> {baseName(view.cwd)}
          </span>
          {title && (
            <>
              <span className="text-faint">/</span>
              <span className="truncate text-sm font-medium">{title}</span>
            </>
          )}
        </div>
        {conn !== 'open' && <ConnBadge conn={conn} />}
        {status !== 'idle' && (
          <span
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              status === 'waiting'
                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                : status === 'running'
                  ? 'bg-accent/15 text-accent-strong'
                  : 'bg-sunken text-muted'
            }`}
          >
            {status !== 'closed' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
            {STATUS_LABELS[status]}
          </span>
        )}
      </header>

      <div
        ref={scroller}
        className="scroll-thin flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="mx-auto max-w-[46rem] space-y-3 px-5 pt-2 pb-6">
          {loading && entries.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
              <LoaderCircle size={16} className="animate-spin" /> 正在加载会话…
            </div>
          ) : (
            <ItemList items={items} running={running} editable={!!view.sessionId} />
          )}
          {draft && <DraftView draft={draft} />}
          {live && running && pending.length === 0 && <StatusLine live={live} todo={todo} />}
        </div>
      </div>

      <div className="relative mx-auto w-full max-w-[46rem] space-y-2 px-5 pb-5">
        <div className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-linear-to-t from-bg to-transparent" />
        {notice && <Notice text={notice} />}
        {live?.status === 'closed' && (
          <div className="text-center text-xs text-muted">Claude Code 进程已结束，发送消息会自动恢复这个会话。</div>
        )}
        <BypassBanner />
        {pending.length > 0 && <PermissionPanel key={pending[0].requestId} request={pending[0]} queued={pending.length - 1} />}
        <Composer />
      </div>
    </main>
  );
}

/**
 * Claude Code's spinner line, e.g. "Cascading… (40s · ↓ 1.7k tokens · thinking with xhigh effort)".
 * Same rules as the CLI: one verb per turn (or the in-progress todo), the clock appears once there is
 * something else to report or after 16s, and "thought for Ns" lingers 2s after a thinking block ends.
 */
function StatusLine({ live, todo }: { live: LiveInfo; todo?: string }) {
  const turn = useStore((s) => s.turn);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, []);

  const now = Date.now();
  // `??` keeps this working against a server that predates the turn clock.
  const started = live.turnStartedAt ?? null;
  const verb = todo ?? (started === null ? 'Working' : SPINNER_VERBS[started % SPINNER_VERBS.length]);
  const effort = live.effort ?? live.activeEffort;
  const thinking =
    turn.thinkingSince !== null
      ? `${thinkingPhrase(now - turn.thinkingSince)}${effort ? ` with ${effort} effort` : ''}`
      : turn.thought && now - turn.thought.endedAt < 2000
        ? `thought for ${Math.max(1, Math.round(turn.thought.ms / 1000))}s`
        : null;
  const tokens = Math.round(turn.chars / 4);
  const elapsed = started === null ? null : now - started - (live.turnPausedMs ?? 0);

  const details: string[] = [];
  if (elapsed !== null && (thinking || tokens > 0 || elapsed > 16_000)) details.push(cliDuration(elapsed));
  if (tokens > 0) details.push(`↓ ${cliTokens(tokens)} tokens`);
  if (thinking) details.push(thinking);

  return (
    <div className="flex min-w-0 items-center gap-2 font-mono text-[0.8125rem]">
      <ClaudeMark size={16} className="spark-working shrink-0 text-accent" />
      <span className="shimmer-text truncate font-medium">{verb.endsWith('…') ? verb : `${verb}…`}</span>
      {details.length > 0 && <span className="shrink-0 tabular-nums text-muted">({details.join(' · ')})</span>}
    </div>
  );
}

/** The in-progress todo's wording, which the CLI shows in place of the spinner verb. */
function activeTodo(items: Item[]): string | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind !== 'tool' || item.tool.name !== 'TodoWrite') continue;
    const todo = (item.tool.input?.todos ?? []).find((t: any) => t?.status === 'in_progress');
    return [todo?.activeForm, todo?.content].map((s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')).find(Boolean);
  }
  return undefined;
}

function BypassBanner() {
  const on = useStore((s) => currentMode(s) === 'bypassPermissions');
  if (!on) return null;
  return (
    <div className="mb-2 rounded-xl border border-red-500/25 bg-red-500/8 px-3 py-1.5 text-xs text-red-700 dark:text-red-300">
      完全权限已开启：Claude 会直接修改文件、执行命令，不再询问。只在你信任的项目里使用。
    </div>
  );
}

function ConnBadge({ conn }: { conn: string }) {
  return (
    <span className="flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
      <WifiOff size={13} /> {conn === 'connecting' ? '连接中' : '已断开，重连中'}
    </span>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="mb-2 flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/8 px-3 py-2 text-sm text-red-700 dark:text-red-300">
      <span className="flex-1 break-words">{text}</span>
      <button className="rounded p-0.5 opacity-70 transition-opacity hover:opacity-100" onClick={dismissNotice}>
        <X size={15} />
      </button>
    </div>
  );
}
