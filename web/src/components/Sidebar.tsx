import { useState } from 'react';
import {
  ArrowDownWideNarrow,
  Check,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Ellipsis,
  EyeOff,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  GitFork,
  Moon,
  PanelLeftClose,
  Pencil,
  Search,
  SquarePen,
  Sun,
  Tag,
  Trash,
} from 'lucide-react';
import type { LiveInfo, SDKSessionInfo } from '../../../shared/protocol.ts';
import { baseName, shortTime } from '../lib/format.ts';
import {
  addProject,
  deleteSession,
  forkSession,
  hideProject,
  newChat,
  openSearch,
  openSession,
  renameSession,
  setAllCollapsed,
  setSortBy,
  tagSession,
  toggleCollapsed,
  samePath,
  toggleSidebar,
  unhideAllProjects,
  useFolders,
  useStore,
  type Folder,
} from '../lib/store.ts';
import { setTheme, useTheme } from '../lib/theme.ts';
import { Dropdown } from './Dropdown.tsx';
import { ClaudeCodeLogo } from './Logo.tsx';
import { OpenFolder } from './OpenFolder.tsx';

export function sessionTitle(s: SDKSessionInfo): string {
  return s.customTitle || s.summary || s.firstPrompt || '（无标题）';
}

/** Sessions shown per folder before "show more". */
const PAGE = 8;

const iconBtn = 'flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-sunken hover:text-fg';

/** The new-chat shortcut handled in App.tsx (Ctrl/⌘ + Shift + O), as this platform writes it. */
const NEW_CHAT_KEYS = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘⇧O' : 'Ctrl⇧O';

export function Sidebar() {
  const view = useStore((s) => s.view);
  const lives = useStore((s) => s.lives);
  const sessions = useStore((s) => s.sessions);
  const collapsed = useStore((s) => s.collapsed);
  const hiddenCount = useStore((s) => s.hiddenProjects.length);
  const sortBy = useStore((s) => s.sortBy);
  const folders = useFolders();
  const [opening, setOpening] = useState(false);

  const liveBySession = new Map<string, LiveInfo>(Object.values(lives).map((l) => [l.sessionId, l]));

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-side">
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <ClaudeCodeLogo />
        <button className={iconBtn} title="收起侧边栏" onClick={toggleSidebar}>
          <PanelLeftClose size={17} />
        </button>
      </div>

      {/* A card toned down at rest (see-through fill, faint border, no shadow) that fills in on hover. */}
      <div className="px-3">
        <button
          className="group/new flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-line/70 bg-panel/55 text-sm font-semibold text-fg/90 transition-all hover:border-accent/35 hover:bg-panel hover:text-fg hover:shadow-card active:scale-[0.99] dark:bg-panel/45 dark:hover:bg-panel"
          title={`新会话（${NEW_CHAT_KEYS}）`}
          onClick={() => newChat()}
        >
          <CirclePlus size={16} className="text-accent transition-transform duration-300 group-hover/new:rotate-90" /> 新会话
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between px-4 pb-1">
        <span className="text-xs font-medium tracking-wide text-muted">工作区</span>
        <div className="flex items-center">
          <button className={iconBtn} title="搜索会话（Ctrl+K）" onClick={openSearch}>
            <Search size={15} />
          </button>
          <Dropdown
            placement="bottom"
            align="right"
            className={iconBtn}
            title="排序与显示"
            panelClassName="w-52 p-1 text-sm"
            trigger={() => <ArrowDownWideNarrow size={15} />}
          >
            {(close) => (
              <>
                <div className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted">文件夹排序</div>
                <MenuRow checked={sortBy === 'recent'} onClick={() => (setSortBy('recent'), close())}>
                  最近使用
                </MenuRow>
                <MenuRow checked={sortBy === 'name'} onClick={() => (setSortBy('name'), close())}>
                  按名称
                </MenuRow>
                <div className="my-1 border-t border-line" />
                <MenuRow onClick={() => (setAllCollapsed(folders.map((f) => f.cwd), true), close())}>全部折叠</MenuRow>
                <MenuRow onClick={() => (setAllCollapsed([], false), close())}>全部展开</MenuRow>
                {hiddenCount > 0 && (
                  <MenuRow onClick={() => (unhideAllProjects(), close())}>显示已隐藏的文件夹（{hiddenCount}）</MenuRow>
                )}
              </>
            )}
          </Dropdown>
          <button className={iconBtn} title="打开文件夹" onClick={() => setOpening((o) => !o)}>
            <FolderPlus size={15} />
          </button>
        </div>
      </div>

      {opening && (
        <div className="mx-3 mb-2 rounded-xl border border-line bg-panel p-2.5 shadow-card">
          <OpenFolder
            onOpen={(path) => {
              addProject(path);
              setOpening(false);
              openSession(path, null);
            }}
            onCancel={() => setOpening(false)}
          />
        </div>
      )}

      <nav className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {sessions === null ? (
          <div className="px-3 py-2 text-sm text-muted">加载中…</div>
        ) : folders.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted">还没有会话。点右上方的文件夹图标打开一个项目目录。</div>
        ) : (
          folders.map((f) => (
            <FolderNode
              key={f.cwd}
              folder={f}
              open={!collapsed.some((p) => samePath(p, f.cwd))}
              activeSessionId={view && samePath(view.cwd, f.cwd) ? view.sessionId : undefined}
              blankHere={!!view && samePath(view.cwd, f.cwd) && !view.sessionId}
              liveBySession={liveBySession}
            />
          ))
        )}
      </nav>

      <div className="flex h-12 shrink-0 items-center border-t border-line px-3">
        <ThemeToggle />
      </div>
    </aside>
  );
}

