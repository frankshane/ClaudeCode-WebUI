import { useMemo } from 'react';
import { create } from 'zustand';
import type {
  Attachment,
  Catalog,
  ContextUsage,
  EffortLevel,
  LiveInfo,
  Meta,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  SDKSessionInfo,
  ServerMsg,
  TaskInfo,
  TranscriptEntry,
} from '../../../shared/protocol.ts';
import { api, getToken } from './api.ts';
import { ALL_EFFORTS, baseName } from './format.ts';
import { Connection, type ConnStatus } from './ws.ts';

/** Assistant output currently streaming in, before its final message arrives. */
export interface Draft {
  messageId: string | null;
  blocks: DraftBlock[];
  /** Blocks already delivered as full assistant messages (hidden from the draft). */
  consumed: number;
}
export interface DraftBlock {
  type: string;
  text: string;
  name?: string;
}

/** Progress of the running turn for the CLI-style status line. */
export interface TurnProgress {
  /** Characters streamed this turn plus the thinking estimate; like the CLI, tokens ≈ chars / 4. */
  chars: number;
  /** When the thinking block now streaming started. */
  thinkingSince: number | null;
  /** The thinking block that just ended, briefly shown as "thought for Ns". */
  thought: { ms: number; endedAt: number } | null;
}

/** What the chat pane shows: a project dir plus a session (null = brand-new chat). */
export interface View {
  cwd: string;
  sessionId: string | null;
  liveId: string | null;
  /** Outstanding start/attach request; its snapshot is the only one accepted. */
  reqId: string | null;
}

export interface Prefs {
  model: string | null;
  effort: EffortLevel | null;
  permissionMode: PermissionMode;
}

export type SortBy = 'recent' | 'name';

interface AppState {
  conn: ConnStatus;
  lives: Record<string, LiveInfo>;
  view: View | null;
  live: LiveInfo | null;
  entries: TranscriptEntry[];
  draft: Draft | null;
  pending: PermissionRequest[];
  catalog: Catalog | null;
  /** Context window usage of the chat pane's live session. */
  context: ContextUsage | null;
  prefs: Prefs;
  notice: string | null;
  meta: Meta | null;
  /** Task sandbox directories. */
  tasks: TaskInfo[] | null;
  tasksCollapsed: boolean;
  /** Sessions of every project, newest first; null until the first load. */
  sessions: SDKSessionInfo[] | null;
  /** Bumped whenever session data changed on disk. */
  sessionsVersion: number;
  /** Directories the user opened by path (may have no sessions yet). */
  extraProjects: string[];
  /** When each folder in extraProjects was last opened (by folderKey); keeps it at the top of the recent order. */
  projectOpenedAt: Record<string, number>;
  /** Folders hidden from the sidebar tree. */
  hiddenProjects: string[];
  /** Folders collapsed in the sidebar tree. */
  collapsed: string[];
  /** Custom user-dragged folder order (list of cwds). */
  customFolderOrder: string[];
  sortBy: SortBy;
  sidebarOpen: boolean;
  searchOpen: boolean;
  settingsOpen: boolean;
  runningDisplayMode: 'chips' | 'dropdown';
  /** Text to drop into the composer (nonce makes repeated prefills distinct). */
  prefill: { text: string; nonce: number } | null;
  turn: TurnProgress;
}

const PREFS_KEY = 'ccwebui.prefs';
const VIEW_KEY = 'ccwebui.view';
const EXTRA_KEY = 'ccwebui.extraProjects';
const OPENED_KEY = 'ccwebui.projectOpenedAt';
const HIDDEN_KEY = 'ccwebui.hiddenProjects';
const COLLAPSED_KEY = 'ccwebui.collapsed';
const FOLDER_ORDER_KEY = 'ccwebui.folderOrder';
const TASKS_COLLAPSED_KEY = 'ccwebui.tasksCollapsed';
const UI_KEY = 'ccwebui.ui';

function loadList(key: string): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

const savedView = loadJson<{ cwd: string | null; sessionId: string | null }>(VIEW_KEY, { cwd: null, sessionId: null });
const savedUi = loadJson<{ sortBy: SortBy; sidebarOpen: boolean; runningDisplayMode?: 'chips' | 'dropdown' }>(UI_KEY, {
  sortBy: 'recent',
  sidebarOpen: true,
  runningDisplayMode: 'chips',
});
const savedPrefs = loadJson<Prefs>(PREFS_KEY, { model: null, effort: null, permissionMode: 'default' });
// Auto mode is no longer offered (see PICKER_MODES); a saved choice of it falls back to asking.
if (savedPrefs.permissionMode === 'auto') savedPrefs.permissionMode = 'default';
// Left by versions where plan mode was a separate toggle that returned to this mode.
Reflect.deleteProperty(savedPrefs, 'baseMode');

