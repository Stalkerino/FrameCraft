import type {AgentModelSettings, AgentReply, AgentSession} from '../../shared/agent';
import {subscribeWorkspace} from './workspace-events';

async function request(action: string, body: unknown = {}): Promise<void> {
  const response = await fetch(`/api/agent/chat/${action}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const result = await response.json();
  if(!response.ok) throw new Error(result.error || 'Codex could not complete this action.');
}
export const agentApi = {
  start: (fresh = false) => request('start', {fresh}),
  send: (text: string) => request('message', {text}),
  interrupt: () => request('interrupt'),
  respond: (reply: AgentReply) => request('response', reply),
  autoApprove: (enabled: boolean) => request('auto-approve', {enabled}),
  refreshModels: () => request('models/refresh'),
  configure: (settings: AgentModelSettings) => request('settings', settings),
  subscribe(onState: (state: AgentSession) => void, onDisconnect: () => void) {
    return subscribeWorkspace('agent', onState, onDisconnect);
  },
};
