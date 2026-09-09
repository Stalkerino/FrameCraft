import {randomUUID} from 'node:crypto';

/** Sends presence only after a real MCP client completes protocol initialization. */
export class McpPresenceService {
  private readonly id = randomUUID();
  private timer?: ReturnType<typeof setInterval>;
  private clientName = 'Codex';
  private queue: Promise<void> = Promise.resolve();
  private stopped = true;
  private reportedOffline = false;
  constructor(private baseUrl: string) {}
  start(clientName: string) {
    if(!this.stopped) return;
    this.stopped = false; this.clientName = clientName;
    this.sendHeartbeat();
    this.timer = setInterval(() => this.sendHeartbeat(), 10_000);
    this.timer.unref();
  }
  private async request(state: 'connected' | 'disconnected') {
    const response = await fetch(`${this.baseUrl}/api/agent/presence`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id: this.id, clientName: this.clientName, state}),
      signal: AbortSignal.timeout(3000),
    });
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
  }
  private sendHeartbeat() {
    this.queue = this.queue.then(async () => {
      if(this.stopped) return;
      try {await this.request('connected'); this.reportedOffline = false;}
      catch {
        if(!this.reportedOffline) console.error(`Framecraft cannot reach its editor at ${this.baseUrl}. Keep "npm run dev" running in the Framecraft folder. The bridge will reconnect automatically.`);
        this.reportedOffline = true;
      }
    });
  }
  stop() {
    if(this.stopped) return this.queue;
    this.stopped = true; clearInterval(this.timer);
    // Wait for any in-flight heartbeat so it cannot recreate a disconnected session.
    this.queue = this.queue.then(() => this.request('disconnected')).catch(() => undefined);
    return this.queue;
  }
}
