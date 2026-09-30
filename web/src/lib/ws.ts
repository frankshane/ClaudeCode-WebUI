import type { ClientMsg, ServerMsg } from '../../../shared/protocol.ts';

export type ConnStatus = 'connecting' | 'open' | 'closed';

/** WebSocket with exponential-backoff reconnect and an outbox for offline sends. */
export class Connection {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private outbox: ClientMsg[] = [];
  private readonly url: () => string;
  private readonly onMessage: (msg: ServerMsg) => void;
  private readonly onStatus: (status: ConnStatus) => void;

  constructor(url: () => string, onMessage: (msg: ServerMsg) => void, onStatus: (status: ConnStatus) => void) {
    this.url = url;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
  }

  connect(): void {
    this.onStatus('connecting');
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      // The store re-issues start/attach for the current view on open; drop stale ones.
      const queued = this.outbox.filter((m) => m.type !== 'start' && m.type !== 'attach');
      this.outbox = [];
      this.onStatus('open');
      for (const msg of queued) ws.send(JSON.stringify(msg));
    };
    ws.onmessage = (ev) => {
      try {
        this.onMessage(JSON.parse(ev.data));
      } catch (err) {
        console.error('[ccwebui] bad message', err);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.onStatus('closed');
      const delay = Math.min(10_000, 500 * 2 ** this.attempts++);
      setTimeout(() => this.connect(), delay);
    };
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.outbox.push(msg);
  }
}
