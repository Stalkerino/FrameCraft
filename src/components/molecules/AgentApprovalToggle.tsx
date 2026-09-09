import {ShieldCheck} from 'lucide-react';
import {useAgent} from '../../stores/agent-store';
export function AgentApprovalToggle() {
  const {session, online, pending, setAutoApprove} = useAgent();
  return <div className={`agent-auto-approve ${session.autoApprove ? 'enabled' : ''}`}>
    <label><ShieldCheck size={15}/><span>Auto-allow</span><input type="checkbox" role="switch" aria-label="Automatically allow Codex approvals" checked={session.autoApprove} disabled={!online || pending} onChange={event => void setAutoApprove(event.target.checked)}/></label>
    <p>{session.autoApprove ? 'Commands, file edits and tool permissions are allowed automatically. Uncheck to stop.' : 'Allow each approval while enabled. Questions still need your answer.'}</p>
  </div>;
}
