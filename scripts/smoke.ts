// End-to-end smoke test against a running server. Talks to real Claude (small cost).
// Usage: node scripts/smoke.ts <port> <cwd> [token]   (token only when the server runs with --token)
import { WebSocket } from 'ws';
import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';

const [port, cwd, token] = process.argv.slice(2);
const query = token ? `?token=${encodeURIComponent(token)}` : '';
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`, { headers: { Origin: `http://127.0.0.1:${port}` } });
const inbox: ServerMsg[] = [];
let waiters: Array<() => void> = [];
ws.on('message', (raw) => {
  inbox.push(JSON.parse(raw.toString()));
  for (const w of waiters.splice(0)) w();
});
const send = (m: ClientMsg) => ws.send(JSON.stringify(m));
const log = (...a: unknown[]) => console.log('[smoke]', ...a);

async function waitFor<T extends ServerMsg>(pred: (m: ServerMsg) => m is T, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let seen = 0;
  for (;;) {
    for (; seen < inbox.length; seen++) if (pred(inbox[seen])) return inbox.splice(seen, 1)[0] as T;
    if (Date.now() > deadline) throw new Error('timeout waiting for message');
    await new Promise<void>((r) => {
      waiters.push(r);
      setTimeout(r, 1000);
    });
  }
}
const is =
  <K extends ServerMsg['type']>(type: K, extra: (m: Extract<ServerMsg, { type: K }>) => boolean = () => true) =>
  (m: ServerMsg): m is Extract<ServerMsg, { type: K }> =>
    m.type === type && extra(m as Extract<ServerMsg, { type: K }>);

await new Promise((r) => ws.once('open', r));
log('connected');

// 1. New session, streaming reply.
send({ type: 'start', reqId: 'r1', cwd, permissionMode: 'default', effort: 'low' });
const snap = await waitFor(is('snapshot', (m) => m.reqId === 'r1'));
const liveId = snap.live.liveId;
const sessionId = snap.live.sessionId;
log('started', { liveId, sessionId, status: snap.live.status });

const catalog = await waitFor(is('catalog'));
log('catalog', {
  models: catalog.catalog.models.map((m) => `${m.value}[${m.supportedEffortLevels?.join('/') ?? '-'}]`),
  commands: catalog.catalog.commands.length,
  sample: catalog.catalog.commands.slice(0, 6).map((c) => c.name),
});

send({ type: 'send', liveId, text: 'Reply with exactly the word PONG and nothing else. Do not use any tools.' });
const r1 = await waitFor(is('entry', (m) => m.entry.type === 'result'));
const streamed = inbox.filter((m) => m.type === 'stream').length;
const assistant = inbox.filter((m): m is Extract<ServerMsg, { type: 'entry' }> => m.type === 'entry' && m.entry.type === 'assistant');
const reply = assistant.flatMap((m) => m.entry.message?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
log('turn 1', { subtype: (r1.entry as any).subtype, streamEvents: streamed, reply: reply.trim() });
inbox.length = 0;

// 2. Permission round-trip: a Write in default mode must ask.
send({ type: 'send', liveId, text: 'Use the Write tool to create a file named smoke-note.txt in the current directory containing the single line: hello from ccwebui. Then say DONE.' });
const perm = await waitFor(is('permission'));
log('permission asked', { tool: perm.request.toolName, title: perm.request.title, canAlwaysAllow: perm.request.canAlwaysAllow, input: perm.request.input });
send({ type: 'permission', liveId, requestId: perm.request.requestId, decision: { behavior: 'allow' } });
await waitFor(is('permissionResolved'));
const r2 = await waitFor(is('entry', (m) => m.entry.type === 'result'));
log('turn 2', { subtype: (r2.entry as any).subtype });
inbox.length = 0;

// 3. Mid-session controls.
send({ type: 'setEffort', liveId, effort: 'medium' });
send({ type: 'setPermissionMode', liveId, mode: 'acceptEdits' });
const st = await waitFor(is('state', (m) => m.live.liveId === liveId && m.live.permissionMode === 'acceptEdits'));
log('controls applied', { effort: st.live.effort, mode: st.live.permissionMode });
const errs = inbox.filter((m) => m.type === 'error');
if (errs.length) log('errors so far', errs);

// 4. Close and resume from disk: history must come back.
send({ type: 'close', liveId });
await waitFor(is('state', (m) => m.live.liveId === liveId && m.live.status === 'closed'));
log('closed');
await new Promise((r) => setTimeout(r, 1500));
send({ type: 'start', reqId: 'r2', cwd, resume: sessionId });
const snap2 = await waitFor(is('snapshot', (m) => m.reqId === 'r2'));
const kinds = snap2.entries.map((e) => e.type);
log('resumed', { sameSession: snap2.live.sessionId === sessionId, entries: snap2.entries.length, users: kinds.filter((k) => k === 'user').length, assistants: kinds.filter((k) => k === 'assistant').length });
send({ type: 'send', liveId: snap2.live.liveId, text: 'What single word did you reply with in your first answer? Reply with just that word.' });
const r3 = await waitFor(is('entry', (m) => m.entry.type === 'result'));
log('turn 3 (after resume)', { result: (r3.entry as any).result });
send({ type: 'close', liveId: snap2.live.liveId });
await new Promise((r) => setTimeout(r, 500));
ws.close();
log('ALL OK');
process.exit(0);
