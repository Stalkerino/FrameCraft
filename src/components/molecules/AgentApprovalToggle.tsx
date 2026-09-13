import {agentProviderNames} from '../../../shared/agent-providers';
import {ShieldCheck} from 'lucide-react';
import {useAgent} from '../../stores/agent-store';
export function AgentApprovalToggle() {
  const {session, online, pending, setAutoApprove} = useAgent();
  return <div className={`agent-auto-approve ${session.autoApprove ? 'enabled' : ''}`}>
    <label><ShieldCheck size={15}/><span>Auto-allow</span><input type="checkbox" role="switch" aria-label={session.provider === 'ollama' ? 'Automatically allow Ollama tool calls' : `Automatically allow ${agentProviderNames[session.provider ?? 'codex']} approvals`} checked={session.autoApprove} disabled={!online || pending} onChange={event => void setAutoApprove(event.target.checked)}/></label>
    <p>{session.autoApprove ? session.provider === 'ollama' ? 'Enabled tools, including workspace writes and commands, are allowed automatically. Every call remains visible in the conversation.' : 'Commands, file edits and tool permissions are allowed automatically. Uncheck to stop.' : 'Allow each approval while enabled. Questions still need your answer.'}</p>
  </div>;
}