export const useStore = create<AppState>(() => ({
  conn: 'connecting',
  lives: {},
  view: null,
  live: null,
  entries: [],
  draft: null,
  pending: [],
  catalog: null,
  context: null,
  prefs: savedPrefs,
  notice: null,
  meta: null,
  tasks: null,
  tasksCollapsed: localStorage.getItem(TASKS_COLLAPSED_KEY) === 'true',
  sessions: null,
  sessionsVersion: 0,
  extraProjects: loadList(EXTRA_KEY),
  projectOpenedAt: loadJson<Record<string, number>>(OPENED_KEY, {}),
  hiddenProjects: loadList(HIDDEN_KEY),
  collapsed: loadList(COLLAPSED_KEY),
  customFolderOrder: loadList(FOLDER_ORDER_KEY),
  sortBy: savedUi.sortBy,
  sidebarOpen: savedUi.sidebarOpen,
  searchOpen: false,
  settingsOpen: false,
  runningDisplayMode: savedUi.runningDisplayMode ?? 'chips',
  prefill: null,
  turn: { chars: 0, thinkingSince: null, thought: null },
}));

const set = useStore.setState;
const get = useStore.getState;

let conn: Connection | null = null;
/** A prompt typed while no process was ready; sent as soon as the snapshot lands. */
let pendingSend: { text: string; attachments: Attachment[] } | null = null;
/** Whether the user sent anything to the current live process. */
let usedLive = false;

// ---- connection ----

