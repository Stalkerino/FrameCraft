export interface AgentConnection {id: string; clientName: string; connectedAt: string; lastSeen: string}

/** Presence comes from initialized MCP sessions, independently of editing activity. */
export class AgentConnectionService {
  private connections = new Map<string, AgentConnection>();
  constructor(private now: () => number = Date.now, private ttl = 35_000) {}
  heartbeat(id: string, clientName: string) {
    const at = new Date(this.now()).toISOString();
    const previous = this.connections.get(id);
    this.connections.set(id, {id, clientName, connectedAt: previous?.connectedAt ?? at, lastSeen: at});
  }
  disconnect(id: string) {this.connections.delete(id);}
  active() {
    const now = this.now();
    for(const [id, session] of this.connections) {
      if(now - Date.parse(session.lastSeen) >= this.ttl) this.connections.delete(id);
    }
    return [...this.connections.values()].map(session => ({...session}));
  }
}
