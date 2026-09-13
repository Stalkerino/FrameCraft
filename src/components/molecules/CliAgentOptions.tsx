import {useAgent} from '../../stores/agent-store';
import {Field} from '../atoms/Field';

export function CliAgentOptions() {
  const {session, online, pending, configureOption} = useAgent();
  const disabled = !online || pending || session.status !== 'ready';
  return <section className="agent-model-settings" aria-label="CLI session settings"><div className="agent-model-settings__heading">CLI session settings</div>
    <div className="cli-agent-options">{session.configOptions?.map(option => <Field key={option.id} label={option.name}><select aria-label={option.name} title={option.description} value={option.currentValue} disabled={disabled} onChange={event => void configureOption(option.id, event.target.value)}>{option.options.map(value => <option key={value.value} value={value.value}>{value.name}</option>)}</select></Field>)}</div>
    <p className="field-help">{session.configOptions?.length ? 'Settings are reported by, and applied directly to, this CLI session.' : session.status === 'ready' ? 'This agent does not expose session settings over ACP. Choose its model through its own configuration or launch arguments.' : 'Start the agent to load the models and options it exposes.'}</p>
  </section>;
}
