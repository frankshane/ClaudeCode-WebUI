// Wire protocol between the browser and the local server.
// Type-only module: imported with `import type` from both sides.
import type {
  AccountInfo,
  EffortLevel,
  ModelInfo,
  PermissionMode,
  SDKSessionInfo,
  SlashCommand,
} from '@anthropic-ai/claude-agent-sdk';

export type { AccountInfo, EffortLevel, ModelInfo, PermissionMode, SDKSessionInfo, SlashCommand };

/** idle: waiting for input; running: turn in progress; waiting: blocked on a permission/question. */
export type LiveStatus = 'starting' | 'idle' | 'running' | 'waiting' | 'closed';

/** A Claude Code process the server is currently driving. */
export interface LiveInfo {
  liveId: string;
  sessionId: string;
  cwd: string;
  status: LiveStatus;
  /** Model the user picked for this session; null = Claude Code default. */
  model: string | null;
  /** Model actually reported by the CLI in its init message. */
  activeModel: string | null;
  effort: EffortLevel | null;
  /** Effort the CLI will actually send (from its init message), when it reports one. */
  activeEffort?: EffortLevel | null;
  permissionMode: PermissionMode;
  startedAt: number;
  /** When the current turn began; null while idle. */
  turnStartedAt: number | null;
  /** Time this turn spent waiting on permission prompts; the status line's clock leaves it out, as the CLI does. */
  turnPausedMs: number;
}

export interface Catalog {
  models: ModelInfo[];
  commands: SlashCommand[];
  /** Commands whose UX only works in a terminal; hidden from the `/` menu. */
  terminalCommands: string[];
  /** Skills available to this session (a subset of `commands`, with descriptions). */
  skills: SlashCommand[];
  account?: AccountInfo;
}

/** A file attached to a prompt. Images go to Claude as image blocks, text files inline. */
export type Attachment =
  | { kind: 'image'; name: string; mediaType: string; data: string }
  | { kind: 'text'; name: string; text: string };

/** Context window usage, from the SDK's getContextUsage() (the data behind /context). */
export interface ContextUsage {
  model: string;
  totalTokens: number;
  /** The window usage is measured against (the autocompact window). */
  maxTokens: number;
  percentage: number;
  categories: Array<{ name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }>;
}

/**
 * What the server adds to each live `result` entry: the CLI's total_cost_usd is a running
 * total for the session, so the server works out the turn's share.
 */
export interface ResultCost {
  turn_cost_usd?: number;
  session_cost_usd?: number;
}

/** An installed Claude Code plugin, as reported by `claude plugin list`. */
export interface InstalledPlugin {
  /** `name@marketplace` */
  id: string;
  name: string;
  marketplace: string;
  version?: string;
  scope: string;
  enabled: boolean;
  description?: string;
}

/** A plugin offered by a configured marketplace and not installed yet. */
export interface AvailablePlugin {
  /** `name@marketplace` */
  id: string;
  name: string;
  marketplace: string;
  description?: string;
  installCount?: number;
}

export interface PluginCatalog {
  installed: InstalledPlugin[];
  available: AvailablePlugin[];
}

/** Outcome of an install/uninstall/update request. */
export interface PluginActionResult {
  ok: boolean;
  message: string;
  /**
   * The plugin installs by running a marketplace-declared command, which the CLI will only run
   * once a person has seen it. Show `command`, then retry with `acceptCommand: sha256`.
   */
  confirm?: { command: string; sha256: string };
  catalog?: PluginCatalog;
}

export interface Meta {
  version: string;
  claudeCodeVersion: string | null;
  home: string;
  platform: string;
}

/**
 * One transcript line. Either a live SDKMessage or a SessionMessage read from
 * disk; both share this loose shape (`message` is an Anthropic API message).
 */
export interface TranscriptEntry {
  type: string;
  subtype?: string;
  uuid?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  message?: any;
  isSynthetic?: boolean;
  [key: string]: unknown;
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolUseID: string;
  input: Record<string, unknown>;
  title?: string;
  description?: string;
  decisionReason?: string;
  blockedPath?: string;
  agentID?: string;
  /** CLI offered rule suggestions, so "always allow" is meaningful. */
  canAlwaysAllow: boolean;
  defaultToNo?: boolean;
}

export type PermissionDecision =
  | {
      behavior: 'allow';
      /** Apply the CLI's suggested rules so this isn't asked again this session. */
      always?: boolean;
      updatedInput?: Record<string, unknown>;
      /** Switch permission mode as part of approving (used by plan approval). */
      permissionMode?: PermissionMode;
    }
  | { behavior: 'deny'; message?: string; interrupt?: boolean };

export interface StartOptions {
  cwd: string;
  resume?: string;
  model?: string | null;
  effort?: EffortLevel | null;
  permissionMode?: PermissionMode;
}

export type ClientMsg =
  | ({ type: 'start'; reqId: string } & StartOptions)
  | { type: 'attach'; reqId: string; liveId: string }
  | { type: 'detach'; liveId: string }
  | { type: 'send'; liveId: string; text: string; attachments?: Attachment[] }
  /** Re-read plugins and skills from disk (after enabling/disabling a plugin). */
  | { type: 'reloadPlugins'; liveId: string }
  | { type: 'interrupt'; liveId: string }
  | { type: 'permission'; liveId: string; requestId: string; decision: PermissionDecision }
  | { type: 'setModel'; liveId: string; model: string | null }
  | { type: 'setEffort'; liveId: string; effort: EffortLevel | null }
  | { type: 'setPermissionMode'; liveId: string; mode: PermissionMode }
  | { type: 'close'; liveId: string }
  /** Recompute context usage now (e.g. when the usage popover opens). */
  | { type: 'refreshContext'; liveId: string };

export type ServerMsg =
  /** Full state of a live session, sent on start/attach. */
  | {
      type: 'snapshot';
      reqId?: string;
      live: LiveInfo;
      entries: TranscriptEntry[];
      catalog: Catalog | null;
      pending: PermissionRequest[];
      context: ContextUsage | null;
    }
  /** Broadcast to every client whenever any live session changes. */
  | { type: 'lives'; lives: LiveInfo[] }
  | { type: 'state'; live: LiveInfo }
  | { type: 'catalog'; liveId: string; catalog: Catalog }
  | { type: 'context'; liveId: string; usage: ContextUsage }
  | { type: 'entry'; liveId: string; entry: TranscriptEntry }
  /** Partial streaming event (SDKPartialAssistantMessage); not persisted. */
  | { type: 'stream'; liveId: string; event: any; parentToolUseId: string | null }
  /** Running estimate of thinking tokens for the current response; not persisted. */
  | { type: 'thinking'; liveId: string; tokens: number }
  | { type: 'permission'; liveId: string; request: PermissionRequest }
  | { type: 'permissionResolved'; liveId: string; requestId: string }
  | { type: 'error'; liveId?: string; reqId?: string; code?: string; message: string };

export interface ProjectInfo {
  cwd: string;
  lastModified: number;
  sessionCount: number;
}

export interface SearchHit {
  sessionId: string;
  /** Text around each match, with the matched part between the marker indices. */
  snippets: Array<{ role: 'user' | 'assistant'; text: string; start: number; end: number }>;
}

export interface FileMatch {
  /** Path relative to the project, `/`-separated; directories end with `/`. */
  path: string;
  isDir: boolean;
}

/** Outcome of the OS folder dialog; `unavailable` means the UI should fall back to typing a path. */
export type PickFolderResult =
  | { status: 'picked'; path: string }
  | { status: 'cancelled' }
  | { status: 'unavailable'; reason: string };
