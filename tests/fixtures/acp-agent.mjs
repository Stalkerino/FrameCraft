// Protocol fixture only: no provider account, inference or GPU work.
import {createInterface} from 'node:readline';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const send = value => process.stdout.write(JSON.stringify({jsonrpc: '2.0', ...value}) + '\n');
const result = (id, result = {}) => send({id, result});
let sessionId = 'acp-fixture'; let pending; let mcp; let bridge; let model = 'balanced'; let next = 0;
let authenticated = false; const requiresAuth = process.argv.includes('--auth-required');
const options = () => [{id: 'model', name: 'Model', type: 'select', category: 'model', currentValue: model, options: [{value: 'balanced', name: 'Balanced'}, {value: 'fast', name: 'Fast'}]}];
const update = value => send({method: 'session/update', params: {sessionId, update: value}});
const complete = (id, text, stopReason = 'end_turn') => {update({sessionUpdate: 'agent_message_chunk', content: {type: 'text', text}}); result(id, {stopReason});};
createInterface({input: process.stdin}).on('line', async line => {
  const message = JSON.parse(line); const {id, method, params} = message;
  try {
    if(!method && pending?.permissionId === id) {const approved = message.result?.outcome?.optionId === 'once'; update({sessionUpdate: 'tool_call_update', toolCallId: pending.toolId, status: approved ? 'completed' : 'failed'}); complete(pending.id, approved ? 'Permission accepted.' : 'Permission declined.'); pending = undefined; return;}
    if(method === 'initialize') {result(id, {protocolVersion: 1, agentCapabilities: {loadSession: true}, authMethods: requiresAuth ? [{id: 'fixture-login', name: 'Fixture sign-in'}] : []}); return;}
    if(method === 'authenticate') {if(params.methodId !== 'fixture-login') throw new Error('Wrong auth method'); authenticated = true; result(id); return;}
    if(method === 'session/new' || method === 'session/load') {
      if(requiresAuth && !authenticated) throw new Error('Authentication required');
      bridge = params.mcpServers[0];
      if(!bridge?.args[0]?.endsWith('mcp.mjs') || !bridge.env.some(e => e.name === 'FRAMECRAFT_URL')) throw new Error('Missing Framecraft bridge');
      if(method === 'session/load') {sessionId = params.sessionId; update({sessionUpdate: 'agent_message_chunk', content: {type: 'text', text: 'Resumed ACP conversation.'}}); result(id, {configOptions: options()});}
      else {sessionId = `acp-fixture-${++next}`; result(id, {sessionId, configOptions: options()});} return;
    }
    if(method === 'session/set_config_option') {model = params.value; result(id, {configOptions: options()}); return;}
    if(method === 'session/cancel') {if(pending) {result(pending.id, {stopReason: 'cancelled'}); pending = undefined;} return;}
    if(method === 'session/prompt') {
      const text = params.prompt.map(p => p.text).join('\n');
      if(text.endsWith('wait')) {pending = {id}; return;}
      if(text.endsWith('crash')) {process.exit(2);}
      if(text.endsWith('approval')) {
        const toolId = `tool-${++next}`; const toolCall = {toolCallId: toolId, title: 'framecraft · edit_project', status: 'pending', rawInput: {commands: []}};
        update({sessionUpdate: 'tool_call', ...toolCall}); pending = {id, toolId, permissionId: `permission-${next}`};
        send({id: pending.permissionId, method: 'session/request_permission', params: {sessionId, toolCall, options: [{optionId: 'once', name: 'Allow once', kind: 'allow_once'}, {optionId: 'always', name: 'Always allow', kind: 'allow_always'}, {optionId: 'no', name: 'Deny', kind: 'reject_once'}]}}); return;
      }
      if(text.endsWith('real MCP')) {
        mcp = new Client({name: 'framecraft-acp-test', version: '1.0.0'});
        await mcp.connect(new StdioClientTransport({command: bridge.command, args: bridge.args, env: {...process.env, ...Object.fromEntries(bridge.env.map(e => [e.name, e.value]))}}));
        const list = await mcp.listTools();
        const call = {toolCallId: `tool-${++next}`, title: 'framecraft · get_project', status: 'in_progress', rawInput: {}};
        update({sessionUpdate: 'tool_call', ...call});
        const project = await mcp.callTool({name: 'get_project', arguments: {}});
        if(project.isError) throw new Error(JSON.stringify(project.content));
        update({sessionUpdate: 'tool_call_update', toolCallId: call.toolCallId, status: 'completed', rawOutput: project.content});
        complete(id, `Real MCP connected. Available tools: ${list.tools.map(t => t.name).join(', ')}`); return;
      }
      complete(id, `ACP response using ${model}.`); return;
    }
    if(id !== undefined) send({id, error: {code: -32601, message: 'Unknown fixture method'}});
  } catch(error) {send({id, error: {code: -32603, message: error.message}});}
}).on('close', () => {void mcp?.close().finally(() => process.exit(0)); if(!mcp) process.exit(0);});
