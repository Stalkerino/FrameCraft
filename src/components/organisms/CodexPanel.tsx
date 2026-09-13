import {CliAgentOptions} from '../molecules/CliAgentOptions';
import {agentProviderNames, isCliAgent} from '../../../shared/agent-providers';
import {AgentProviderSettings} from '../molecules/AgentProviderSettings';
import {Activity, Maximize2, MessageSquare, Minimize2, Plus, RefreshCw, Settings2, Sparkles, Unplug} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {useAgentConnection} from '../../hooks/useAgentConnection';
import {useAgent} from '../../stores/agent-store';
import {IconButton} from '../atoms/Button';
import {AgentConversation} from './AgentConversation';
import {AgentActivityPanel} from './AgentActivityPanel';
import {AgentConnectionPanel} from './AgentConnectionPanel';
import {AgentModelSettings} from '../molecules/AgentModelSettings';

export function CodexPanel() {
  const {status, connected, checking, error, refresh} = useAgentConnection();
  const {session, pending, online, start} = useAgent();
  const local = session.provider === 'ollama'; const cli = isCliAgent(session.provider); const providerName = agentProviderNames[session.provider ?? 'codex'];
  const [tab, setTab] = useState<'chat' | 'activity' | 'connection' | 'settings'>('chat');
  const [expanded, setExpanded] = useState(false); const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {if(expanded && dialog.current && !dialog.current.open) dialog.current.showModal();}, [expanded]);
  const content = <>
    <div className="agent-panel-heading"><div><Sparkles size={16}/><strong>{providerName}</strong><span>{session.model || 'Your editing partner'}</span></div><div><IconButton label={`New ${providerName} chat`} disabled={!online || pending || session.status === 'working' || session.status === 'starting'} onClick={() => {setTab('chat'); void start(true);}}><Plus size={15}/></IconButton><IconButton label={expanded ? `Collapse ${providerName} chat` : `Expand ${providerName} chat`} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 size={15}/> : <Maximize2 size={15}/>}</IconButton></div></div>
    <div className="agent-connection-line"><span className={`connection-badge ${(local || cli ? ['ready', 'working'].includes(session.status) : connected) ? 'connected' : ''}`}><span className="status-dot"/>{error ? 'Editor service unavailable' : cli ? (['ready', 'working'].includes(session.status) ? `${providerName} session connected` : `${providerName} not connected`) : local ? (session.status === 'ready' || session.status === 'working' ? 'Ollama · MCP connected' : 'Ollama not connected') : connected ? 'Codex connected' : 'Waiting for a Codex session'}</span><IconButton label={`Check ${providerName} connection`} disabled={checking} onClick={() => void refresh()}><RefreshCw size={12} className={checking ? 'spin' : ''}/></IconButton></div>
    <div className="agent-tabs" role="tablist" aria-label={`${providerName} views`}>{([{id: 'chat', label: 'Chat', icon: MessageSquare}, {id: 'activity', label: 'Activity', icon: Activity}, {id: 'connection', label: 'Connection', icon: Unplug}, {id: 'settings', label: 'Settings', icon: Settings2}] as const).map(({id, label, icon: Icon}) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}><Icon size={13}/>{label}{id === 'chat' && session.requests.length > 0 && <span className="agent-request-count">{session.requests.length}</span>}</button>)}</div>
    <div className="agent-panel-content" role="tabpanel" aria-label={`${providerName} ${tab}`}>{tab === 'chat' ? <AgentConversation/> : tab === 'activity' ? <AgentActivityPanel/> : tab === 'settings' ? <div className="agent-settings-panel"><AgentProviderSettings/>{cli ? <CliAgentOptions/> : <AgentModelSettings/>}</div> : <AgentConnectionPanel status={status} error={error}/>}</div>
  </>;
  return <div className="codex-panel" onKeyDown={event => event.stopPropagation()}>{!expanded && content}{expanded && <><p className="field-help">The conversation is open in the expanded view.</p><dialog className="agent-dialog" aria-label={`Expanded ${providerName} chat`} ref={dialog} onCancel={() => setExpanded(false)} onClose={() => setExpanded(false)}>{content}</dialog></>}</div>;
}
