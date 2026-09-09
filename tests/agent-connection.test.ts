import {describe, expect, it} from 'vitest';
import {AgentConnectionService} from '../server/services/agent-connection-service';

describe('agent session presence', () => {
  it('keeps an idle session connected with heartbeats, without requiring tool calls', () => {
    let now = 1000; const service = new AgentConnectionService(() => now);
    service.heartbeat('one', 'Codex'); const connectedAt = service.active()[0].connectedAt;
    for(let i = 0; i < 12; i++) {now += 10_000; service.heartbeat('one', 'Codex');}
    expect(service.active()).toHaveLength(1); expect(service.active()[0].connectedAt).toBe(connectedAt);
    expect(service.active()[0].lastSeen).toBe(new Date(now).toISOString());
  });
  it('expires crashed sessions and removes explicitly closed sessions separately', () => {
    let now = 1000; const service = new AgentConnectionService(() => now);
    service.heartbeat('one', 'First'); service.heartbeat('two', 'Second');
    service.disconnect('one'); expect(service.active().map(s => s.clientName)).toEqual(['Second']);
    now += 35_000; expect(service.active()).toEqual([]);
  });
  it('does not expose mutable internal session records', () => {
    const service = new AgentConnectionService(); service.heartbeat('one', 'Codex');
    service.active()[0].clientName = 'Changed'; expect(service.active()[0].clientName).toBe('Codex');
  });
});
