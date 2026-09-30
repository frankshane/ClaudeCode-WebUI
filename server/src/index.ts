import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { WebSocketServer, type WebSocket } from 'ws';
import { createApi } from './api.ts';
import { isFromForeignPage, isLoopbackHost, isLoopbackOrigin, loadToken, tokenMatches } from './auth.ts';
import { LiveManager, type LiveSession } from './live.ts';
import { cancelPick } from './picker.ts';
import { staticHandler } from './static.ts';
import type { ClientMsg, ServerMsg } from '../../shared/protocol.ts';

const here = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8'));

const { values: args } = parseArgs({
  options: {
    port: { type: 'string', default: process.env.CCWEBUI_PORT ?? '8787' },
    dev: { type: 'boolean', default: false },
    debug: { type: 'boolean', default: false },
    /** Require the access token (from ~/.ccwebui/token). Setting CCWEBUI_TOKEN turns it on too. */
    token: { type: 'boolean', default: false },
  },
});
const port = Number(args.port);
const HOST = '127.0.0.1';
/** null = no token check; the loopback bind and the Host/Origin checks below still apply. */
const token = args.token || process.env.CCWEBUI_TOKEN ? loadToken() : null;
const manager = new LiveManager(args.debug);

const app = new Hono();

app.use('*', async (c, next) => {
  if (!isLoopbackHost(c.req.header('host'))) return c.text('Forbidden host', 403);
  await next();
});
app.use('/api/*', async (c, next) => {
  if (isFromForeignPage(c.req.header('origin'), c.req.header('sec-fetch-site'))) {
    return c.json({ error: 'forbidden origin' }, 403);
  }
  const auth = c.req.header('authorization');
  if (token && !tokenMatches(token, auth?.startsWith('Bearer ') ? auth.slice(7) : null)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
});
app.route('/api', createApi(manager, version));
app.onError((err, c) => {
  console.error('[ccwebui] request failed:', err);
  return c.json({ error: err.message }, 500);
});
app.get('*', staticHandler(resolve(here, '..', '..', 'web', 'dist')));

const server = serve({ fetch: app.fetch, hostname: HOST, port }, () => {
  const hash = token ? `#token=${token}` : '';
  console.log(`\n  CC WebUI ${version} 已启动（仅本机可访问）\n`);
  if (args.dev) console.log(`  开发前端: http://localhost:5173/${hash}`);
  console.log(`  打开:     http://${HOST}:${port}/${hash}`);
  const note = !token
    ? '未开启令牌校验（需要时用 --token 启动）'
    : process.env.CCWEBUI_TOKEN
      ? '已开启令牌校验，令牌来自环境变量 CCWEBUI_TOKEN'
      : '已开启令牌校验，令牌保存在 ~/.ccwebui/token';
  console.log(`  ${note}，Ctrl+C 退出\n`);
});

// ---- WebSocket ----

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });

server.on('upgrade', (req: IncomingMessage, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const reject = (status: string) => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  if (url.pathname !== '/ws') return reject('404 Not Found');
  if (!isLoopbackHost(req.headers.host) || !isLoopbackOrigin(req.headers.origin)) return reject('403 Forbidden');
  if (token && !tokenMatches(token, url.searchParams.get('token'))) return reject('401 Unauthorized');
  wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws));
});

function onConnection(ws: WebSocket): void {
  const subscriptions = new Map<string, () => void>();
  const send = (msg: ServerMsg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const unwatch = manager.watch(send);
  send({ type: 'lives', lives: manager.list() });

  const attach = (live: LiveSession, reqId: string) => {
    if (!subscriptions.has(live.info.liveId)) subscriptions.set(live.info.liveId, live.subscribe(send));
    send(live.snapshot(reqId));
  };

  const withLive = (liveId: string, fn: (live: LiveSession) => unknown) => {
    const live = manager.get(liveId);
    if (!live) return send({ type: 'error', liveId, code: 'live_not_found', message: '会话进程已结束' });
    Promise.resolve(fn(live)).catch((err) =>
      send({ type: 'error', liveId, message: err instanceof Error ? err.message : String(err) }),
    );
  };

  ws.on('message', async (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send({ type: 'error', message: 'bad json' });
    }
    switch (msg.type) {
      case 'start':
        try {
          const live = await manager.start({
            cwd: msg.cwd,
            resume: msg.resume,
            model: msg.model,
            effort: msg.effort,
            permissionMode: msg.permissionMode,
          });
          attach(live, msg.reqId);
        } catch (err) {
          send({ type: 'error', reqId: msg.reqId, message: `启动失败: ${err instanceof Error ? err.message : err}` });
        }
        return;
      case 'attach': {
        const live = manager.get(msg.liveId);
        if (!live) return send({ type: 'error', reqId: msg.reqId, liveId: msg.liveId, code: 'live_not_found', message: '会话进程已结束' });
        return attach(live, msg.reqId);
      }
      case 'detach':
        subscriptions.get(msg.liveId)?.();
        subscriptions.delete(msg.liveId);
        return;
      case 'send':
        return withLive(msg.liveId, (l) => l.send(msg.text, msg.attachments));
      case 'reloadPlugins':
        return withLive(msg.liveId, (l) => l.reloadPlugins());
      case 'interrupt':
        return withLive(msg.liveId, (l) => l.interrupt());
      case 'permission':
        return withLive(msg.liveId, (l) => l.respond(msg.requestId, msg.decision));
      case 'setModel':
        return withLive(msg.liveId, (l) => l.setModel(msg.model));
      case 'setEffort':
        return withLive(msg.liveId, (l) => l.setEffort(msg.effort));
      case 'setPermissionMode':
        return withLive(msg.liveId, (l) => l.setPermissionMode(msg.mode));
      case 'close':
        return withLive(msg.liveId, (l) => l.close());
      case 'refreshContext':
        return withLive(msg.liveId, (l) => l.refreshContext());
    }
  });

  ws.on('close', () => {
    unwatch();
    for (const unsubscribe of subscriptions.values()) unsubscribe();
  });
}

function shutdown() {
  cancelPick();
  manager.closeAll();
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
