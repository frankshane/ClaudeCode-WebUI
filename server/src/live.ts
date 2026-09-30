import { randomUUID } from 'node:crypto';
import {
  query,
  type CanUseTool,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { loadTranscript, savedCostTotal } from './history.ts';
import { AsyncQueue } from './queue.ts';
import type {
  Attachment,
  Catalog,
  ContextUsage,
  EffortLevel,
  LiveInfo,
  LiveStatus,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  ResultCost,
  ServerMsg,
  StartOptions,
  TranscriptEntry,
} from '../../shared/protocol.ts';

type Listener = (msg: ServerMsg) => void;

interface PendingPermission {
  request: PermissionRequest;
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
  finish: (result: PermissionResult) => void;
}

const IDLE_REAP_MS = 10 * 60_000;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
/** A process nobody ever sent a message to (e.g. a page reload's blank chat) goes sooner. */
const UNUSED_REAP_MS = 30_000;

/** System messages worth showing in the transcript; every other subtype is dropped. */
const RECORDED_SYSTEM = new Set([
  'compact_boundary',
  'local_command_output',
  'informational',
  'notification',
  'api_retry',
  'permission_denied',
  'model_refusal_fallback',
  'model_refusal_no_fallback',
]);

/** One Claude Code process driven through the Agent SDK. */
export class LiveSession {
  readonly info: LiveInfo;
  private q: Query | null = null;
  private readonly input = new AsyncQueue<SDKUserMessage>();
  private readonly transcript: TranscriptEntry[] = [];
  private readonly seen = new Set<string>();
  private readonly pending = new Map<string, PendingPermission>();
  private readonly listeners = new Set<Listener>();
  private catalog: Catalog | null = null;
  private context: ContextUsage | null = null;
  private contextInFlight = false;
  /** The CLI's running total_cost_usd as of the last result (seeded from disk when resuming). */
  private costTotal = 0;
  private terminalCommands: string[] = [];
  private turnRunning = false;
  /** When the current permission wait began. */
  private pausedAt: number | null = null;
  private used = false;
  private markExited!: () => void;
  /** Resolves once the CLI process is gone (after close() or a crash). */
  readonly exited = new Promise<void>((resolve) => (this.markExited = resolve));
  private readonly opts: StartOptions;
  private readonly onStateChange: (live: LiveSession) => void;
  private readonly debug: boolean;
  lastActive = Date.now();

  constructor(opts: StartOptions, onStateChange: (live: LiveSession) => void, debug: boolean) {
    this.opts = opts;
    this.onStateChange = onStateChange;
    this.debug = debug;
    this.info = {
      liveId: randomUUID(),
      sessionId: opts.resume ?? randomUUID(),
      cwd: opts.cwd,
      status: 'starting',
      model: opts.model ?? null,
      activeModel: null,
      effort: opts.effort ?? null,
      permissionMode: opts.permissionMode ?? 'default',
      startedAt: Date.now(),
      turnStartedAt: null,
      turnPausedMs: 0,
    };
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  /** Loads prior transcript from disk when resuming. Call before anyone subscribes. */
  async loadHistory(): Promise<void> {
    if (!this.opts.resume) return;
    for (const m of await loadTranscript(this.opts.resume, this.opts.cwd)) this.record(m);
    this.costTotal = await savedCostTotal(this.opts.resume);
  }

  /** Spawns the CLI and waits for its initialize handshake. */
  async spawn(): Promise<void> {
    this.q = query({
      prompt: this.input,
      options: {
        cwd: this.opts.cwd,
        ...(this.opts.resume ? { resume: this.opts.resume } : { sessionId: this.info.sessionId }),
        ...(this.opts.model ? { model: this.opts.model } : {}),
        ...(this.opts.effort ? { effort: this.opts.effort } : {}),
        permissionMode: this.info.permissionMode,
        // Only makes "bypassPermissions" selectable later; it is not turned on here.
        allowDangerouslySkipPermissions: true,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        settingSources: ['user', 'project', 'local'],
        includePartialMessages: true,
        canUseTool: this.canUseTool,
        env: {
          ...process.env,
          CLAUDE_AGENT_SDK_CLIENT_APP: 'ccwebui/0.1.0',
          // Sessions are stamped with this value, and the terminal's /resume picker hides the SDK ones
          // (sdk-ts/sdk-py/sdk-cli). "cli" won't do: a non-interactive CLI rewrites it to "sdk-cli".
          // A value the CLI doesn't recognize is recorded as-is, so these sessions show up in /resume.
          CLAUDE_CODE_ENTRYPOINT: 'ccwebui',
        },
        stderr: (data) => {
          if (this.debug) process.stderr.write(`[cli ${this.info.sessionId.slice(0, 8)}] ${data}`);
        },
      },
    });

    void this.pump();

    try {
      const init = await this.q.initializationResult();
      this.catalog = {
        models: init.models ?? [],
        commands: init.commands ?? [],
        terminalCommands: this.terminalCommands,
        skills: await this.loadSkills(),
        account: init.account,
      };
      this.emit({ type: 'catalog', liveId: this.info.liveId, catalog: this.catalog });
      void this.refreshContext();
    } catch (err) {
      this.emit({ type: 'error', liveId: this.info.liveId, message: `初始化失败: ${errorText(err)}` });
    }
    if (this.info.status === 'starting') this.updateStatus();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    this.lastActive = Date.now();
    return () => {
      this.listeners.delete(listener);
      this.lastActive = Date.now();
    };
  }

  snapshot(reqId?: string): ServerMsg {
    return {
      type: 'snapshot',
      reqId,
      live: this.info,
      entries: this.transcript,
      catalog: this.catalog,
      pending: [...this.pending.values()].map((p) => p.request),
      context: this.context,
    };
  }

  /** Re-reads context usage. 'summary' answers from local estimates (~40ms, no API calls). */
  async refreshContext(): Promise<void> {
    if (!this.q || this.contextInFlight || this.info.status === 'closed') return;
    this.contextInFlight = true;
    try {
      const u = await this.q.getContextUsage({ detail: 'summary' });
      this.context = {
        model: u.model,
        totalTokens: u.totalTokens,
        maxTokens: u.rawMaxTokens || u.maxTokens,
        percentage: u.percentage,
        categories: u.categories.map((c) => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
      };
      this.emit({ type: 'context', liveId: this.info.liveId, usage: this.context });
    } catch (err) {
      if (this.debug) console.error('[ccwebui] getContextUsage failed:', err);
    } finally {
      this.contextInFlight = false;
    }
  }

  send(text: string, attachments: Attachment[] = []): void {
    if (this.info.status === 'closed') return;
    this.used = true;
    const uuid = randomUUID();
    // Plain strings keep slash commands working; attachments need content blocks.
    const message = { role: 'user' as const, content: attachments.length ? buildContent(text, attachments) : text };
    this.record({ type: 'user', uuid, session_id: this.info.sessionId, parent_tool_use_id: null, message });
    this.input.push({
      type: 'user',
      uuid,
      session_id: this.info.sessionId,
      parent_tool_use_id: null,
      message,
      origin: { kind: 'human' },
    });
    this.turnRunning = true;
    this.updateStatus();
  }

  /** Applies plugin enable/disable changes made on disk to this session. */
  async reloadPlugins(): Promise<void> {
    if (!this.q) return;
    const { commands } = await this.q.reloadPlugins();
    this.updateCatalog({ commands, skills: await this.loadSkills() });
  }

  private async loadSkills() {
    try {
      return (await this.q!.reloadSkills()).skills;
    } catch {
      return [];
    }
  }

  async interrupt(): Promise<void> {
    await this.q?.interrupt();
  }

  async setModel(model: string | null): Promise<void> {
    await this.q?.setModel(model ?? undefined);
    this.info.model = model;
    this.updateStatus(true);
  }

  async setEffort(effort: EffortLevel | null): Promise<void> {
    await this.q?.applyFlagSettings({ effortLevel: effort });
    this.info.effort = effort;
    this.updateStatus(true);
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await this.q?.setPermissionMode(mode);
    this.info.permissionMode = mode;
    this.updateStatus(true);
  }

  respond(requestId: string, decision: PermissionDecision): void {
    const p = this.pending.get(requestId);
    if (!p) return;
    if (decision.behavior === 'deny') {
      p.finish({
        behavior: 'deny',
        message: decision.message?.trim() || 'The user denied this action.',
        ...(decision.interrupt ? { interrupt: true } : {}),
      });
      return;
    }
    const updates: PermissionUpdate[] = [];
    if (decision.always && p.suggestions) updates.push(...p.suggestions);
    if (decision.permissionMode) {
      updates.push({ type: 'setMode', mode: decision.permissionMode, destination: 'session' });
      this.info.permissionMode = decision.permissionMode;
    }
    p.finish({
      behavior: 'allow',
      updatedInput: decision.updatedInput ?? p.input,
      ...(updates.length ? { updatedPermissions: updates } : {}),
    });
  }

  close(): void {
    if (this.info.status === 'closed') return;
    for (const p of [...this.pending.values()]) p.finish({ behavior: 'deny', message: 'Session closed.' });
    this.input.close();
    if (this.q) this.q.close();
    else this.markExited();
    this.info.status = 'closed';
    this.onStateChange(this);
  }

  /** True when nobody is watching and nothing is happening for a while. */
  isReapable(now: number): boolean {
    const limit = this.used ? IDLE_REAP_MS : UNUSED_REAP_MS;
    return this.listeners.size === 0 && this.info.status === 'idle' && now - this.lastActive > limit;
  }

  private canUseTool: CanUseTool = (toolName, input, options) =>
    new Promise<PermissionResult>((resolve) => {
      const requestId = randomUUID();
      const onAbort = () => finish({ behavior: 'deny', message: 'Aborted.' });
      const finish = (result: PermissionResult) => {
        if (!this.pending.delete(requestId)) return;
        options.signal.removeEventListener('abort', onAbort);
        this.emit({ type: 'permissionResolved', liveId: this.info.liveId, requestId });
        this.updateStatus();
        resolve(result);
      };
      options.signal.addEventListener('abort', onAbort, { once: true });

      const request: PermissionRequest = {
        requestId,
        toolName,
        toolUseID: options.toolUseID,
        input,
        title: options.title,
        description: options.description,
        decisionReason: options.decisionReason,
        blockedPath: options.blockedPath,
        agentID: options.agentID,
        canAlwaysAllow: !!options.suggestions?.length && !options.suppressAlwaysAllowRule,
        defaultToNo: options.defaultToNo,
      };
      this.pending.set(requestId, { request, input, suggestions: options.suggestions, finish });
      this.emit({ type: 'permission', liveId: this.info.liveId, request });
      this.updateStatus();
    });

  private async pump(): Promise<void> {
    try {
      for await (const msg of this.q!) this.handle(msg);
    } catch (err) {
      this.emit({ type: 'error', liveId: this.info.liveId, message: `Claude Code 进程异常: ${errorText(err)}` });
    } finally {
      this.close();
      this.markExited();
    }
  }

  private updateCatalog(patch: Partial<Catalog>): void {
    if (!this.catalog) return;
    this.catalog = { ...this.catalog, ...patch };
    this.emit({ type: 'catalog', liveId: this.info.liveId, catalog: this.catalog });
  }

  private handle(msg: SDKMessage): void {
    this.lastActive = Date.now();
    if (msg.type === 'stream_event') {
      this.emit({
        type: 'stream',
        liveId: this.info.liveId,
        event: msg.event,
        parentToolUseId: msg.parent_tool_use_id,
      });
      return;
    }
    if (msg.type === 'system') {
      switch (msg.subtype) {
        case 'init':
          this.info.activeModel = msg.model;
          if (msg.effort !== undefined) this.info.activeEffort = msg.effort;
          this.info.permissionMode = msg.permissionMode;
          this.terminalCommands = msg.terminal_slash_commands ?? [];
          this.updateCatalog({ terminalCommands: this.terminalCommands });
          this.updateStatus(true);
          return;
        case 'status':
          if (msg.permissionMode && msg.permissionMode !== this.info.permissionMode) {
            this.info.permissionMode = msg.permissionMode;
            this.updateStatus(true);
          }
          return;
        case 'session_state_changed':
          this.turnRunning = msg.state !== 'idle';
          this.updateStatus();
          return;
        case 'commands_changed':
          this.updateCatalog({ commands: msg.commands });
          return;
        case 'thinking_tokens':
          this.emit({ type: 'thinking', liveId: this.info.liveId, tokens: msg.estimated_tokens });
          return;
      }
      if (!RECORDED_SYSTEM.has(msg.subtype)) return;
      if (msg.subtype === 'compact_boundary') void this.refreshContext();
    }
    if (msg.type === 'result') {
      this.turnRunning = false;
      this.record({ ...msg, ...this.turnCost(msg.total_cost_usd) } as TranscriptEntry);
      this.updateStatus();
      void this.refreshContext();
      return;
    }
    this.record(msg as TranscriptEntry);
  }

  /**
   * total_cost_usd is a running total for this query() call — continued from the saved total
   * when resuming — so a turn's cost is the difference from the previous result's total.
   */
  private turnCost(total: unknown): ResultCost {
    if (typeof total !== 'number' || !Number.isFinite(total)) return {};
    // Crash results can carry a zeroed total; don't let that reset the baseline.
    if (total === 0) return {};
    // A smaller total means the CLI reset it (e.g. a mid-session /clear): it's all new spend.
    const turn = total >= this.costTotal ? total - this.costTotal : total;
    this.costTotal = total;
    return { turn_cost_usd: turn, session_cost_usd: total };
  }

  private record(entry: TranscriptEntry): void {
    if (entry.uuid) {
      if (this.seen.has(entry.uuid)) return;
      this.seen.add(entry.uuid);
    }
    this.transcript.push(entry);
    this.emit({ type: 'entry', liveId: this.info.liveId, entry });
  }

  /** Recomputes status; `force` broadcasts even when the status itself didn't change. */
  private updateStatus(force = false): void {
    if (this.info.status === 'closed') return;
    const next = this.pending.size > 0 ? 'waiting' : this.turnRunning ? 'running' : this.q ? 'idle' : 'starting';
    this.trackTurnClock(next);
    if (next === this.info.status && !force) return;
    this.info.status = next;
    this.onStateChange(this);
  }

  /** Starts the turn clock with the turn and banks permission waits into `turnPausedMs`. */
  private trackTurnClock(next: LiveStatus): void {
    const now = Date.now();
    if (next !== 'running' && next !== 'waiting') {
      this.info.turnStartedAt = null;
      this.info.turnPausedMs = 0;
      this.pausedAt = null;
      return;
    }
    this.info.turnStartedAt ??= now;
    if (next === 'waiting') this.pausedAt ??= now;
    else if (this.pausedAt !== null) {
      this.info.turnPausedMs += now - this.pausedAt;
      this.pausedAt = null;
    }
  }

  private emit(msg: ServerMsg): void {
    for (const listener of this.listeners) listener(msg);
  }
}

/** Owns all live sessions and fans out state changes to every connected client. */
export class LiveManager {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly watchers = new Set<Listener>();
  private readonly reaper: NodeJS.Timeout;
  private readonly debug: boolean;

  constructor(debug: boolean) {
    this.debug = debug;
    this.reaper = setInterval(() => {
      const now = Date.now();
      for (const s of this.sessions.values()) if (s.isReapable(now)) s.close();
    }, 30_000);
    this.reaper.unref();
  }

  /** Starts a session, or returns the live one already driving `opts.resume`. */
  async start(opts: StartOptions): Promise<LiveSession> {
    if (opts.resume) {
      for (const s of this.sessions.values()) {
        if (s.info.sessionId === opts.resume && s.info.status !== 'closed') return s;
      }
    }
    const live = new LiveSession(opts, (s) => this.changed(s), this.debug);
    // History goes in before the caller subscribes, so its snapshot is complete.
    await live.loadHistory();
    this.sessions.set(live.info.liveId, live);
    this.changed(live);
    live.spawn().catch((err) => {
      console.error('[ccwebui] failed to start Claude Code:', err);
      live.close();
    });
    return live;
  }

  get(liveId: string): LiveSession | undefined {
    return this.sessions.get(liveId);
  }

  /** Stops the process driving `sessionId`, if any, and waits for it to exit. */
  async stopSession(sessionId: string): Promise<void> {
    const live = [...this.sessions.values()].find((s) => s.info.sessionId === sessionId);
    if (!live) return;
    live.close();
    await Promise.race([live.exited, new Promise((r) => setTimeout(r, 5000))]);
  }

  list() {
    return [...this.sessions.values()].map((s) => s.info);
  }

  watch(listener: Listener): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  closeAll(): void {
    clearInterval(this.reaper);
    for (const s of this.sessions.values()) s.close();
  }

  private changed(live: LiveSession): void {
    if (live.info.status === 'closed') this.sessions.delete(live.info.liveId);
    const msg: ServerMsg = { type: 'state', live: { ...live.info } };
    for (const w of this.watchers) w(msg);
  }
}

function buildContent(text: string, attachments: Attachment[]): any[] {
  const content: any[] = [];
  for (const a of attachments) {
    if (a.kind === 'image') {
      if (!IMAGE_TYPES.has(a.mediaType)) throw new Error(`不支持的图片格式：${a.mediaType}`);
      content.push({ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } });
    } else {
      // The web UI recognizes this wrapper and shows it as a file chip.
      const name = a.name.replace(/"/g, "'");
      content.push({ type: 'text', text: `<attachment filename="${name}">
${a.text}
</attachment>` });
    }
  }
  if (text.trim()) content.push({ type: 'text', text });
  return content;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
