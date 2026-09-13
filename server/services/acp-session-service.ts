import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import type {RequestPermissionRequest, RequestPermissionResponse, SessionNotification, SessionConfigOption, NewSessionResponse} from '@agentclientprotocol/sdk';
import {emptyAgentSession, type AgentProviderSettings, type AgentReply, type AgentModelSettings} from '../../shared/agent';
import {agentProviderNames, cliAgentPresets, type CliAgentProvider} from '../../shared/agent-providers';
import {editorAgentInstructions} from './agent-instructions';
import {resolveCliAgent} from './cli-agent-command-service';
import {AcpProcess} from './acp-process';

interface Permission {request: RequestPermissionRequest; resolve: (reply: RequestPermissionResponse) => void}
export class AcpSessionService extends EventEmitter {
  private state = emptyAgentSession();
  private process?: AcpProcess;
  private order = 0;
  private assistantId?: string;
  private permissions = new Map<string, Permission>();
  private startPromise?: Promise<void>;
  private promptPromise?: Promise<void>;
  private identity?: string;
  private instructionsSent = false;
  constructor(private options: {root: string; data: string; url: string}, private provider: CliAgentProvider, private settings: () => AgentProviderSettings) {super();}
  snapshot() {return structuredClone(this.state);}
  private emitChange() {this.emit('change', this.snapshot());}
  async start(fresh = false) {
    if(this.startPromise) return this.startPromise;
    if(this.state.status === 'working') {if(fresh) throw new Error('Stop the current response before starting another chat.'); return;}
    if(this.process && this.state.status === 'ready' && !fresh) return;
    this.startPromise = this.connect(fresh).finally(() => {this.startPromise = undefined;}); return this.startPromise;
  }
  private async connect(fresh: boolean) {
    this.close(); const preset = cliAgentPresets[this.provider];
    const saved = this.settings().cliAgents[this.provider];
    const config = {command: saved?.command || preset.command, args: saved?.args ?? preset.args, cwd: path.resolve(this.options.root, saved?.cwd || '.'), authMethod: saved?.authMethod};
    const identity = JSON.stringify(config);
    const resume = !fresh && identity === this.identity ? this.state.threadId : null;
    const previous = this.snapshot();
    this.state = {...emptyAgentSession(), autoApprove: previous.autoApprove, status: 'starting'}; this.order = 0; this.assistantId = undefined;
    this.identity = identity; this.emitChange();
    try {
      if(!(await stat(config.cwd)).isDirectory()) throw new Error('The CLI working directory must be an existing folder.');
      const executable = await resolveCliAgent(this.provider, config);
      const process: AcpProcess = new AcpProcess(executable, config.cwd, {
        sessionUpdate: params => {if(this.process === process) this.update(params);},
        requestPermission: params => this.process === process ? this.permission(params) : {outcome: {outcome: 'cancelled'}},
      }, error => {if(this.process === process) {this.process = undefined; this.cancelPermissions(); this.state.status = 'error'; this.state.error = error.message; this.state.turnId = null; this.emitChange();}});
      this.process = process;
      const initialized = await process.timed(process.connection.initialize({protocolVersion: 1, clientInfo: {name: 'framecraft', version: '0.1.0'}, clientCapabilities: {fs: {readTextFile: false, writeTextFile: false}, terminal: false}}), 'initialization');
      if(initialized.protocolVersion !== 1) throw new Error(`Unsupported ACP protocol version: ${initialized.protocolVersion}`);
      this.state.authMethods = initialized.authMethods?.map(method => ({id: method.id, name: method.name})) ?? [];
      if(config.authMethod) {
        if(!this.state.authMethods.some(method => method.id === config.authMethod)) throw new Error('The selected authentication method is not supported by this agent. Choose one of its reported methods in Settings.');
        await process.timed(process.connection.authenticate({methodId: config.authMethod}), 'authentication');
      }
      const params = {cwd: config.cwd, mcpServers: [{name: 'framecraft', command: processExecPath(), args: [path.join(this.options.root, 'scripts', 'mcp.mjs')], env: [{name: 'FRAMECRAFT_URL', value: this.options.url}]}]};
      let result: Omit<NewSessionResponse, 'sessionId'>;
      if(resume && initialized.agentCapabilities?.loadSession) {
        this.state.threadId = resume;
        result = await process.timed(process.connection.loadSession({...params, sessionId: resume}), 'session loading');
        this.instructionsSent = true;
      } else {
        const created = await process.timed(process.connection.newSession(params), 'session creation');
        this.state.threadId = created.sessionId; result = created; this.instructionsSent = false;
      }
      if(this.process !== process) throw new Error('The CLI connection stopped during startup.');
      this.setOptions(result.configOptions ?? []);
      if(result.modes && !this.state.configOptions?.some(option => option.category === 'mode')) this.state.configOptions?.push({id: '__acp_mode', name: 'Agent mode', category: 'mode', currentValue: result.modes.currentModeId, options: result.modes.availableModes.map(mode => ({value: mode.id, name: mode.name, description: mode.description ?? undefined}))});
      this.state.vision = !!initialized.agentCapabilities?.promptCapabilities?.image;
      this.state.status = 'ready'; this.emitChange();
    } catch(error) {
      this.close(); this.state.status = 'error'; this.state.error = `${(error as Error).message}\n${preset.setup}`;
      // Keep a resumable transcript if startup failed; never present a new thread as its continuation.
      if(resume) {this.state.threadId = resume; this.state.messages = previous.messages; this.state.activity = previous.activity; this.order = Math.max(0, ...previous.messages.map(m => m.order ?? 0), ...previous.activity.map(a => a.order ?? 0));}
      this.emitChange(); throw new Error(this.state.error);
    }
  }
  async send(text: string) {
    if(this.state.status !== 'ready' || !this.process || !this.state.threadId) throw new Error('Start the CLI agent and finish its current response first.');
    const process = this.process; const turnId = randomUUID();
    this.state.messages.push({id: randomUUID(), role: 'user', text, order: ++this.order}); this.assistantId = undefined;
    this.state.status = 'working'; this.state.error = null; this.state.turnId = turnId; this.emitChange();
    const prompt = this.instructionsSent ? text : `${editorAgentInstructions}\n\nUser request:\n${text}`; this.instructionsSent = true;
    this.promptPromise = process.connection.prompt({sessionId: this.state.threadId, prompt: [{type: 'text', text: prompt}]}).then(result => {
      if(this.process !== process || this.state.turnId !== turnId) return;
      this.state.status = 'ready';
      if(result.stopReason !== 'end_turn' && result.stopReason !== 'cancelled') this.state.error = `Agent stopped: ${result.stopReason}. Completed edits are preserved.`;
    }).catch(error => {if(this.process === process) {this.state.status = 'error'; this.state.error = (error as Error).message;}}).finally(() => {
      if(this.process !== process) return;
      this.cancelPermissions(); this.state.turnId = null; this.assistantId = undefined; this.emitChange();
    });
  }
  async interrupt() {
    if(!this.process || !this.state.threadId || this.state.status !== 'working') return;
    const process = this.process; this.cancelPermissions();
    try {await process.timed(process.connection.cancel({sessionId: this.state.threadId}).then(() => this.promptPromise), 'cancellation', 5000);}
    catch {this.close(); this.state.error = 'The agent did not acknowledge Stop; its connection was closed. Completed edits are preserved. Reconnect to continue.'; this.state.status = 'error'; this.emitChange();}
  }
  private update({sessionId, update}: SessionNotification) {
    if(this.state.threadId && sessionId !== this.state.threadId) return;
    if(update.sessionUpdate === 'agent_message_chunk' || update.sessionUpdate === 'user_message_chunk') {
      const role = update.sessionUpdate === 'agent_message_chunk' ? 'assistant' : 'user';
      if(update.content.type !== 'text') return;
      let message = this.state.messages.find(m => m.id === this.assistantId && m.role === role);
      if(!message) {message = {id: randomUUID(), role, text: '', order: ++this.order}; this.state.messages.push(message); this.assistantId = message.id;}
      message.text += update.content.text;
    } else if(update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      this.assistantId = undefined; this.tool(update);
    } else if(update.sessionUpdate === 'config_option_update') this.setOptions(update.configOptions);
    else if(update.sessionUpdate === 'current_mode_update') {const mode = this.state.configOptions?.find(o => o.category === 'mode'); if(mode) mode.currentValue = update.currentModeId;}
    else if(update.sessionUpdate === 'plan') {
      let item = this.state.activity.find(a => a.id === 'acp-plan');
      if(!item) {item = {id: 'acp-plan', label: 'Agent plan', detail: '', status: 'inProgress', order: ++this.order}; this.state.activity.push(item);}
      item.detail = update.entries.map(entry => `${entry.status}: ${entry.content}`).join('\n'); item.status = update.entries.every(e => e.status === 'completed') ? 'completed' : 'inProgress';
    }
    this.emitChange();
  }
  private tool(tool: RequestPermissionRequest['toolCall']) {
    let item = this.state.activity.find(a => a.id === tool.toolCallId);
    if(!item) {item = {id: tool.toolCallId, label: tool.title || 'Tool call', detail: '', status: 'inProgress', order: ++this.order}; this.state.activity.push(item);}
    if(tool.title) item.label = tool.title;
    if(tool.status) item.status = tool.status === 'in_progress' || tool.status === 'pending' ? 'inProgress' : tool.status;
    const details = [tool.rawInput === undefined ? '' : JSON.stringify(tool.rawInput, null, 2), tool.rawOutput === undefined ? '' : JSON.stringify(tool.rawOutput, null, 2), ...(tool.content ?? []).map(content => content.type === 'content' && content.content.type === 'text' ? content.content.text : content.type === 'diff' ? `${content.path}\n${content.oldText ?? ''}\n→\n${content.newText}` : '')].filter(Boolean).join('\n');
    if(details) item.detail = details.slice(-32000);
  }
  private permission(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    if(request.sessionId !== this.state.threadId) return Promise.resolve({outcome: {outcome: 'cancelled'}});
    this.assistantId = undefined; this.tool(request.toolCall);
    const id = randomUUID();
    return new Promise(resolve => {
      this.permissions.set(id, {request, resolve});
      this.state.requests.push({id, kind: request.options.some(o => o.kind === 'allow_once') ? 'approval' : 'unsupported', title: `${agentProviderNames[this.provider]} needs your approval`, detail: `${request.toolCall.title || 'Tool permission'}\n${JSON.stringify(request.toolCall.rawInput ?? {}, null, 2)}`});
      if(this.state.autoApprove && request.options.some(o => o.kind === 'allow_once')) this.respond({id, decision: 'accept'});
      else this.emitChange();
    });
  }
  respond(reply: AgentReply) {
    const pending = this.permissions.get(reply.id); if(!pending) throw new Error('This permission request is no longer pending.');
    if(!reply.decision) throw new Error('Choose Allow once or Decline.');
    const option = pending.request.options.find(o => o.kind === (reply.decision === 'accept' ? 'allow_once' : 'reject_once'));
    if(reply.decision === 'accept' && !option) throw new Error('This agent did not offer a one-time approval. Decline and review its own permission settings.');
    pending.resolve(option ? {outcome: {outcome: 'selected', optionId: option.optionId}} : {outcome: {outcome: 'cancelled'}});
    this.permissions.delete(reply.id); this.state.requests = this.state.requests.filter(r => r.id !== reply.id); this.emitChange();
  }
  setAutoApprove(enabled: boolean) {this.state.autoApprove = enabled; if(enabled) for(const [id, pending] of this.permissions) if(pending.request.options.some(o => o.kind === 'allow_once')) this.respond({id, decision: 'accept'}); this.emitChange();}
  private cancelPermissions() {for(const pending of this.permissions.values()) pending.resolve({outcome: {outcome: 'cancelled'}}); this.permissions.clear(); this.state.requests = [];}
  private setOptions(options: SessionConfigOption[]) {
    this.state.configOptions = options.flatMap(option => option.type !== 'select' ? [] : [{id: option.id, name: option.name, category: option.category ?? undefined, description: option.description ?? undefined, currentValue: option.currentValue, options: option.options.flatMap(value => 'group' in value ? value.options : [value]).map(value => ({value: value.value, name: value.name, description: value.description ?? undefined}))}]);
    this.state.model = this.state.configOptions.find(o => o.category === 'model')?.currentValue ?? null;
  }
  async configureOption(id: string, value: string) {
    if(this.state.status !== 'ready' || !this.process || !this.state.threadId) throw new Error('Start the agent and finish its response before changing settings.');
    const option = this.state.configOptions?.find(o => o.id === id);
    if(!option?.options.some(o => o.value === value)) throw new Error('Choose an option reported by the connected agent.');
    if(id === '__acp_mode') {await this.process.timed(this.process.connection.setSessionMode({sessionId: this.state.threadId, modeId: value}), 'mode change'); option.currentValue = value;}
    else {const result = await this.process.timed(this.process.connection.setSessionConfigOption({sessionId: this.state.threadId, configId: id, value}), 'settings change'); this.setOptions(result.configOptions);}
    this.emitChange();
  }
  async configure(settings: AgentModelSettings) {const model = this.state.configOptions?.find(o => o.category === 'model'); if(!model) throw new Error('This CLI does not expose a model selector. Use its CLI configuration.'); await this.configureOption(model.id, settings.model);}
  async refreshModels() {if(this.state.status !== 'ready') await this.start(); this.emitChange();}
  close() {const process = this.process; this.process = undefined; this.cancelPermissions(); process?.close(); this.state.status = 'idle'; this.state.turnId = null;}
}

// Avoid shadowing the Node runtime with the transport variable above.
const processExecPath = () => process.execPath;
