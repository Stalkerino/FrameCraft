import {useState} from 'react';
import {ShieldQuestion} from 'lucide-react';
import type {AgentRequest} from '../../../shared/agent';
import {useAgent} from '../../stores/agent-store';
import {Button} from '../atoms/Button';

export function AgentRequestCard({request}: {request: AgentRequest}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const {pending, online, respond} = useAgent(); const disabled = pending || !online;
  return <section className="agent-request"><h4><ShieldQuestion size={15}/>{request.title}</h4>
    {request.kind === 'questions' ? <form onSubmit={event => {event.preventDefault(); void respond({id: request.id, answers});}}>
      {request.questions?.map(q => <fieldset key={q.id}><legend>{q.question}</legend>{q.options.length > 0 && <div className="agent-request__options">{q.options.map(option => <button type="button" key={option.label} title={option.description} aria-pressed={answers[q.id] === option.label} disabled={disabled} onClick={() => setAnswers({...answers, [q.id]: option.label})}>{option.label}</button>)}</div>}<input aria-label={q.question} type={q.secret ? 'password' : 'text'} required maxLength={16_000} value={answers[q.id] || ''} disabled={disabled} onChange={event => setAnswers({...answers, [q.id]: event.target.value})}/></fieldset>)}
      <Button type="submit" variant="primary" disabled={disabled}>Send answer</Button>
    </form> : <><pre>{request.detail}</pre><div className="agent-request__actions"><Button disabled={disabled} onClick={() => void respond({id: request.id, decision: 'decline'})}>Decline</Button>{request.kind !== 'unsupported' && <Button variant="primary" disabled={disabled} onClick={() => void respond({id: request.id, decision: 'accept'})}>Allow once</Button>}</div></>}
  </section>;
}
