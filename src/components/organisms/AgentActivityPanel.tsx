import {useAgent} from '../../stores/agent-store';
import {useEditor} from '../../stores/editor-store';
import type {Activity} from '../../../shared/project';
import {AgentActivityItem} from '../molecules/AgentActivityItem';
const empty: Activity[] = [];
export function AgentActivityPanel() {
  const providerName = useAgent(s => s.session.provider === 'ollama' ? 'OLLAMA' : 'CODEX');
  const activity = useAgent(s => s.session.activity);
  const edits = useEditor(s => s.snapshot?.activity || empty);
  return <div className="agent-activity-panel"><h4>{providerName} ACTIVITY</h4>{!activity.length && <p className="field-help">Tool calls, commands, and file changes from this chat appear here.</p>}
    {[...activity].reverse().map(item => <AgentActivityItem key={item.id} item={item}/>)}
    <h4>SHARED EDIT HISTORY</h4><div className="activity-list">{edits.map(item => <div key={item.id}><span className={`activity-dot ${item.source}`}/><p>{item.label}<small>{item.source === 'codex' ? 'AI assistant' : 'You'} · {new Date(item.at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</small></p></div>)}{!edits.length && <p className="field-help">Edits appear here and use the same undo history.</p>}</div>
  </div>;
}