export function connect(): void {
  if (conn) return;
  const url = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const token = getToken();
    return `${proto}://${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  };
  conn = new Connection(url, onMessage, (status) => {
    set({ conn: status });
    if (status === 'open') resync();
  });
  conn.connect();
  // The start page is always a fresh chat (the centered composer) in the last project.
  if (savedView.cwd) openSession(savedView.cwd, null);
  void refreshSessions();
  void refreshTasks();
  api<Meta>('/meta').then((meta) => set({ meta }), () => {});
}

/** Refetches the sessions of every project. */
export async function refreshSessions(): Promise<void> {
  try {
    const sessions = await api<SDKSessionInfo[]>('/sessions');
    set({ sessions });
    // First run: start in the most recently used project.
    if (!get().view && sessions[0]?.cwd) openSession(sessions[0].cwd, null);
  } catch {
    if (!get().sessions) set({ sessions: [] });
  }
}

function sessionsChanged(): void {
  set((s) => ({ sessionsVersion: s.sessionsVersion + 1 }));
  void refreshSessions();
  void refreshTasks();
}

function send(msg: Parameters<Connection['send']>[0]): void {
  conn?.send(msg);
}

/** After (re)connecting, re-bind the chat pane to its live process. */
function resync(): void {
  const v = get().view;
  if (!v) return;
  if (v.liveId) {
    const reqId = crypto.randomUUID();
    set({ view: { ...v, reqId } });
    send({ type: 'attach', reqId, liveId: v.liveId });
  } else {
    startLive(v.cwd, v.sessionId);
  }
}

function startLive(cwd: string, resume: string | null): void {
  const reqId = crypto.randomUUID();
  set({ view: { cwd, sessionId: resume, liveId: null, reqId } });
  const { prefs } = get();
  send({
    type: 'start',
    reqId,
    cwd,
    resume: resume ?? undefined,
    model: prefs.model,
    effort: prefs.effort,
    permissionMode: prefs.permissionMode,
  });
}

// ---- sidebar / projects ----

function saveList(key: string, list: string[]): void {
  localStorage.setItem(key, JSON.stringify(list));
}

function saveUi(): void {
  const { sortBy, sidebarOpen, runningDisplayMode } = get();
  localStorage.setItem(UI_KEY, JSON.stringify({ sortBy, sidebarOpen, runningDisplayMode }));
}

export function setRunningDisplayMode(mode: 'chips' | 'dropdown'): void {
  set({ runningDisplayMode: mode });
  saveUi();
}

/**
 * Remembers a directory opened by path so it stays in the tree even without sessions,
 * stamped with the time so it sorts to the top of the recent order.
 */
export function addProject(path: string): void {
  const extraProjects = [path, ...get().extraProjects.filter((p) => !samePath(p, path))].slice(0, 30);
  const hiddenProjects = get().hiddenProjects.filter((p) => !samePath(p, path));
  const projectOpenedAt = openedAtFor(extraProjects, { ...get().projectOpenedAt, [folderKey(path)]: Date.now() });
  set({ extraProjects, hiddenProjects, projectOpenedAt });
  saveList(EXTRA_KEY, extraProjects);
  saveList(HIDDEN_KEY, hiddenProjects);
  localStorage.setItem(OPENED_KEY, JSON.stringify(projectOpenedAt));
}

export function hideProject(path: string): void {
  const s = get();
  const hiddenProjects = [...s.hiddenProjects.filter((p) => !samePath(p, path)), path];
  const extraProjects = s.extraProjects.filter((p) => !samePath(p, path));
  const projectOpenedAt = openedAtFor(extraProjects, s.projectOpenedAt);
  set({ hiddenProjects, extraProjects, projectOpenedAt });
  saveList(HIDDEN_KEY, hiddenProjects);
  saveList(EXTRA_KEY, extraProjects);
  localStorage.setItem(OPENED_KEY, JSON.stringify(projectOpenedAt));

  // The folder you're in always shows, so hiding it has to move you out of it: to the folder that now
  // tops the list, or to no folder at all when none is left.
  if (!samePath(s.view?.cwd, path)) return;
  const [next] = buildFolders({
    sessions: s.sessions,
    extra: extraProjects,
    openedAt: projectOpenedAt,
    hidden: hiddenProjects,
    sortBy: s.sortBy,
    viewCwd: null,
    customFolderOrder: s.customFolderOrder,
  });
  if (next) {
    openSession(next.cwd, null);
  } else {
    releaseView();
    set({ view: null });
    localStorage.removeItem(VIEW_KEY);
  }
}

/** Keeps only the stamps of folders still in the list. */
function openedAtFor(extraProjects: string[], openedAt: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of extraProjects) {
    const at = openedAt[folderKey(p)];
    if (at) out[folderKey(p)] = at;
  }
  return out;
}

export function unhideAllProjects(): void {
  set({ hiddenProjects: [] });
  saveList(HIDDEN_KEY, []);
}

export function toggleCollapsed(path: string): void {
  const was = get().collapsed.some((p) => samePath(p, path));
  const collapsed = was ? get().collapsed.filter((p) => !samePath(p, path)) : [...get().collapsed, path];
  set({ collapsed });
  saveList(COLLAPSED_KEY, collapsed);
}

export function setAllCollapsed(paths: string[], collapse: boolean): void {
  const collapsed = collapse ? paths : [];
  set({ collapsed });
  saveList(COLLAPSED_KEY, collapsed);
}

export function setSortBy(sortBy: SortBy): void {
  set({ sortBy });
  saveUi();
}

export function toggleSidebar(): void {
  set((s) => ({ sidebarOpen: !s.sidebarOpen }));
  saveUi();
}

export function openSearch(): void {
  set({ searchOpen: true });
}

export function closeSearch(): void {
  set({ searchOpen: false });
}

export function openSettings(): void {
  set({ settingsOpen: true });
}

export function closeSettings(): void {
  set({ settingsOpen: false });
}

/** 拖拽排序工作区：将 fromCwd 移动到 toCwd 的位置，并持久化到 localStorage */
export function reorderFolders(fromCwd: string, toCwd: string): void {
  if (samePath(fromCwd, toCwd)) return;
  const { customFolderOrder, extraProjects, sessions } = get();
  const allCwds: string[] = [];
  const seen = new Set<string>();

  for (const p of customFolderOrder) {
    const k = folderKey(p);
    if (!seen.has(k)) {
      seen.add(k);
      allCwds.push(p);
    }
  }
  for (const p of extraProjects) {
    const k = folderKey(p);
    if (!seen.has(k)) {
      seen.add(k);
      allCwds.push(p);
    }
  }
  for (const s of sessions ?? []) {
    if (s.cwd) {
      const k = folderKey(s.cwd);
      if (!seen.has(k)) {
        seen.add(k);
        allCwds.push(s.cwd);
      }
    }
  }

  const fromIdx = allCwds.findIndex((p) => samePath(p, fromCwd));
  const toIdx = allCwds.findIndex((p) => samePath(p, toCwd));
  if (fromIdx === -1 || toIdx === -1) return;

  const [moved] = allCwds.splice(fromIdx, 1);
  allCwds.splice(toIdx, 0, moved);

  set({ customFolderOrder: allCwds });
  localStorage.setItem(FOLDER_ORDER_KEY, JSON.stringify(allCwds));
}

export interface Folder {
  cwd: string;
  sessions: SDKSessionInfo[];
  lastActivity: number;
}

/**
 * Identity of a folder path. On Windows the same folder can be spelled with backslashes or
 * forward slashes, with or without a trailing slash, and with either drive-letter case.
 */
export function folderKey(path: string): string {
  const p = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:\//i.test(p) || path.startsWith('\\\\') ? p.toLowerCase() : p;
}

export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && folderKey(a) === folderKey(b);
}

/** Check if a path belongs to the task sandbox directory */
export function isTaskPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const tasksDir = get().meta?.tasksDir;
  if (tasksDir && folderKey(path).startsWith(folderKey(tasksDir))) return true;
  return /([\\/]\.ccwebui[\\/]tasks([\\/]|$))/i.test(path);
}

/** Extract task ID (e.g. task-1) from a directory path */
export function extractTaskId(path: string | null | undefined): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, '/');
  const m = normalized.match(/\/tasks\/([^/]+)/i);
  return m ? m[1] : null;
}

/** Human-friendly project label (formats task sandboxes as "任务 #1") */
export function projectTitle(cwd: string): string {
  if (isTaskPath(cwd)) {
    const id = extractTaskId(cwd);
    const num = id ? id.replace(/^task-/, '') : '';
    return num ? `任务 #${num}` : '任务沙箱';
  }
  return baseName(cwd);
}

