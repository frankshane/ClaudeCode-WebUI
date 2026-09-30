import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AvailablePlugin, InstalledPlugin, PluginActionResult, PluginCatalog } from '../../shared/protocol.ts';

/** The CLI binary bundled with the SDK (same version the sessions run), else `claude` on PATH. */
function claudeBinary(): string {
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  for (const suffix of ['', '-musl']) {
    try {
      const pkg = fileURLToPath(import.meta.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${suffix}/package.json`));
      const bin = join(dirname(pkg), exe);
      if (existsSync(bin)) return bin;
    } catch {
      // Not installed for this platform variant.
    }
  }
  return 'claude';
}

const CLAUDE = claudeBinary();
const PLUGIN_ID = /^[\w.-]+(@[\w.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const SCOPES = new Set(['user', 'project', 'local']);

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the CLI without throwing on a non-zero exit (`--json` commands report failures on stdout). */
function claude(args: string[], timeout = 60_000): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(CLAUDE, args, { timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as any).code === 'number' ? (err as any).code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr || (err && !stdout ? err.message : '')) });
    });
  });
}

function failure(r: RunResult): Error {
  const detail = (r.stderr || r.stdout).trim().replace(/^✘\s*/gm, '');
  return new Error(detail.split('\n').slice(-3).join(' ') || 'claude 命令执行失败');
}

/** Plugin commands edit shared settings files, so they run one at a time. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}

interface RawInstalled {
  id: string;
  version?: string;
  scope: string;
  enabled: boolean;
  installPath?: string;
}

interface RawAvailable {
  pluginId: string;
  name: string;
  description?: string;
  marketplaceName: string;
  installCount?: number;
}

function splitId(id: string): { name: string; marketplace: string } {
  const at = id.lastIndexOf('@');
  return at > 0 ? { name: id.slice(0, at), marketplace: id.slice(at + 1) } : { name: id, marketplace: '' };
}

async function toInstalled(p: RawInstalled): Promise<InstalledPlugin> {
  return {
    id: p.id,
    ...splitId(p.id),
    version: p.version,
    scope: p.scope,
    enabled: p.enabled,
    description: p.installPath ? await manifestDescription(p.installPath) : undefined,
  };
}

/** Installed plugins plus everything the configured marketplaces offer (from their local copies). */
export async function pluginCatalog(): Promise<PluginCatalog> {
  const r = await claude(['plugin', 'list', '--available', '--json']);
  if (r.code !== 0) throw failure(r);
  const raw = JSON.parse(r.stdout) as { installed: RawInstalled[]; available: RawAvailable[] };
  const available: AvailablePlugin[] = raw.available.map((p) => ({
    id: p.pluginId,
    name: p.name,
    marketplace: p.marketplaceName,
    description: p.description,
    installCount: p.installCount,
  }));
  available.sort((a, b) => (b.installCount ?? 0) - (a.installCount ?? 0) || a.name.localeCompare(b.name));
  return { installed: await Promise.all(raw.installed.map(toInstalled)), available };
}

async function manifestDescription(installPath: string): Promise<string | undefined> {
  try {
    const manifest = JSON.parse(await readFile(join(installPath, '.claude-plugin', 'plugin.json'), 'utf8'));
    return typeof manifest.description === 'string' ? manifest.description : undefined;
  } catch {
    return undefined;
  }
}

export function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  if (!PLUGIN_ID.test(id)) throw new Error('无效的插件 ID');
  return serial(async () => {
    const r = await claude(['plugin', enabled ? 'enable' : 'disable', id]);
    if (r.code !== 0) throw failure(r);
  });
}

/** Parses the one JSON line a `--json` plugin command prints. */
function parseResult(r: RunResult): any {
  const line = r.stdout
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('{'));
  if (!line) throw failure(r);
  return JSON.parse(line);
}

/** How a marketplace-declared command reads when shown to the user. */
function describeCommand(shown: Record<string, unknown>): string {
  const cmd = shown.command;
  const args = Array.isArray(shown.args) ? shown.args.map(String) : [];
  if (typeof cmd === 'string') return [cmd, ...args].join(' ');
  if (Array.isArray(cmd)) return cmd.map(String).join(' ');
  const { sha256: _sha, ...rest } = shown;
  return JSON.stringify(rest, null, 2);
}

function actionResult(json: any): PluginActionResult {
  const shown = json.shownCommand;
  if (json.outcome !== 'ok' && shown && typeof shown.sha256 === 'string' && SHA256.test(shown.sha256)) {
    return { ok: false, message: json.message ?? '', confirm: { command: describeCommand(shown), sha256: shown.sha256 } };
  }
  return { ok: json.outcome === 'ok', message: String(json.message ?? '') };
}

/**
 * Installs `id` for the user. A plugin that installs by running a marketplace-declared command
 * comes back with `confirm`; only an explicit retry carrying that command's sha256 runs it.
 */
export function installPlugin(id: string, acceptCommand?: string): Promise<PluginActionResult> {
  if (!PLUGIN_ID.test(id)) throw new Error('无效的插件 ID');
  if (acceptCommand !== undefined && !SHA256.test(acceptCommand)) throw new Error('无效的命令校验值');
  return serial(async () => {
    const args = ['plugin', 'install', id, '--json', '--scope', 'user'];
    if (acceptCommand) args.push('--accept-command', acceptCommand);
    // Git-hosted plugins are cloned, which can take a while.
    return actionResult(parseResult(await claude(args, 5 * 60_000)));
  });
}

export function uninstallPlugin(id: string, scope = 'user'): Promise<PluginActionResult> {
  if (!PLUGIN_ID.test(id)) throw new Error('无效的插件 ID');
  if (!SCOPES.has(scope)) throw new Error('无效的安装范围');
  return serial(async () => actionResult(parseResult(await claude(['plugin', 'uninstall', id, '--json', '--scope', scope]))));
}

/** Pulls every configured marketplace's catalog from its source (needs network access). */
export function updateMarketplaces(): Promise<PluginActionResult> {
  return serial(async () => {
    const r = await claude(['plugin', 'marketplace', 'update'], 3 * 60_000);
    if (r.code !== 0) return { ok: false, message: failure(r).message };
    return { ok: true, message: r.stdout.trim().split('\n').slice(-1)[0] || '市场目录已更新' };
  });
}

/** Version of the Claude Code CLI the SDK bundles. */
export async function claudeCodeVersion(): Promise<string | null> {
  try {
    // package.json isn't in the SDK's `exports`; it sits next to the resolved entry file.
    const entry = fileURLToPath(import.meta.resolve('@anthropic-ai/claude-agent-sdk'));
    return JSON.parse(await readFile(join(dirname(entry), 'package.json'), 'utf8')).claudeCodeVersion ?? null;
  } catch {
    return null;
  }
}
