// Deterministic protocol peer for tests. Production always resolves the installed Codex CLI.
import {createInterface} from 'node:readline';
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const event = (method, params) => send({method, params: {threadId: 'test-thread', ...params}});
let initialized = false; let experimentalApi = false; let current = 0; let waiting = null;
let settings = {model: 'test-model', effort: 'medium', serviceTier: null};
const models = [
  {id: 'test-model', model: 'test-model', displayName: 'Test balanced', description: 'A test model', hidden: false, supportedReasoningEfforts: [{reasoningEffort: 'low', description: 'Quick thinking'}, {reasoningEffort: 'medium', description: 'Balanced thinking'}], defaultReasoningEffort: 'medium', serviceTiers: []},
  {id: 'test-thinking', model: 'test-thinking', displayName: 'Test reasoning', description: 'Another test model', hidden: true, supportedReasoningEfforts: [{reasoningEffort: 'low', description: 'Quick thinking'}, {reasoningEffort: 'high', description: 'More thinking'}], defaultReasoningEffort: 'low', serviceTiers: [{id: 'priority', name: 'Fast', description: 'Faster responses with increased usage'}]},
];
function complete(id, text = 'Here is the **Codex reply**. Your timeline is ready.') {
  event('item/started', {item: {id: `assistant-${id}`, type: 'agentMessage', text: ''}});
  event('item/agentMessage/delta', {itemId: `assistant-${id}`, delta: text.slice(0, 12)});
  setTimeout(() => {
    event('item/agentMessage/delta', {itemId: `assistant-${id}`, delta: text.slice(12)});
    event('item/completed', {item: {id: `assistant-${id}`, type: 'agentMessage', text}});
    event('turn/completed', {turn: {id: `turn-${id}`, status: 'completed', error: null}});
  }, 60);
}
createInterface({input: process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if(!m.method) {
    if(waiting?.id !== m.id) return;
    const text = waiting.kind === 'permissions' ? JSON.stringify(m.result) : waiting.kind === 'question' ? `Answer received: ${Object.values(m.result.answers)[0].answers[0]}` : waiting.kind === 'mcp' ? `MCP ${m.result.action}: ${JSON.stringify(m.result.content)}` : m.result.decision === 'accept' ? 'Approval received.' : 'Request declined.';
    if(waiting.item) event('item/completed', {item: {...waiting.item, status: m.result.action === 'accept' ? 'completed' : 'failed', result: {content: [{type: 'text', text}]}}});
    event('serverRequest/resolved', {requestId: m.id}); waiting = null; complete(current, text); return;
  }
  if(m.method === 'initialize') {experimentalApi = m.params.capabilities?.experimentalApi === true; send({id: m.id, result: {userAgent: 'framecraft-test', platformFamily: 'test', platformOs: 'test'}}); return;}
  if(m.method === 'initialized') {initialized = true; return;}
  if(!initialized) {send({id: m.id, error: {code: -32600, message: 'Not initialized'}}); return;}
  if(m.method === 'model/list') {send({id: m.id, result: {data: m.params.cursor ? m.params.includeHidden ? [models[1]] : [] : [models[0]], nextCursor: m.params.cursor ? null : 'second-page'}}); return;}
  if(m.method === 'thread/start' || m.method === 'thread/resume') {
    settings = {model: m.params.model || 'test-model', effort: m.params.config?.model_reasoning_effort || 'medium', serviceTier: m.params.serviceTier ?? null};
    send({id: m.id, result: {thread: {id: 'test-thread', turns: m.method === 'thread/resume' ? [{items: [{id: 'resumed-message', type: 'agentMessage', text: 'Resumed conversation.'}]}] : []}, model: settings.model, reasoningEffort: settings.effort, serviceTier: settings.serviceTier}}); return;
  }
  if(m.method === 'thread/settings/update') {
    if(!experimentalApi) {send({id: m.id, error: {code: -32600, message: 'thread/settings/update requires experimentalApi capability'}}); return;}
    settings = {model: m.params.model, effort: m.params.effort, serviceTier: m.params.serviceTier}; event('thread/settings/updated', {threadSettings: settings}); send({id: m.id, result: {}}); return;
  }
  if(m.method === 'turn/interrupt') {waiting = null; send({id: m.id, result: {}}); event('turn/completed', {turn: {id: m.params.turnId, status: 'interrupted', error: null}}); return;}
  if(m.method !== 'turn/start') {send({id: m.id, error: {code: -32601, message: 'Unknown test method'}}); return;}
  const text = m.params.input[0].text; const id = ++current;
  if(text === 'reject') {send({id: m.id, error: {code: -1, message: 'Test upstream failure'}}); return;}
  if(text === 'crash') {process.exit(2);}
  event('turn/started', {turn: {id: `turn-${id}`, status: 'inProgress'}});
  event('item/started', {item: {id: `user-${id}`, type: 'userMessage', content: [{type: 'text', text}]}});
  send({id: m.id, result: {turn: {id: `turn-${id}`, status: 'inProgress'}}});
  if(text === 'wait') return;
  if(text === 'report model') {complete(id, JSON.stringify(settings)); return;}
  if(text === 'mcp approval' || text === 'external form') {
    waiting = {id: 400 + id, kind: 'mcp'};
    if(text === 'mcp approval') {
      waiting.item = {id: `approved-tool-${id}`, type: 'mcpToolCall', server: 'framecraft', tool: 'get_project', status: 'inProgress', arguments: {}};
      event('item/started', {item: waiting.item});
    }
    send({id: waiting.id, method: 'mcpServer/elicitation/request', params: {threadId: 'test-thread', turnId: `turn-${id}`, serverName: 'framecraft', mode: 'form', _meta: {codex_approval_kind: 'mcp_tool_call', tool_description: 'Inspect the timeline', tool_params: {}}, message: 'Allow Framecraft to inspect the timeline?', requestedSchema: {type: 'object', properties: text === 'external form' ? {email: {type: 'string'}} : {}}}}); return;
  }
  if(['approval', 'file approval', 'permissions'].includes(text)) {
    waiting = {id: 400 + id, kind: text === 'permissions' ? 'permissions' : 'approval'};
    event('item/started', {item: {id: 'command', type: 'commandExecution', command: 'example command with spaces', aggregatedOutput: '', status: 'inProgress'}});
    send({id: waiting.id, method: text === 'permissions' ? 'item/permissions/requestApproval' : text === 'file approval' ? 'item/fileChange/requestApproval' : 'item/commandExecution/requestApproval', params: {threadId: 'test-thread', turnId: `turn-${id}`, itemId: 'command', permissions: {network: {enabled: true}}, reason: 'Test command needs approval', command: 'example command with spaces'}}); return;
  }
  if(text === 'question') {
    waiting = {id: 400 + id, kind: 'question'};
    send({id: waiting.id, method: 'item/tool/requestUserInput', params: {threadId: 'test-thread', turnId: `turn-${id}`, questions: [{id: 'style', question: 'Which title style?', options: [{label: 'Minimal', description: 'A simple title.'}, {label: 'Bold', description: 'A large title.'}]}]}}); return;
  }
  const item = {id: `tool-${id}`, type: 'mcpToolCall', server: 'framecraft', tool: 'get_project', status: 'inProgress', arguments: {}};
  event('item/started', {item});
  complete(id);
  // Completion after assistant text starts must update, not reorder, the tool row.
  setTimeout(() => event('item/completed', {item: {...item, status: 'completed', result: {content: [{type: 'text', text: 'Test timeline inspected.'}]}}}), 20);
});