export interface TaskRowItem {
  taskId: string;
  cwd: string;
  taskNumber: string;
  title: string;
  time?: number;
  session?: SDKSessionInfo;
  sessionId: string | null;
}

interface FolderInputs {
  sessions: SDKSessionInfo[] | null;
  extra: string[];
  openedAt: Record<string, number>;
  hidden: string[];
  sortBy: SortBy;
  viewCwd: string | null;
  customFolderOrder?: string[];
}

/** Visible folders with their sessions, in the chosen order. */
function buildFolders({ sessions, extra, openedAt, hidden, sortBy, viewCwd, customFolderOrder }: FolderInputs): Folder[] {
  const byKey = new Map<string, Folder>();
  // The first spelling seen wins for display; sessions come first so it's Claude Code's.
  const folder = (cwd: string) => {
    const key = folderKey(cwd);
    let f = byKey.get(key);
    if (!f) byKey.set(key, (f = { cwd, sessions: [], lastActivity: 0 }));
    return f;
  };
  for (const s of sessions ?? []) {
    if (isTaskPath(s.cwd)) continue; // 任务归入专属任务栏，不污染工作区
    const f = folder(s.cwd!);
    f.sessions.push(s);
    f.lastActivity = Math.max(f.lastActivity, s.lastModified);
  }
  // Opening a folder counts as activity, so a freshly opened one sits at the top even before it has sessions.
  for (const p of extra) {
    if (isTaskPath(p)) continue;
    const f = folder(p);
    f.lastActivity = Math.max(f.lastActivity, openedAt[folderKey(p)] ?? 0);
  }
  // 确保当前正在查看的工作区存在于列表中（如果它是空的），但绝不篡改它的 lastActivity，彻底杜绝点击时自动跳到最上方！
  if (viewCwd && !isTaskPath(viewCwd)) {
    folder(viewCwd);
  }
  const hiddenKeys = new Set(hidden.map(folderKey));
  const list = [...byKey.values()].filter((f) => !hiddenKeys.has(folderKey(f.cwd)) || samePath(f.cwd, viewCwd));

  // 1. 如果用户手动拖拽排序过工作区，按自定义拖拽顺序展示！
  if (customFolderOrder && customFolderOrder.length > 0) {
    const orderMap = new Map<string, number>();
    customFolderOrder.forEach((p, idx) => orderMap.set(folderKey(p), idx));
    return list.sort((a, b) => {
      const idxA = orderMap.has(folderKey(a.cwd)) ? orderMap.get(folderKey(a.cwd))! : 99999;
      const idxB = orderMap.has(folderKey(b.cwd)) ? orderMap.get(folderKey(b.cwd))! : 99999;
      if (idxA !== idxB) return idxA - idxB;
      return sortBy === 'name' ? a.cwd.localeCompare(b.cwd, 'zh-CN') : b.lastActivity - a.lastActivity;
    });
  }

  // 2. 默认按名称或历史活跃度排序
  return list.sort((a, b) => (sortBy === 'name' ? a.cwd.localeCompare(b.cwd, 'zh-CN') : b.lastActivity - a.lastActivity));
}

/** The sidebar tree: visible folders with their sessions, in the chosen order. */
export function useFolders(): Folder[] {
  const sessions = useStore((s) => s.sessions);
  const extra = useStore((s) => s.extraProjects);
  const openedAt = useStore((s) => s.projectOpenedAt);
  const hidden = useStore((s) => s.hiddenProjects);
  const sortBy = useStore((s) => s.sortBy);
  const viewCwd = useStore((s) => s.view?.cwd ?? null);
  const customFolderOrder = useStore((s) => s.customFolderOrder);
  return useMemo(
    () => buildFolders({ sessions, extra, openedAt, hidden, sortBy, viewCwd, customFolderOrder }),
    [sessions, extra, openedAt, hidden, sortBy, viewCwd, customFolderOrder],
  );
}