function FolderNode(props: {
  folder: Folder;
  open: boolean;
  activeSessionId: string | null | undefined;
  blankHere: boolean;
  liveBySession: Map<string, LiveInfo>;
}) {
  const { folder, open, activeSessionId, blankHere, liveBySession } = props;
  const [limit, setLimit] = useState(PAGE);
  // A session that's open but not yet on disk (its first reply is still coming).
  const unsaved = !!activeSessionId && !folder.sessions.some((s) => s.sessionId === activeSessionId);
  const shown = folder.sessions.slice(0, limit);
  const busy = folder.sessions.some((s) => liveBySession.get(s.sessionId)?.status === 'running');

  return (
    <div className="mb-1">
      <div className="group flex h-9 items-center rounded-lg pr-1 transition-colors hover:bg-sunken/70">
        <button
          className="flex h-full min-w-0 flex-1 items-center gap-2 pl-2 text-left"
          title={folder.cwd}
          onClick={() => toggleCollapsed(folder.cwd)}
        >
          {open ? (
            <FolderOpen size={17} className="shrink-0 text-accent" />
          ) : (
            <FolderIcon size={17} className="shrink-0 text-accent" />
          )}
          <span className="truncate text-sm font-medium text-fg/90">{baseName(folder.cwd)}</span>
          {busy && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />}
        </button>
        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
          <button className={iconBtn} title="在此文件夹新建会话" onClick={() => newChat(folder.cwd)}>
            <SquarePen size={14} />
          </button>
          <Dropdown
            placement="bottom"
            align="right"
            className={iconBtn}
            title="更多"
            panelClassName="w-44 p-1 text-sm"
            trigger={() => <Ellipsis size={15} />}
          >
            {(close) => (
              <>
                <MenuRow icon={SquarePen} onClick={() => (newChat(folder.cwd), close())}>
                  新建会话
                </MenuRow>
                <MenuRow icon={EyeOff} onClick={() => (hideProject(folder.cwd), close())}>
                  从列表中隐藏
                </MenuRow>
              </>
            )}
          </Dropdown>
          <button className={iconBtn} title={open ? '折叠' : '展开'} onClick={() => toggleCollapsed(folder.cwd)}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-0.5 space-y-0.5">
          {(blankHere || unsaved) && (
            <SessionRow title="新会话" active live={unsaved ? liveBySession.get(activeSessionId!) : undefined} />
          )}
          {shown.map((s) => (
            <SessionRow
              key={s.sessionId}
              session={s}
              title={sessionTitle(s)}
              time={s.lastModified}
              active={activeSessionId === s.sessionId}
              live={liveBySession.get(s.sessionId)}
              onClick={() => openSession(folder.cwd, s.sessionId)}
            />
          ))}
          {folder.sessions.length > limit && (
            <button
              className="w-full rounded-lg py-1.5 pl-9 text-left text-xs text-muted transition-colors hover:bg-sunken/70 hover:text-fg"
              onClick={() => setLimit((l) => l + 20)}
            >
              显示更多（还有 {folder.sessions.length - limit} 个）
            </button>
          )}
        </div>
      )}
    </div>
  );
}

type RowMode = 'rename' | 'tag' | 'delete' | null;

