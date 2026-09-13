import {create} from 'zustand';
import {emptyAgentSession, type AgentProviderSettings, type AgentModelSettings, type AgentReply, type AgentSession} from '../../shared/agent';
import {agentApi} from '../services/agent-api';
import {agentProviderNames} from '../../shared/agent-providers';

interface AgentState {
  session: AgentSession; online: boolean; pending: boolean; error: string | null; draft: string;
  start: (fresh?: boolean) => Promise<void>; send: () => Promise<void>; interrupt: () => Promise<void>; respond: (reply: AgentReply) => Promise<void>;
  sendPrompt: (text: string, validate?: () => void) => Promise<boolean>;
  setAutoApprove: (enabled: boolean) => Promise<void>;
  configureProvider: (settings: AgentProviderSettings) => Promise<void>;
  refreshModels: () => Promise<void>; configure: (settings: AgentModelSettings) => Promise<void>;
  configureOption: (id: string, value: string) => Promise<void>;
}
export const useAgent = create<AgentState>((set, get) => {
  const act = async (action: () => Promise<void>): Promise<boolean> => {
    if(get().pending) return false;
    set({pending: true, error: null});
    try {await action(); return true;} catch(error) {set({error: (error as Error).message}); return false;}
    finally {set({pending: false});}
  };
  return {
    session: emptyAgentSession(), online: false, pending: false, error: null, draft: '',
    start: async fresh => {await act(() => agentApi.start(fresh));},
    send: async () => {
      const draft = get().draft.trim(); if(!draft) return;
      if(await act(() => agentApi.send(draft))) set({draft: ''});
    },
    // Assisted actions share this session and preserve anything typed in the composer.
    sendPrompt: (text, validate) => act(async () => {
      if(get().session.status === 'working') throw new Error('Wait for the assistant to finish, or stop its current response.');
      validate?.(); await agentApi.start(); validate?.(); await agentApi.send(text);
    }),
    interrupt: async () => {await act(agentApi.interrupt);},
    respond: async reply => {await act(() => agentApi.respond(reply));},
    setAutoApprove: async enabled => {await act(() => agentApi.autoApprove(enabled));},
    configureProvider: async settings => {await act(() => agentApi.provider(settings));},
    refreshModels: async () => {await act(agentApi.refreshModels);},
    configure: async settings => {await act(() => agentApi.configure(settings));},
    configureOption: async (id, value) => {await act(() => agentApi.configureOption(id, value));},
  };
});
export function connectAgent() {
  return agentApi.subscribe(session => useAgent.setState({session: {...emptyAgentSession(), ...session}, online: true}), () => useAgent.setState({online: false}));
}

export const useAgentName = () => useAgent(state => agentProviderNames[state.session.provider ?? 'codex']);