/** Active and historical task sandbox items with their exact session bindings */
export function useTaskItems(): TaskRowItem[] {
  const tasks = useStore((s) => s.tasks);
  const sessions = useStore((s) => s.sessions);
  const lives = useStore((s) => s.lives);
  const view = useStore((s) => s.view);

  return useMemo(() => {
    const items: TaskRowItem[] = [];
    const taskList = tasks ?? [];

    const sessionsByCwd = new Map<string, SDKSessionInfo[]>();
    for (const s of sessions ?? []) {
      if (!s.cwd) continue;
      const k = folderKey(s.cwd);
      let arr = sessionsByCwd.get(k);
      if (!arr) sessionsByCwd.set(k, (arr = []));
      arr.push(s);
    }

    const liveByCwd = new Map<string, LiveInfo[]>();
    for (const l of Object.values(lives)) {
      if (l.status === 'closed' || !l.cwd) continue;
      const k = folderKey(l.cwd);
      let arr = liveByCwd.get(k);
      if (!arr) liveByCwd.set(k, (arr = []));
      arr.push(l);
    }

    for (const t of taskList) {
      const k = folderKey(t.cwd);
      const taskSessions = sessionsByCwd.get(k) ?? [];
      taskSessions.sort((a, b) => b.lastModified - a.lastModified);
      const latestSession = taskSessions[0];

      const liveList = liveByCwd.get(k) ?? [];
      const activeLive = liveList[0];

      let sessionId: string | null = t.sessionId ?? null;
      let title = t.title || t.taskId;
      let time: number | undefined = t.lastModified ?? t.createdAt;

      if (latestSession) {
        sessionId = latestSession.sessionId;
        title = latestSession.customTitle || latestSession.summary || latestSession.firstPrompt || title;
        time = latestSession.lastModified;
      } else if (activeLive) {
        sessionId = activeLive.sessionId;
        if (!title || title.startsWith('task-')) title = '新任务';
      } else if (view && samePath(view.cwd, t.cwd) && view.sessionId) {
        sessionId = view.sessionId;
      }

      const taskNumber = t.taskId.replace(/^task-/, '');

      items.push({
        taskId: t.taskId,
        cwd: t.cwd,
        taskNumber,
        title,
        time,
        session: latestSession,
        sessionId,
      });
    }

    if (view?.cwd && isTaskPath(view.cwd)) {
      const id = extractTaskId(view.cwd);
      if (id && !items.some((x) => x.taskId === id)) {
        items.unshift({
          taskId: id,
          cwd: view.cwd,
          taskNumber: id.replace(/^task-/, ''),
          title: '新任务',
          time: Date.now(),
          sessionId: view.sessionId,
        });
      }
    }

    return items.sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
  }, [tasks, sessions, lives, view]);
}

/** Project dirs for pickers: current first, then the tree's order (excluding tasks). */
export function useProjectOptions(): string[] {
  const folders = useFolders();
  const viewCwd = useStore((s) => s.view?.cwd ?? null);
  return useMemo(() => {
    const out: string[] = [];
    for (const p of [...(viewCwd && !isTaskPath(viewCwd) ? [viewCwd] : []), ...folders.map((f) => f.cwd)]) {
      if (!isTaskPath(p) && !out.some((q) => samePath(p, q))) out.push(p);
    }
    return out;
  }, [folders, viewCwd]);
}

/** True while the chat pane shows an untouched new chat (the centered composer). */
export function isBlankChat(s: AppState = get()): boolean {
  const v = s.view;
  if (!v) return true;
  // reqId + sessionId = an existing session is still loading, not a blank one.
  return s.entries.length === 0 && !s.draft && !(v.reqId && v.sessionId);
}

/** Hands the pending composer prefill to exactly one taker. */
export function takePrefill(): string | null {
  const p = get().prefill;
  if (p) set({ prefill: null });
  return p?.text ?? null;
}

// ---- user actions ----

/** Lets go of what the chat pane shows: busy processes keep running in the background, untouched idle ones close. */
function releaseView(): void {
  const { view, live } = get();
  if (view?.liveId && live) {
    if (!usedLive && live.status === 'idle') send({ type: 'close', liveId: live.liveId });
    else send({ type: 'detach', liveId: live.liveId });
  }
  usedLive = false;
  pendingSend = null;
  resetDraft();
  resetTurn();
  set({ entries: [], pending: [], catalog: null, context: null, live: null, notice: null, searchOpen: false });
}

/** Opens a session in the chat pane (sessionId null = new chat). */
export function openSession(cwd: string, sessionId: string | null): void {
  const { lives } = get();
  releaseView();
  localStorage.setItem(VIEW_KEY, JSON.stringify({ cwd, sessionId }));

  const existing = sessionId
    ? Object.values(lives).find((l) => l.sessionId === sessionId && l.status !== 'closed')
    : undefined;
  if (existing) {
    usedLive = true;
    const reqId = crypto.randomUUID();
    set({ view: { cwd, sessionId, liveId: existing.liveId, reqId } });
    send({ type: 'attach', reqId, liveId: existing.liveId });
  } else {
    startLive(cwd, sessionId);
  }
}

