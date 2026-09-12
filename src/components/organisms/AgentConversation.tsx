import {useEffect, useMemo, useRef} from 'react';
import {LoaderCircle, Sparkles} from 'lucide-react';
import {useAgent} from '../../stores/agent-store';
import {AgentMessage} from '../molecules/AgentMessage';
import {AgentRequestCard} from '../molecules/AgentRequestCard';
import {AgentComposer} from '../molecules/AgentComposer';
import {AgentApprovalToggle} from '../molecules/AgentApprovalToggle';
import {Button} from '../atoms/Button';
import {agentConversationEntries} from '../../../shared/agent';
import {AgentActivityItem} from '../molecules/AgentActivityItem';

export function AgentConversation() {
  const {session, online, pending, error, start} = useAgent();
  const providerName = session.provider === 'ollama' ? 'Ollama' : 'Codex';
  const entries = useMemo(() => agentConversationEntries(session), [session.messages, session.activity]);
  const viewport = useRef<HTMLDivElement>(null); const stick = useRef(true);
  useEffect(() => {if(stick.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;}, [entries, session.requests, session.status]);
  const starting = session.status === 'starting';
  return <div className="agent-conversation"><AgentApprovalToggle/><div className="agent-conversation__scroll" ref={viewport} onScroll={() => {const el = viewport.current!; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;}}>
    {!entries.length && <div className="agent-welcome"><div className="codex-orb"><Sparkles size={23}/></div><h3>Let’s make your next edit.</h3><p>Ask {providerName} to arrange footage, write titles, or build a transition. Changes appear on your timeline.</p></div>}
    {['idle', 'error', 'starting'].includes(session.status) && <Button className="agent-start" variant="primary" icon={starting ? <LoaderCircle size={15} className="spin"/> : <Sparkles size={15}/>} disabled={pending || starting || !online} onClick={() => void start()}>{starting ? `Connecting ${providerName}…` : session.status === 'error' ? `Reconnect ${providerName}` : `Start ${providerName}`}</Button>}
    {entries.map(entry => entry.kind === 'message' ? <AgentMessage key={`message-${entry.item.id}`} message={entry.item}/> : <AgentActivityItem key={`activity-${entry.item.id}`} item={entry.item}/>)}
    {session.requests.map(request => <AgentRequestCard key={request.id} request={request}/>)}
    {session.status === 'working' && <p className="agent-working" role="status"><LoaderCircle size={13} className="spin"/>{session.requests.length ? 'Waiting for your response' : `${providerName} is working…`}</p>}
    {(error || session.error) && <p className="agent-inline-error" role="alert">{error || session.error}</p>}
    {!online && <p className="agent-inline-error" role="alert">Connecting to the editor service…</p>}
  </div><AgentComposer/></div>;
}
