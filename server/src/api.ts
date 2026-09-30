import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { deleteSession, forkSession, listSessions, renameSession, tagSession } from '@anthropic-ai/claude-agent-sdk';
import { matchFiles } from './files.ts';
import type { LiveManager } from './live.ts';
import { cancelPick, pickFolder } from './picker.ts';
import { claudeCodeVersion, installPlugin, pluginCatalog, setPluginEnabled, uninstallPlugin, updateMarketplaces } from './plugins.ts';
import { searchSessions } from './search.ts';
import type { Meta, PluginActionResult } from '../../shared/protocol.ts';

export function createApi(manager: LiveManager, version: string): Hono {
  const api = new Hono();
  const ccVersion = claudeCodeVersion();

  api.get('/meta', async (c) =>
    c.json<Meta>({ version, claudeCodeVersion: await ccVersion, home: homedir(), platform: process.platform }),
  );

  /** Sessions of one project (`dir`), or of every project when `dir` is omitted; newest first. */
  api.get('/sessions', async (c) => {
    const dir = c.req.query('dir') || undefined;
    const limit = Number(c.req.query('limit') ?? 1000);
    const offset = Number(c.req.query('offset') ?? 0);
    const sessions = await listSessions({ dir, limit, offset, includeProgrammatic: true });
    return c.json(sessions.filter((s) => s.cwd));
  });

  api.post('/sessions/:id/rename', async (c) => {
    const { dir, title } = await c.req.json<{ dir: string; title: string }>();
    if (!title?.trim()) return c.json({ error: '标题不能为空' }, 400);
    await renameSession(c.req.param('id'), title.trim(), { dir });
    return c.json({ ok: true });
  });

  api.post('/sessions/:id/tag', async (c) => {
    const { dir, tag } = await c.req.json<{ dir: string; tag: string | null }>();
    await tagSession(c.req.param('id'), tag?.trim() || null, { dir });
    return c.json({ ok: true });
  });

  api.post('/sessions/:id/fork', async (c) => {
    const { dir, upToMessageId, title } = await c.req.json<{ dir: string; upToMessageId?: string; title?: string }>();
    const result = await forkSession(c.req.param('id'), { dir, upToMessageId, title });
    return c.json(result);
  });

  api.delete('/sessions/:id', async (c) => {
    const id = c.req.param('id');
    // Stop the process first so it can't recreate the file mid-delete.
    await manager.stopSession(id);
    await deleteSession(id, { dir: c.req.query('dir') });
    return c.json({ ok: true });
  });

  /** Full-text search; across every project when `dir` is omitted. */
  api.get('/search', async (c) => {
    return c.json(await searchSessions(c.req.query('dir') || undefined, c.req.query('q') ?? ''));
  });

  /** Installed plugins plus what the configured marketplaces offer. */
  api.get('/plugins', async (c) => c.json(await pluginCatalog()));

  /** Enables or disables a plugin in the user's settings; live sessions pick it up via reloadPlugins. */
  api.post('/plugins/toggle', async (c) => {
    const { id, enabled } = await c.req.json<{ id: string; enabled: boolean }>();
    await setPluginEnabled(id, enabled);
    return c.json(await pluginCatalog());
  });

  api.post('/plugins/install', async (c) => {
    const { id, acceptCommand } = await c.req.json<{ id: string; acceptCommand?: string }>();
    const result = await installPlugin(id, acceptCommand);
    return c.json<PluginActionResult>({ ...result, catalog: await pluginCatalog() });
  });

  api.post('/plugins/uninstall', async (c) => {
    const { id, scope } = await c.req.json<{ id: string; scope?: string }>();
    const result = await uninstallPlugin(id, scope);
    return c.json<PluginActionResult>({ ...result, catalog: await pluginCatalog() });
  });

  /** Refreshes marketplace catalogs from their sources (GitHub etc.). */
  api.post('/plugins/marketplaces/update', async (c) => {
    const result = await updateMarketplaces();
    return c.json<PluginActionResult>({ ...result, catalog: await pluginCatalog() });
  });

  /** `@` mention completion. */
  api.get('/files', async (c) => {
    const cwd = c.req.query('cwd');
    if (!cwd) return c.json({ error: 'cwd is required' }, 400);
    return c.json(await matchFiles(cwd, c.req.query('q') ?? ''));
  });

  api.get('/lives', (c) => c.json(manager.list()));

  /** Validates a directory the user typed in, expanding a leading `~`. */
  api.get('/fs/dir', async (c) => {
    const raw = (c.req.query('path') ?? '').trim();
    if (!raw) return c.json({ ok: false, error: '路径为空' });
    const expanded = raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\') ? homedir() + raw.slice(1) : raw;
    const path = resolve(expanded);
    try {
      const s = await stat(path);
      return s.isDirectory() ? c.json({ ok: true, path }) : c.json({ ok: false, error: '不是目录' });
    } catch {
      return c.json({ ok: false, error: '目录不存在' });
    }
  });

  /** Shows the OS folder dialog; the request stays open until the user picks, cancels, or DELETE closes it. */
  api.post('/fs/pick', async (c) => {
    const { id, near } = await c.req.json<{ id: string; near?: string }>();
    return c.json(await pickFolder(id, near || undefined));
  });

  api.delete('/fs/pick/:id', (c) => {
    cancelPick(c.req.param('id'));
    return c.json({ ok: true });
  });

  return api;
}
