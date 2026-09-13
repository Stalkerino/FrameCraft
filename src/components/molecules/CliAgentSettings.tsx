import {useEffect, useState} from 'react';
import {cliAgentPresets, type CliAgentConfig, type CliAgentProvider} from '../../../shared/agent-providers';
import {Field} from '../atoms/Field';
import {useAgent} from '../../stores/agent-store';

export function CliAgentSettings({provider, value, disabled, onChange, onValidityChange}: {provider: CliAgentProvider; value: CliAgentConfig; disabled: boolean; onChange: (value: CliAgentConfig) => void; onValidityChange: (valid: boolean) => void}) {
  const [args, setArgs] = useState(JSON.stringify(value.args));
  const [error, setError] = useState(''); const preset = cliAgentPresets[provider];
  const methods = useAgent(state => state.session.provider === provider ? state.session.authMethods : undefined);
  useEffect(() => {setArgs(JSON.stringify(value.args)); setError(''); onValidityChange(true);}, [provider]);
  return <div className="cli-agent-settings">
    <p className="field-help">{preset.setup} <a href={preset.docs} target="_blank" rel="noreferrer">Setup guide</a></p>
    <Field label="CLI executable"><input aria-label="CLI executable" value={value.command} disabled={disabled} placeholder={preset.command || 'Full path to your ACP agent'} onChange={event => onChange({...value, command: event.target.value})}/></Field>
    <Field label="Arguments (JSON array)"><textarea aria-label="CLI arguments" rows={2} value={args} disabled={disabled} onChange={event => {
      setArgs(event.target.value);
      try {const parsed: unknown = JSON.parse(event.target.value); if(!Array.isArray(parsed) || !parsed.every(v => typeof v === 'string')) throw new Error(); onChange({...value, args: parsed}); setError(''); onValidityChange(true);}
      catch {setError('Enter a JSON array of strings, for example ["--experimental-acp"].'); onValidityChange(false);}
    }}/></Field>
    {error && <p className="agent-inline-error" role="alert">{error}</p>}
    <Field label="CLI working folder"><input aria-label="CLI working folder" value={value.cwd} disabled={disabled} placeholder="Framecraft folder (default)" onChange={event => onChange({...value, cwd: event.target.value})}/></Field>
    {!!methods?.length && <Field label="CLI authentication"><select aria-label="CLI authentication" disabled={disabled} value={value.authMethod ?? ''} onChange={event => onChange({...value, authMethod: event.target.value})}><option value="">Use existing CLI sign-in</option>{methods.map(method => <option key={method.id} value={method.id}>{method.name}</option>)}</select></Field>}
    <p className="field-help">Runs on the editor host with your CLI’s sign-in and native file/command permissions. Framecraft attaches its full MCP toolset automatically. Auto-allow answers the one-time permission requests the CLI sends here.</p>
  </div>;
}