/** New chat in `cwd`, or in the current / most recent project. */
export function newChat(cwd?: string): void {
  const target = cwd ?? get().view?.cwd ?? get().sessions?.[0]?.cwd ?? get().extraProjects[0];
  if (!target) return;
  if (samePath(target, get().view?.cwd) && isBlankChat()) return;
  openSession(target, null);
}

/**
 * Commands whose terminal behavior would desync the UI (a new session id,
 * or model/effort changed behind the pickers' back) are handled here instead.
 */
function handleLocalCommand(text: string): boolean {
  const m = text.trim().match(/^\/(clear|new|model|effort)(?:\s+(.*))?$/s);
  if (!m) return false;
  const [, name, rawArg] = m;
  const arg = rawArg?.trim() ?? '';
  const view = get().view!;
  if (name === 'clear' || name === 'new') {
    openSession(view.cwd, null);
    return true;
  }
  if (!arg) {
    set({ notice: `用法：/${name} <值>，也可以直接用输入框右下角的选择器。` });
    return true;
  }
  if (name === 'model') {
    setModel(arg === 'default' ? null : arg);
    return true;
  }
  const level = arg.toLowerCase();
  if (level === 'auto' || level === 'default') setEffort(null);
  else if ((ALL_EFFORTS as string[]).includes(level)) setEffort(level as EffortLevel);
  else set({ notice: `推理强度可选：auto / ${ALL_EFFORTS.join(' / ')}` });
  return true;
}

export function sendText(text: string, attachments: Attachment[] = []): void {
  const { view, live, entries } = get();
  if (!view || (!text.trim() && !attachments.length)) return;
  if (!attachments.length && handleLocalCommand(text)) return;
  if (!live || live.status === 'closed' || !view.liveId) {
    // Process gone (reaped/crashed) or still starting: (re)start, then send.
    pendingSend = { text, attachments };
    if (!view.reqId) {
      const hasHistory = entries.some((e) => e.type === 'user');
      startLive(view.cwd, hasHistory ? view.sessionId : null);
    }
    return;
  }
  usedLive = true;
  send({ type: 'send', liveId: live.liveId, text, ...(attachments.length ? { attachments } : {}) });
}

export function interrupt(): void {
  const live = get().live;
  if (live) send({ type: 'interrupt', liveId: live.liveId });
}

export function respondPermission(requestId: string, decision: PermissionDecision): void {
  const live = get().live;
  if (!live) return;
  set((s) => ({ pending: s.pending.filter((p) => p.requestId !== requestId) }));
  send({ type: 'permission', liveId: live.liveId, requestId, decision });
}

