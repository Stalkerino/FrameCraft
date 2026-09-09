import {Check, Clipboard, Terminal} from 'lucide-react';
import {useState} from 'react';
import type {ServerStatus} from '../../services/editor-api';
import {useAgent} from '../../stores/agent-store';
import {Button} from '../atoms/Button';

export function AgentConnectionPanel({status, error}: {status: ServerStatus | null; error: string | null}) {
  const [copied, setCopied] = useState(false); const [copyError, setCopyError] = useState(false);
  const session = useAgent(s => s.session);
  const command = `codex mcp add framecraft -- node "${status?.rootDir.replaceAll('\\', '/') || '<project-folder>'}/scripts/mcp.mjs"`;
  return <div className="agent-connection-panel"><div className="codex-step"><Terminal size={16}/><div><h4>Built into your editor</h4><p>Start Codex from Chat. Framecraft connects the timeline tools automatically and uses your existing Codex sign-in. Send your editing requests here.</p></div></div>
    {error && <p className="connection-error" role="alert">{error}</p>}
    <p className="field-help">{status?.agentConnections.length || 0} active timeline connection(s). The indicator tracks initialized MCP sessions, including those in external terminals.</p>
    {session.threadId && <p className="field-help">Chat session: <code>{session.threadId}</code>. Your conversation reconnects after a page reload. After restarting Framecraft, click Start Codex to resume it.</p>}
    <details className="agent-manual"><summary>Use an external Codex terminal</summary><p className="field-help">Register once at your shell prompt, then run <code>codex</code> in the project folder. Keep Framecraft running.</p><code className="connection-command">{command}</code><Button className="copy-command" disabled={!status} icon={copied ? <Check size={14}/> : <Clipboard size={14}/>} onClick={() => {if(!navigator.clipboard) {setCopyError(true); return;} void navigator.clipboard.writeText(command).then(() => {setCopied(true); setCopyError(false);}).catch(() => setCopyError(true));}}>{copied ? 'Copied' : 'Copy registration command'}</Button>{copyError && <p className="field-help">Select and copy the command above.</p>}<p className="field-help">Type <code>/mcp</code> inside Codex to inspect tools and startup errors. External terminal conversations stay in that terminal.</p></details>
  </div>;
}
