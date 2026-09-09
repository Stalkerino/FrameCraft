import {Activity, Maximize2, MessageSquare, Minimize2, Plus, RefreshCw, Sparkles, Unplug} from 'lucide-react';
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
  const [tab, setTab] = useState<'chat' | 'activity' | 'connection'>('chat');
  const [expanded, setExpanded] = useState(false); const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {if(expanded && dialog.current && !dialog.current.open) dialog.current.showModal();}, [expanded]);
  const content = <>
    <div className="agent-panel-heading"><div><Sparkles size={16}/><strong>Codex</strong><span>{session.model || 'Your editing partner'}</span></div><div><IconButton label="New Codex chat" disabled={!online || pending || session.status === 'working' || session.status === 'starting'} onClick={() => {setTab('chat'); void start(true);}}><Plus size={15}/></IconButton><IconButton label={expanded ? 'Collapse Codex chat' : 'Expand Codex chat'} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 size={15}/> : <Maximize2 size={15}/>}</IconButton></div></div>
    <div className="agent-connection-line"><span className={`connection-badge ${connected ? 'connected' : ''}`}><span className="status-dot"/>{error ? 'Editor service unavailable' : connected ? 'Codex connected' : 'Waiting for a Codex session'}</span><IconButton label="Check Codex connection" disabled={checking} onClick={() => void refresh()}><RefreshCw size={12} className={checking ? 'spin' : ''}/></IconButton></div>
    <div className="agent-tabs" role="tablist" aria-label="Codex views">{([{id: 'chat', label: 'Chat', icon: MessageSquare}, {id: 'activity', label: 'Activity', icon: Activity}, {id: 'connection', label: 'Connection', icon: Unplug}] as const).map(({id, label, icon: Icon}) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}><Icon size={13}/>{label}{id === 'chat' && session.requests.length > 0 && <span className="agent-request-count">{session.requests.length}</span>}</button>)}</div>
    {tab === 'chat' && <AgentModelSettings/>}
    <div className="agent-panel-content" role="tabpanel" aria-label={tab === 'chat' ? 'Codex chat' : tab === 'activity' ? 'Codex activity' : 'Codex connection'}>{tab === 'chat' ? <AgentConversation/> : tab === 'activity' ? <AgentActivityPanel/> : <AgentConnectionPanel status={status} error={error}/>}</div>
  </>;
  return <div className="codex-panel" onKeyDown={event => event.stopPropagation()}>{!expanded && content}{expanded && <><p className="field-help">The conversation is open in the expanded view.</p><dialog className="agent-dialog" aria-label="Expanded Codex chat" ref={dialog} onCancel={() => setExpanded(false)} onClose={() => setExpanded(false)}>{content}</dialog></>}</div>;
}
