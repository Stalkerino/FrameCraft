import {CircleCheck, CircleAlert, LoaderCircle, Wrench} from 'lucide-react';
import type {AgentActivity} from '../../../shared/agent';

const labels: Record<string, string> = {inProgress: 'Running', completed: 'Completed', failed: 'Failed', interrupted: 'Stopped', declined: 'Declined'};

/** The same live call and output are shown in both conversation and activity views. */
export function AgentActivityItem({item}: {item: AgentActivity}) {
  const Icon = item.status === 'inProgress' ? LoaderCircle : item.status === 'completed' ? CircleCheck : item.status === 'failed' ? CircleAlert : Wrench;
  return <details className="agent-tool" data-agent-activity-id={item.id} data-status={item.status}>
    <summary><Icon size={13} aria-hidden="true" className={item.status === 'inProgress' ? 'spin' : undefined}/><span>{item.label}</span><small>{labels[item.status] ?? item.status}</small></summary>
    <pre>{item.detail || 'No output yet.'}</pre>
  </details>;
}
