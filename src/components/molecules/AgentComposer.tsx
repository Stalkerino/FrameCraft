import {agentProviderNames} from '../../../shared/agent-providers';
import {Mic, MicOff, Send, Square} from 'lucide-react';
import {useRef} from 'react';
import {useDictation} from '../../hooks/useDictation';
import {useAgent} from '../../stores/agent-store';
import {Button, IconButton} from '../atoms/Button';

export function AgentComposer() {
  const {draft, session, online, pending, send, interrupt} = useAgent();
  const base = useRef('');
  const voice = useDictation(text => useAgent.setState({draft: [base.current, text].filter(Boolean).join(' ').slice(0, 16_000)}));
  const working = session.status === 'working';
  const submit = () => {if(!voice.busy && online && session.status === 'ready' && !pending) void send();};
  return <div className="agent-composer">
    <textarea aria-label={`Message ${agentProviderNames[session.provider ?? 'codex']}`} placeholder="Describe your next edit…" rows={3} maxLength={16_000} value={draft} readOnly={voice.busy || pending} onChange={event => useAgent.setState({draft: event.target.value})} onKeyDown={event => {
      if(event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {event.preventDefault(); submit();}
    }}/>
    <div className="agent-composer__actions"><div className="agent-composer__voice"><IconButton label={voice.phase === 'requesting' || voice.phase === 'transcribing' ? 'Cancel dictation' : voice.listening ? 'Stop dictation' : 'Dictate a prompt'} aria-pressed={voice.listening} className={voice.listening ? 'listening' : ''} disabled={!voice.available || pending} onClick={() => {if(voice.phase === 'requesting' || voice.phase === 'transcribing') voice.cancel(); else if(voice.listening) voice.stop(); else {base.current = draft; voice.start();}}}>{voice.listening ? <MicOff size={16}/> : <Mic size={16}/>}</IconButton><select aria-label="Dictation language" disabled={voice.busy} value={voice.language} onChange={event => voice.setLanguage(event.target.value)}><option value="en-US">EN</option><option value="fr-FR">FR</option></select></div>
      {working ? <Button icon={<Square size={12}/>} disabled={pending || !online || !session.turnId} onClick={() => void interrupt()}>Stop response</Button> : <Button variant="primary" icon={<Send size={13}/>} disabled={!draft.trim() || !online || pending || session.status !== 'ready' || voice.busy} onClick={submit}>Send</Button>}
    </div>
    <label className="agent-voice-mode">Speech recognition<select aria-label="Speech recognition mode" disabled={voice.busy} value={voice.mode} onChange={event => voice.setMode(event.target.value as 'local' | 'browser')}><option value="local">Local · Firefox compatible</option>{voice.browserAvailable && <option value="browser">Browser service</option>}</select></label>
    {voice.error && <p className="agent-inline-error" role="alert">{voice.error}</p>}
    <p className="agent-composer__hint">{voice.phase === 'transcribing' ? voice.progress || 'Transcribing locally…' : voice.phase === 'requesting' ? 'Waiting for microphone access…' : voice.listening ? 'Listening… Stop dictation to review and send.' : !voice.available ? voice.unavailableReason : 'Enter to send · Shift + Enter for a new line'}</p>
    {voice.available && <p className="agent-composer__privacy">{voice.mode === 'local' ? 'Records up to 2 minutes. Transcribed on the editor host; review before sending.' : 'Voice uses your browser’s speech service; audio may be sent online.'}</p>}
  </div>;
}
