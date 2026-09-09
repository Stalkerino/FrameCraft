import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {AgentMessage as Message} from '../../../shared/agent';

export function AgentMessage({message}: {message: Message}) {
  return <article className={`agent-message agent-message--${message.role}`}><span className="agent-message__author">{message.role === 'user' ? 'YOU' : 'CODEX'}</span><div className="agent-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{a: props => <a {...props} target="_blank" rel="noopener noreferrer"/>, img: () => null}}>{message.text}</Markdown></div></article>;
}
