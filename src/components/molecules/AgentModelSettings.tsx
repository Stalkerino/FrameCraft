import {RefreshCw, SlidersHorizontal} from 'lucide-react';
import {useAgent} from '../../stores/agent-store';
import {Field} from '../atoms/Field';
import {IconButton} from '../atoms/Button';

const effortLabel = (value: string) => ({none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Maximum', ultra: 'Ultra'}[value] || value);

export function AgentModelSettings() {
  const {session, pending, online, configure, refreshModels} = useAgent();
  const models = session.models ?? [];
  const model = models.find(entry => entry.model === session.model);
  const disabled = !online || pending || session.status !== 'ready';
  const settings = {model: session.model!, effort: session.effort, serviceTier: session.serviceTier};
  const effort = model?.supportedReasoningEfforts.find(option => option.reasoningEffort === session.effort);
  const speed = model?.serviceTiers.find(option => option.id === session.serviceTier);
  return <div className="agent-model-settings">
    <div className="agent-model-settings__heading"><span><SlidersHorizontal size={12}/> Model settings</span><IconButton label="Refresh Codex models" disabled={disabled} onClick={() => void refreshModels()}><RefreshCw size={12}/></IconButton></div>
    <div className="agent-model-settings__fields">
      <Field label="Codex model"><select value={session.model ?? ''} disabled={disabled || !models.length} title={model?.description} onChange={event => {
        const next = models.find(entry => entry.model === event.target.value); if(!next) return;
        void configure({model: next.model, effort: next.defaultReasoningEffort, serviceTier: next.serviceTiers.some(tier => tier.id === session.serviceTier) ? session.serviceTier : null});
      }}>
        {!model && <option value={session.model ?? ''}>{session.model || 'Start Codex to load models'}</option>}
        {models.map(entry => <option key={entry.id} value={entry.model}>{entry.displayName}{entry.hidden ? ' · additional' : ''}</option>)}
      </select></Field>
      <Field label="Thinking effort"><select value={session.effort ?? ''} disabled={disabled || !model} title={effort?.description} onChange={event => void configure({...settings, effort: event.target.value || null})}>
        <option value="">Model default{model?.defaultReasoningEffort ? ` (${effortLabel(model.defaultReasoningEffort)})` : ''}</option>
        {session.effort && !effort && <option value={session.effort}>{effortLabel(session.effort)}</option>}
        {model?.supportedReasoningEfforts.map(option => <option key={option.reasoningEffort} value={option.reasoningEffort}>{effortLabel(option.reasoningEffort)}</option>)}
      </select></Field>
      <Field label="Response speed"><select value={session.serviceTier ?? ''} disabled={disabled || !model} onChange={event => void configure({...settings, serviceTier: event.target.value || null})}>
        <option value="">Standard</option>
        {session.serviceTier && !speed && <option value={session.serviceTier}>{session.serviceTier}</option>}
        {model?.serviceTiers.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select></Field>
    </div>
    <p className="agent-model-settings__hint">{session.status === 'working' ? 'Finish or stop this response to change settings.' : 'Applies to your next message in this conversation.'}</p>
    {effort && <p className="agent-model-settings__hint">{effort.description}</p>}
    {speed && <p className="agent-model-settings__hint">{speed.description}</p>}
    {session.modelsError && <p className="agent-model-settings__error" role="status">Could not load models: {session.modelsError}</p>}
  </div>;
}
