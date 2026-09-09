import {z} from 'zod';

export interface AgentMessage {id: string; role: 'user' | 'assistant'; text: string; order?: number}
export interface AgentActivity {id: string; label: string; detail: string; status: string; order?: number}
export interface AgentQuestion {id: string; question: string; options: {label: string; description: string}[]; secret?: boolean}
export interface AgentRequest {id: string; kind: 'approval' | 'questions' | 'permissions' | 'unsupported'; title: string; detail: string; questions?: AgentQuestion[]}
export const agentModelSchema = z.object({
  id: z.string(), model: z.string(), displayName: z.string(), description: z.string().default(''), hidden: z.boolean().default(false),
  supportedReasoningEfforts: z.array(z.object({reasoningEffort: z.string(), description: z.string()})),
  defaultReasoningEffort: z.string().nullable().default(null),
  serviceTiers: z.array(z.object({id: z.string(), name: z.string(), description: z.string()})).default([]),
  additionalSpeedTiers: z.array(z.string()).default([]), defaultServiceTier: z.string().nullable().default(null), isDefault: z.boolean().default(false),
});
export type AgentModel = z.infer<typeof agentModelSchema>;
export const agentModelSettingsSchema = z.object({model: z.string().min(1), effort: z.string().min(1).nullable(), serviceTier: z.string().min(1).nullable()}).strict();
export type AgentModelSettings = z.infer<typeof agentModelSettingsSchema>;
export interface AgentSession {
  autoApprove: boolean;
  status: 'idle' | 'starting' | 'ready' | 'working' | 'error';
  threadId: string | null; turnId: string | null; model: string | null; error: string | null;
  effort: string | null; serviceTier: string | null; models: AgentModel[]; modelsError: string | null;
  messages: AgentMessage[]; activity: AgentActivity[]; requests: AgentRequest[];
}
export const emptyAgentSession = (): AgentSession => ({autoApprove: false, status: 'idle', threadId: null, turnId: null, model: null, effort: null, serviceTier: null, models: [], modelsError: null, error: null, messages: [], activity: [], requests: []});
export type AgentConversationEntry = {kind: 'message'; item: AgentMessage} | {kind: 'activity'; item: AgentActivity};
export function agentConversationEntries(session: AgentSession): AgentConversationEntry[] {
  const entries: AgentConversationEntry[] = [
    ...session.messages.map(item => ({kind: 'message' as const, item})),
    ...session.activity.map(item => ({kind: 'activity' as const, item})),
  ];
  // Sessions from an older running server still show their messages and tool calls.
  return entries.sort((a, b) => (a.item.order ?? Number.MAX_SAFE_INTEGER) - (b.item.order ?? Number.MAX_SAFE_INTEGER));
}
export const agentReplySchema = z.object({id: z.string().min(1), decision: z.enum(['accept', 'decline']).optional(), answers: z.record(z.string().max(16_000)).optional()}).strict();
export type AgentReply = z.infer<typeof agentReplySchema>;