function savePrefs(patch: Partial<Prefs>): void {
  const prefs = { ...get().prefs, ...patch };
  set({ prefs });
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function activeLive(): LiveInfo | null {
  const live = get().live;
  return live && live.status !== 'closed' ? live : null;
}

export function setModel(model: string | null): void {
  savePrefs({ model });
  const live = activeLive();
  if (live) send({ type: 'setModel', liveId: live.liveId, model });
}

export function setEffort(effort: EffortLevel | null): void {
  savePrefs({ effort });
  const live = activeLive();
  if (live) send({ type: 'setEffort', liveId: live.liveId, effort });
}

/** Switches the permission mode (plan mode included) and keeps it as the default for new chats. */
export function setPermissionMode(mode: PermissionMode): void {
  savePrefs({ permissionMode: mode });
  const live = activeLive();
  if (live) send({ type: 'setPermissionMode', liveId: live.liveId, mode });
}

/** The mode currently in effect for the chat pane (live session, else the saved preference). */
export function currentMode(s: AppState = get()): PermissionMode {
  return s.live && s.live.status !== 'closed' ? s.live.permissionMode : s.prefs.permissionMode;
}

/** Asks for fresh context usage (cheap: the server answers from local estimates). */
export function refreshContext(): void {
  const live = activeLive();
  if (live) send({ type: 'refreshContext', liveId: live.liveId });
}

/** Applies plugin enable/disable changes to the chat pane's live session. */
export function reloadPlugins(): void {
  const live = activeLive();
  if (live) send({ type: 'reloadPlugins', liveId: live.liveId });
}

export function dismissNotice(): void {
  set({ notice: null });
}

export function showNotice(text: string): void {
  set({ notice: text });
}

// ---- session management ----

function fail(action: string) {
  return (err: unknown) => set({ notice: `${action}失败：${err instanceof Error ? err.message : err}` });
}

/** Project dir a session belongs to (session mutations need it). */
function dirOf(sessionId: string): string | undefined {
  return get().sessions?.find((s) => s.sessionId === sessionId)?.cwd ?? get().view?.cwd;
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  const dir = dirOf(sessionId);
  await api(`/sessions/${sessionId}/rename`, { method: 'POST', body: { dir, title } }).then(sessionsChanged, fail('重命名'));
}

export async function tagSession(sessionId: string, tag: string | null): Promise<void> {
  const dir = dirOf(sessionId);
  await api(`/sessions/${sessionId}/tag`, { method: 'POST', body: { dir, tag } }).then(sessionsChanged, fail('设置标签'));
}

export async function deleteSession(sessionId: string): Promise<void> {
  const dir = dirOf(sessionId);
  // Leave the session first so the pane doesn't try to resume a deleted file.
  if (get().view?.sessionId === sessionId && dir) openSession(dir, null);
  set((s) => ({ sessions: s.sessions?.filter((x) => x.sessionId !== sessionId) ?? null }));
  const query = dir ? `?dir=${encodeURIComponent(dir)}` : '';
  await api(`/sessions/${sessionId}${query}`, { method: 'DELETE' }).then(sessionsChanged, fail('删除'));
}

/** Copies a session (optionally only up to one message) into a new one and opens it. */
export async function forkSession(sessionId: string, upToMessageId?: string): Promise<string | null> {
  const dir = dirOf(sessionId);
  if (!dir) return null;
  try {
    const { sessionId: forked } = await api<{ sessionId: string }>(`/sessions/${sessionId}/fork`, {
      method: 'POST',
      body: { dir, upToMessageId },
    });
    openSession(dir, forked);
    sessionsChanged();
    return forked;
  } catch (err) {
    fail('分叉')(err);
    return null;
  }
}

// ---- task sandbox actions ----

export async function refreshTasks(): Promise<void> {
  try {
    const tasks = await api<TaskInfo[]>('/tasks');
    set({ tasks });
  } catch {
    // ignore
  }
}

export async function createInstantTask(title?: string): Promise<void> {
  try {
    const task = await api<TaskInfo>('/tasks', { method: 'POST', body: { title } });
    addProject(task.cwd);
    await refreshTasks();
    openSession(task.cwd, null);
    void refreshSessions();
  } catch (err) {
    fail('创建任务')(err);
  }
}

export async function removeTask(taskId: string): Promise<void> {
  try {
    const { view, extraProjects } = get();
    const isCurrent = !!(view?.cwd && extractTaskId(view.cwd) === taskId);
    if (isCurrent) {
      releaseView();
    }
    await api<{ ok: boolean }>(`/tasks/${taskId}`, { method: 'DELETE' });
    const filteredExtra = extraProjects.filter((p) => extractTaskId(p) !== taskId);
    set({ extraProjects: filteredExtra });
    saveList(EXTRA_KEY, filteredExtra);
    await refreshTasks();
    await refreshSessions();

    if (isCurrent) {
      // 切换到安全的工作区项目，防止在已物理删除的沙箱目录中启动 Claude Code 导致进程崩溃
      const nonTaskSession = get().sessions?.find((s) => s.cwd && !isTaskPath(s.cwd));
      const nonTaskProject = filteredExtra.find((p) => !isTaskPath(p));
      const fallbackTarget = nonTaskSession?.cwd ?? nonTaskProject ?? get().meta?.home;
      if (fallbackTarget) {
        openSession(fallbackTarget, null);
      }
    }
  } catch (err) {
    fail('删除任务')(err);
  }
}

export function toggleTasksCollapsed(): void {
  const next = !get().tasksCollapsed;
  localStorage.setItem(TASKS_COLLAPSED_KEY, String(next));
  set({ tasksCollapsed: next });
}

/**
 * "Edit" a past prompt: branch the conversation just before it and put the
 * old text back in the composer. The original session is left untouched.
 */
export async function editFromMessage(text: string, forkPoint: string | null): Promise<void> {
  const view = get().view;
  if (!view) return;
  if (forkPoint && view.sessionId) {
    if (!(await forkSession(view.sessionId, forkPoint))) return;
  } else {
    openSession(view.cwd, null);
  }
  set({ prefill: { text, nonce: Date.now() } });
}

// ---- server messages ----

function isCurrent(liveId: string): boolean {
  return get().view?.liveId === liveId;
}

function onMessage(msg: ServerMsg): void {
  switch (msg.type) {
    case 'lives':
      set({ lives: Object.fromEntries(msg.lives.map((l) => [l.liveId, l])) });
      return;
    case 'state': {
      const l = msg.live;
      set((s) => {
        const lives = { ...s.lives };
        if (l.status === 'closed') delete lives[l.liveId];
        else lives[l.liveId] = l;
        return { lives, live: s.live?.liveId === l.liveId ? l : s.live };
      });
      return;
    }
    case 'snapshot': {
      const v = get().view;
      if (!v || msg.reqId !== v.reqId) return;
      resetDraft();
      set({
        view: { ...v, liveId: msg.live.liveId, sessionId: msg.live.sessionId, reqId: null },
        live: msg.live,
        entries: msg.entries,
        catalog: msg.catalog,
        pending: msg.pending,
        context: msg.context,
      });
      localStorage.setItem(VIEW_KEY, JSON.stringify({ cwd: v.cwd, sessionId: msg.live.sessionId }));
      if (pendingSend) {
        const { text, attachments } = pendingSend;
        pendingSend = null;
        sendText(text, attachments);
      }
      return;
    }
    case 'entry':
      if (!isCurrent(msg.liveId)) return;
      set((s) => ({ entries: [...s.entries, msg.entry] }));
      onEntryForDraft(msg.entry);
      if (msg.entry.type === 'result') {
        resetTurn();
        sessionsChanged();
      }
      return;
    case 'stream':
      if (!isCurrent(msg.liveId) || msg.parentToolUseId) return;
      applyStreamEvent(msg.event);
      return;
    case 'thinking':
      // A running total for the current thinking block; the CLI folds it into the turn's count the same way.
      if (!isCurrent(msg.liveId)) return;
      turn.chars = Math.max(turn.chars, thinkingBaseline + msg.tokens * 4);
      scheduleFlush();
      return;
    case 'catalog':
      if (isCurrent(msg.liveId)) set({ catalog: msg.catalog });
      return;
    case 'context':
      if (isCurrent(msg.liveId)) set({ context: msg.usage });
      return;
    case 'permission':
      if (isCurrent(msg.liveId)) set((s) => ({ pending: [...s.pending, msg.request] }));
      return;
    case 'permissionResolved':
      if (isCurrent(msg.liveId)) set((s) => ({ pending: s.pending.filter((p) => p.requestId !== msg.requestId) }));
      return;
    case 'error': {
      const v = get().view;
      if (msg.code === 'live_not_found' && v && (msg.reqId === v.reqId || msg.liveId === v.liveId)) {
        // Process ended while we weren't looking: resume it from disk.
        startLive(v.cwd, v.sessionId);
        return;
      }
      set({ notice: msg.message });
      return;
    }
  }
}

// ---- streaming draft ----

let draft: Draft | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let turn: TurnProgress = { chars: 0, thinkingSince: null, thought: null };
/** turn.chars when the current thinking block began, and that block's index. */
let thinkingBaseline = 0;
let thinkingIndex = -1;

function flushDraft(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  set({ draft: draft ? { ...draft, blocks: draft.blocks.map((b) => ({ ...b })) } : null, turn: { ...turn } });
}

/** Coalesces token-by-token updates so markdown re-renders ~15 times a second. */
function scheduleFlush(): void {
  if (!flushTimer) flushTimer = setTimeout(flushDraft, 66);
}

function resetDraft(): void {
  draft = null;
  flushDraft();
}

function resetTurn(): void {
  turn = { chars: 0, thinkingSince: null, thought: null };
  thinkingBaseline = 0;
  thinkingIndex = -1;
  flushDraft();
}

function endThinking(): void {
  if (turn.thinkingSince === null) return;
  const now = Date.now();
  turn.thought = { ms: now - turn.thinkingSince, endedAt: now };
  turn.thinkingSince = null;
}

function applyStreamEvent(ev: any): void {
  switch (ev?.type) {
    case 'message_start':
      draft = { messageId: ev.message?.id ?? null, blocks: [], consumed: 0 };
      break;
    case 'content_block_start': {
      draft ??= { messageId: null, blocks: [], consumed: 0 };
      const b = ev.content_block ?? {};
      draft.blocks[ev.index] = { type: b.type, text: b.text ?? b.thinking ?? '', name: b.name };
      if (b.type === 'thinking' || b.type === 'redacted_thinking') {
        turn.thinkingSince = Date.now();
        thinkingBaseline = turn.chars;
        thinkingIndex = ev.index;
      }
      break;
    }
    case 'content_block_delta': {
      const block = draft?.blocks[ev.index];
      if (!block) return;
      const d = ev.delta ?? {};
      const piece: string | undefined =
        d.type === 'text_delta' ? d.text : d.type === 'thinking_delta' ? d.thinking : d.type === 'input_json_delta' ? d.partial_json : undefined;
      if (piece === undefined) return;
      block.text += piece;
      turn.chars += piece.length;
      break;
    }
    case 'content_block_stop':
      if (ev.index !== thinkingIndex) return;
      endThinking();
      break;
    case 'message_stop':
      draft = null;
      endThinking();
      flushDraft();
      return;
    default:
      return;
  }
  scheduleFlush();
}

function onEntryForDraft(entry: TranscriptEntry): void {
  if (!draft) return;
  if (entry.type === 'result') {
    draft = null;
  } else if (entry.type === 'assistant' && !entry.parent_tool_use_id && entry.message?.id === draft.messageId) {
    const content = entry.message?.content;
    draft.consumed += Array.isArray(content) ? content.length : 1;
  } else {
    return;
  }
  flushDraft();
}