function SessionRow(props: {
  session?: SDKSessionInfo;
  title: string;
  time?: number;
  active: boolean;
  live?: LiveInfo;
  onClick?: () => void;
}) {
  const { session, title, time, active, live, onClick } = props;
  const [mode, setMode] = useState<RowMode>(null);
  const status = live?.status;

  if (session && (mode === 'rename' || mode === 'tag')) {
    return (
      <InlineInput
        label={mode === 'rename' ? '重命名' : '标签（留空则清除）'}
        initial={mode === 'rename' ? title : (session.tag ?? '')}
        allowEmpty={mode === 'tag'}
        onCancel={() => setMode(null)}
        onSave={(value) => {
          setMode(null);
          if (mode === 'rename') void renameSession(session.sessionId, value);
          else void tagSession(session.sessionId, value || null);
        }}
      />
    );
  }

  if (session && mode === 'delete') {
    return (
      <div className="mx-1 space-y-2 rounded-xl border border-red-500/35 bg-red-500/5 px-3 py-2.5">
        <div className="text-sm">
          删除「<span className="font-medium">{title}</span>」？
          <div className="text-xs text-muted">会删除磁盘上的对话记录，无法恢复。</div>
        </div>
        <div className="flex gap-1.5">
          <button
            className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white shadow-sm transition-colors hover:bg-red-700"
            onClick={() => {
              setMode(null);
              void deleteSession(session.sessionId);
            }}
          >
            删除
          </button>
          <button className="rounded-md border border-line bg-panel px-2.5 py-1 text-xs transition-colors hover:bg-sunken" onClick={() => setMode(null)}>
            取消
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-session={session?.sessionId}
      className={`group flex h-9 cursor-pointer items-center gap-2 rounded-lg pr-1 pl-9 transition-colors ${
        active
          ? 'bg-panel font-medium text-fg shadow-card ring-1 ring-line/70 dark:bg-sunken dark:ring-transparent'
          : 'text-fg/85 hover:bg-sunken/70'
      }`}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
    >
      <span className="min-w-0 flex-1 truncate text-sm" title={title}>
        {title}
      </span>
      {session?.tag && (
        <span className="max-w-16 shrink-0 truncate rounded-full bg-accent/12 px-1.5 text-[0.6875rem] leading-4 font-medium text-accent-strong">
          {session.tag}
        </span>
      )}
      {(status === 'running' || status === 'waiting') && (
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${status === 'waiting' ? 'bg-amber-500' : 'animate-pulse bg-accent'}`}
          title={status === 'waiting' ? '等待你确认' : '运行中'}
        />
      )}
      {time !== undefined && (
        <span className={`shrink-0 text-[0.6875rem] font-normal tabular-nums text-faint ${session ? 'group-hover:hidden' : ''}`}>{shortTime(time)}</span>
      )}
      {session && (
        <div className="hidden shrink-0 group-hover:block" onClick={(e) => e.stopPropagation()}>
          <Dropdown
            placement="bottom"
            align="right"
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-line hover:text-fg"
            title="更多操作"
            panelClassName="w-40 p-1 text-sm font-normal"
            trigger={() => <Ellipsis size={15} />}
          >
            {(close) => (
              <>
                <MenuRow icon={Pencil} onClick={() => (close(), setMode('rename'))}>
                  重命名
                </MenuRow>
                <MenuRow icon={Tag} onClick={() => (close(), setMode('tag'))}>
                  {session.tag ? '修改标签' : '添加标签'}
                </MenuRow>
                <MenuRow icon={GitFork} onClick={() => (close(), void forkSession(session.sessionId))}>
                  复制为新分支
                </MenuRow>
                <div className="my-1 border-t border-line" />
                <MenuRow icon={Trash} danger onClick={() => (close(), setMode('delete'))}>
                  删除
                </MenuRow>
              </>
            )}
          </Dropdown>
        </div>
      )}
    </div>
  );
}

function MenuRow(props: {
  icon?: typeof Pencil;
  checked?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const { icon: Icon, checked, danger, onClick, children } = props;
  return (
    <button
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
        danger ? 'text-red-600 hover:bg-red-500/10 dark:text-red-400' : 'hover:bg-sunken'
      }`}
      onClick={onClick}
    >
      {Icon && <Icon size={14} className={`shrink-0 ${danger ? '' : 'text-muted'}`} />}
      <span className="flex-1">{children}</span>
      {checked !== undefined && <Check size={14} className={`text-accent ${checked ? '' : 'invisible'}`} />}
    </button>
  );
}

function InlineInput(props: {
  label: string;
  initial: string;
  allowEmpty?: boolean;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const { label, initial, allowEmpty, onSave, onCancel } = props;
  const [value, setValue] = useState(initial);
  const save = () => {
    const v = value.trim();
    if (!v && !allowEmpty) return;
    if (v === initial.trim()) return onCancel();
    onSave(v);
  };
  return (
    <div className="mx-1 space-y-1.5 rounded-xl border border-accent/45 bg-panel px-2.5 py-2 shadow-card">
      <div className="text-xs text-muted">{label}</div>
      <input
        autoFocus
        className="w-full rounded-md border border-line bg-bg px-2 py-1 text-sm transition-shadow outline-none focus:border-accent/60 focus:ring-3 focus:ring-accent/12"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="flex gap-1.5">
        <button className="rounded-md bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-strong" onClick={save}>
          保存
        </button>
        <button className="rounded-md border border-line px-2.5 py-0.5 text-xs transition-colors hover:bg-sunken" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const theme = useTheme((s) => s.theme);
  const option = (value: 'light' | 'dark', Icon: typeof Sun, label: string) => (
    <button
      className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-all ${
        theme === value ? 'bg-panel font-medium text-fg shadow-card ring-1 ring-line/60 dark:ring-transparent' : 'text-muted hover:text-fg'
      }`}
      aria-pressed={theme === value}
      onClick={() => setTheme(value)}
    >
      <Icon size={14} /> {label}
    </button>
  );
  return (
    <div className="flex rounded-lg bg-sunken p-0.5" role="group" aria-label="颜色主题">
      {option('light', Sun, '浅色')}
      {option('dark', Moon, '深色')}
    </div>
  );
}
