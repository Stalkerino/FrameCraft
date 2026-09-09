import type {AgentActivity, AgentMessage, AgentQuestion} from '../../shared/agent';

export const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function isMcpToolApproval(params: Record<string, unknown>): boolean {
  const schema = record(params.requestedSchema);
  return params.mode === 'form' && record(params._meta).codex_approval_kind === 'mcp_tool_call' && schema.type === 'object' && Object.keys(record(schema.properties)).length === 0 && (!Array.isArray(schema.required) || schema.required.length === 0);
}
const text = (value: unknown): string => typeof value === 'string' ? value : '';
export function readable(value: unknown): string {
  // Never copy image/base64 payloads into the activity feed.
  return (JSON.stringify(value, (key, item) => ['data', 'bytes', 'encryptedContent'].includes(key) ? undefined : item, 2) || '').slice(0, 20_000);
}
export function messageFromItem(value: unknown): AgentMessage | null {
  const item = record(value); const id = text(item.id); if(!id) return null;
  if(item.type === 'agentMessage') return {id, role: 'assistant', text: text(item.text)};
  if(item.type === 'userMessage') return {id, role: 'user', text: (Array.isArray(item.content) ? item.content : []).map(c => text(record(c).text)).filter(Boolean).join('\n')};
  return null;
}
export function activityFromItem(value: unknown): AgentActivity | null {
  const item = record(value); const id = text(item.id); if(!id) return null;
  const status = text(item.status) || 'completed';
  if(item.type === 'commandExecution') return {id, label: text(item.command), detail: text(item.aggregatedOutput).slice(-20_000), status};
  if(item.type === 'mcpToolCall') return {id, label: `${text(item.server)} · ${text(item.tool)}`, detail: readable({arguments: item.arguments, result: item.result, error: item.error}), status};
  if(item.type === 'fileChange') return {id, label: 'File changes', detail: readable(item.changes), status};
  if(item.type === 'plan') return {id, label: 'Plan', detail: text(item.text), status};
  if(item.type === 'webSearch') return {id, label: 'Web search', detail: text(item.query), status};
  return null;
}
export function questionsFrom(value: unknown): AgentQuestion[] {
  return (Array.isArray(value) ? value : []).map(value => {
    const q = record(value);
    return {id: text(q.id), question: text(q.question), secret: q.isSecret === true, options: (Array.isArray(q.options) ? q.options : []).map(o => ({label: text(record(o).label), description: text(record(o).description)}))};
  });
}
