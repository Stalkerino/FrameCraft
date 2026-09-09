import type {Snapshot} from '../../shared/project';
import type {AgentSession} from '../../shared/agent';
import type {MediaPreviews} from '../../shared/media-import';

interface WorkspaceEvents {project: Snapshot; agent: AgentSession; presets: {revision: number}; sounds: {revision: number}; media: MediaPreviews}
type Channel = keyof WorkspaceEvents;
interface Subscriber {channel: Channel; receive: (value: never) => void; disconnect: () => void}
const subscribers = new Set<Subscriber>();
const latest = new Map<Channel, WorkspaceEvents[Channel]>();
let connection: EventSource | null = null;

/** One live connection per page leaves browser HTTP connections available for edits and media. */
export function subscribeWorkspace<K extends Channel>(channel: K, receive: (value: WorkspaceEvents[K]) => void, disconnect: () => void) {
  const subscriber: Subscriber = {channel, receive, disconnect}; subscribers.add(subscriber);
  if(!connection) {
    connection = new EventSource('/api/events');
    for(const type of ['project', 'agent', 'presets', 'sounds', 'media'] as const) connection.addEventListener(type === 'project' ? 'message' : type, event => {
      const value = JSON.parse((event as MessageEvent).data) as WorkspaceEvents[typeof type]; latest.set(type, value);
      for(const listener of subscribers) if(listener.channel === type) listener.receive(value as never);
    });
    connection.onerror = () => {latest.clear(); for(const listener of subscribers) listener.disconnect();};
  } else if(latest.has(channel)) receive(latest.get(channel) as WorkspaceEvents[K]);
  return () => {subscribers.delete(subscriber); if(!subscribers.size) {connection?.close(); connection = null; latest.clear();}};
}
