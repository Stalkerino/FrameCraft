import {prepareLocalToolArguments, localInspectionParameters, localInspectionToolParameters, localInspectionHelp, localVideoCutHelp} from './local-tool-arguments';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {readFile, writeFile, rename} from 'node:fs/promises';
import path from 'node:path';
import {agentModelSchema, emptyAgentSession, type AgentModelSettings, type AgentProviderSettings, type AgentReply, type AgentActivity} from '../../shared/agent';
import {OllamaClient, isOllamaToolParserError, type OllamaMessage, type OllamaTool} from './ollama-client';
import {AgentMcpClient} from './agent-mcp-client';
import {AgentWorkspaceService} from './agent-workspace-service';
import {OllamaContextService, readContextTool, callEditorTool, compactSchema, contextSize, lastUserIndex, contextCheckpoint} from './ollama-context-service';
import {ollamaInstructions, initialOllamaTools} from './ollama-instructions';
import {ollamaEditorTools, prepareOllamaEditorTool} from './ollama-editor-tools';
import {OllamaWorkState, recordVideoObservationsTool, readWorkStateTool} from './ollama-work-state';
import {OllamaToolExecution} from './ollama-tool-execution';
import {OllamaCutDraft, repairVideoCutTool} from './ollama-cut-draft';
import {ollamaGenerationOptions, ollamaRuntimeSnapshot} from './ollama-runtime';
import {ollamaToolHistory} from './ollama-tool-history';
import {ollamaToolSchema, decodeToolArguments, isLeakedToolCall} from './ollama-tool-protocol';

const discovery: OllamaTool = {type: 'function', function: {name: 'discover_tools', description: 'Find tool schemas for the next step. Prefer exact tool names in names; query searches by keywords. Recently needed schemas are shown. Discovery controls schema hints, not permission to call any available tool.', parameters: {type: 'object', properties: {query: {type: 'string'}, names: {type: 'array', items: {type: 'string'}}}}}};
export class OllamaSessionService extends EventEmitter {
  private state = {...emptyAgentSession(), provider: 'ollama' as const};
  private history: OllamaMessage[] = [];
  private memory = '';
  private work = new OllamaWorkState();
  private cutDraft = new OllamaCutDraft();
  private context: OllamaContextService;
  private workspace: AgentWorkspaceService;
  private schemaReferences = new Map<string, string>();
  private mcp?: AgentMcpClient;
  private controller?: AbortController;
  private task?: Promise<void>;
  private approvals = new Map<string, (allow: boolean) => void>();
  private order = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private writes: Promise<void> = Promise.resolve();
  constructor(private options: {root: string; data: string; url: string}, private settings: () => AgentProviderSettings) {super(); this.context = new OllamaContextService(path.join(options.data, 'ollama-context')); this.workspace = new AgentWorkspaceService(options, settings);}
  snapshot() {return structuredClone(this.state);}
  resetServer() {this.state.models = []; this.state.vision = false; this.state.modelsError = null; this.state.error = null; delete this.state.ollamaRuntime;}
  private publish() {if(!this.timer) this.timer = setTimeout(() => {this.timer = undefined; this.emit('change', this.snapshot());}, 40);}
  private client() {return new OllamaClient(this.settings().ollamaUrl);}
  async init() {
    try {
      const saved = JSON.parse(await readFile(path.join(this.options.data, 'ollama-session.json'), 'utf8'));
      this.state = {...this.state, model: saved.model ?? null, effort: saved.effort ?? null, threadId: saved.threadId ?? null, messages: saved.messages ?? [], activity: saved.activity ?? []};
      this.history = saved.history ?? []; this.memory = saved.memory ?? ''; this.order = saved.order ?? 0;
      this.work.restore(saved.work);
      this.cutDraft.restore(saved.cutDraft);
      if(!saved.work) for(const message of this.history) if(message.role === 'user' && !message.tool_name) this.work.request(message.content);
      this.work.releaseInspectionImages();
    } catch(error) {if((error as NodeJS.ErrnoException).code !== 'ENOENT') this.state.error = 'The saved Ollama conversation could not be restored. Start a new chat.';}
  }
  private persist() {
    const content = JSON.stringify({memory: this.memory, work: this.work.serialize(), cutDraft: this.cutDraft.serialize(), model: this.state.model, effort: this.state.effort, threadId: this.state.threadId, messages: this.state.messages, activity: this.state.activity, order: this.order,
      history: this.history.map(({images, thinking, ...message}) => ({...message, ...(images?.length ? {content: `${message.content}\n[Images omitted from saved history. Recorded observations remain in work state.]`} : {})}))});
    const file = path.join(this.options.data, 'ollama-session.json');
    this.writes = this.writes.catch(() => undefined).then(async () => {await writeFile(file + '.tmp', content); await rename(file + '.tmp', file);});
    return this.writes;
  }
  async refreshModels() {
    let result: {models: {name: string}[]};
    try {result = await this.client().models();} catch(error) {this.state.modelsError = (error as Error).message; this.publish(); throw error;}
    this.state.models = result.models.filter(model => !/(?:^|[:/\-])cloud(?:$|[:/\-])/i.test(model.name)).map(model => this.state.models.find(entry => entry.model === model.name) ?? agentModelSchema.parse({id: model.name, model: model.name, displayName: model.name, supportedReasoningEfforts: []}));
    this.state.modelsError = null; this.publish(); return this.snapshot();
  }
  private async inspectModel(model: string) {
    const info = await this.client().show(model);
    if(info.remote_host || info.remote_model) throw new Error('Choose a model installed on your Ollama server, not a cloud-backed model.');
    if(!info.capabilities?.includes('tools')) throw new Error(`${model} does not report tool-calling support. Choose a tool-capable model.`);
    this.state.vision = info.capabilities.includes('vision');
    const efforts = info.capabilities.includes('thinking') ? (/gpt-oss/i.test(model) ? ['low', 'medium', 'high'] : ['off', 'on']) : [];
    this.state.models = this.state.models.map(entry => entry.model === model ? {...entry, description: this.state.vision ? 'Editor tools and image inspection' : 'Editor tools · text only', supportedReasoningEfforts: efforts.map(reasoningEffort => ({reasoningEffort, description: `Ollama thinking: ${reasoningEffort}`}))} : entry);
    if(!efforts.includes(this.state.effort ?? '')) this.state.effort = efforts.includes('off') ? 'off' : efforts.includes('low') ? 'low' : null;
  }
  async start(fresh = false) {
    if(['working', 'starting'].includes(this.state.status)) throw new Error('Finish or stop the current operation first.');
    if(this.mcp && this.state.status === 'ready' && !fresh) return this.snapshot();
    this.state.status = 'starting'; this.state.error = null; this.publish();
    try {
      await this.refreshModels();
      if(!this.state.models.length) throw new Error('No local models found. Install a tool-capable model on your Ollama server first.');
      this.state.model = this.state.models.some(m => m.model === this.state.model) ? this.state.model : this.state.models[0].model;
      await this.inspectModel(this.state.model!);
      if(fresh) {this.history = []; this.memory = ''; this.work.reset(); this.cutDraft.reset(); this.schemaReferences.clear(); this.state.messages = []; this.state.activity = []; this.order = 0; this.state.threadId = null;}
      if(!this.mcp) {const mcp = new AgentMcpClient(); this.mcp = mcp; await mcp.connect(this.options.root, this.options.url);}
      this.state.threadId ??= randomUUID(); this.state.status = 'ready'; await this.persist();
      this.publish(); return this.snapshot();
    } catch(error) {await this.mcp?.close().catch(() => undefined); this.mcp = undefined; this.state.status = 'error'; this.state.error = (error as Error).message; this.publish(); throw error;}
  }
  async configure(settings: AgentModelSettings) {
    if(['working', 'starting'].includes(this.state.status)) throw new Error('Finish or stop the current operation first.');
    if(!this.state.models.some(m => m.model === settings.model)) throw new Error('Refresh models and select an installed model.');
    await this.inspectModel(settings.model);
    const options = this.state.models.find(m => m.model === settings.model)!.supportedReasoningEfforts;
    if(settings.effort && !options.some(option => option.reasoningEffort === settings.effort)) throw new Error('This model does not support that thinking setting.');
    this.state.model = settings.model; this.state.effort = settings.effort ?? (options.some(option => option.reasoningEffort === 'off') ? 'off' : options.some(option => option.reasoningEffort === 'low') ? 'low' : null); this.state.error = null;
    await this.persist(); this.publish(); return this.snapshot();
  }
  async send(text: string) {
    if(this.state.status !== 'ready' || !this.mcp || this.task) throw new Error('Connect Ollama and wait for the current response first.');
    this.state.status = 'working'; this.state.error = null; this.state.turnId = randomUUID();
    this.state.messages.push({id: randomUUID(), role: 'user', text, order: this.order++});
    this.history.push({role: 'user', content: text});
    this.work.request(text);
    const controller = new AbortController(); this.controller = controller;
    this.task = this.run(controller.signal).catch(error => {
      if(!controller.signal.aborted) this.state.error = (error as Error).message;
      else this.state.messages.push({id: randomUUID(), role: 'assistant', text: 'Response stopped. Completed edits remain on the timeline; use Undo if needed.', order: this.order++});
      // Preserve completed results. Close only unfinished tool exchanges, never replay edits.
      let pending: string[] = [];
      for(const message of this.history) {
        if(message.role === 'assistant') pending = message.tool_calls?.map(call => call.function.name) ?? [];
        if(message.role === 'tool') {const index = pending.indexOf(message.tool_name ?? ''); if(index >= 0) pending.splice(index, 1);}
      }
      for(const name of pending) this.history.push({role: 'tool', tool_name: name, content: 'Response interrupted. This call may or may not have completed. Read the current project before taking another action; do not replay a mutation blindly.'});

    }).finally(async () => {
      this.state.status = 'ready'; this.state.turnId = null; this.state.requests = []; this.approvals.clear();
      this.controller = undefined;
      try {await this.persist();} catch(error) {this.state.error = `Could not save the local conversation: ${(error as Error).message}`;}
      this.task = undefined; this.publish();
    });
    this.publish(); return this.snapshot();
  }
  private activity(label: string, detail: string) {
    const item: AgentActivity = {id: randomUUID(), label, detail, status: 'inProgress', order: this.order++}; this.state.activity.push(item); this.publish(); return item;
  }
  private async approve(name: string, args: unknown, signal: AbortSignal) {
    if(this.state.autoApprove || name === 'read_workspace_file' || /^(get_|list_|inspect_|search_)/.test(name)) return true;
    const id = randomUUID();
    this.state.requests.push({id, kind: 'approval', title: `Allow ${name}?`, detail: JSON.stringify(args, null, 2)}); this.publish();
    return new Promise<boolean>(resolve => {
      const complete = (allow: boolean) => {signal.removeEventListener('abort', abort); this.approvals.delete(id); this.state.requests = this.state.requests.filter(r => r.id !== id); this.publish(); resolve(allow);};
      const abort = () => complete(false); this.approvals.set(id, complete); signal.addEventListener('abort', abort, {once: true}); if(signal.aborted) abort();
    });
  }
  respond(reply: AgentReply) {const pending = this.approvals.get(reply.id); if(!pending || !reply.decision) throw new Error('This approval is no longer pending.'); pending(reply.decision === 'accept'); return this.snapshot();}
  setAutoApprove(enabled: boolean) {this.state.autoApprove = enabled; if(enabled) for(const resolve of [...this.approvals.values()]) resolve(true); this.publish(); return this.snapshot();}
  async interrupt() {this.controller?.abort(); await this.task; return this.snapshot();}
  close() {this.controller?.abort(); const mcp = this.mcp; this.mcp = undefined; void mcp?.close().catch(() => undefined); this.state.status = 'idle'; if(this.timer) clearTimeout(this.timer); this.timer = undefined;}
  private async prepareContext(system: string, tools: OllamaTool[], budget: number, signal: AbortSignal) {
    const original = this.history;
    this.history = this.history.map(({thinking, ...message}) => message);
    for(const message of this.history) {
      signal.throwIfAborted();
      if(message.role === 'tool' && message.content.length > Math.min(7000, budget * .15)) message.content = await this.context.shorten(message.content, `${message.tool_name} result`, Math.min(7000, Math.floor(budget * .15)));
    }
    const size = () => contextSize(system + this.memory + this.work.prompt(), tools, this.history);
    if(size() <= budget) return;
    const activity = this.activity('Compacting conversation', 'Writing a local checkpoint; no model request is needed.');
    try {
      signal.throwIfAborted();
      const userIndex = lastUserIndex(this.history);
      const goal = userIndex >= 0 ? this.history[userIndex] : {role: 'user' as const, content: 'Continue the current editing task. Read the saved context for the original request.'};
      let boundary = this.history.length;
      for(let i = this.history.length - 1; i > userIndex; i--) if(this.history[i].role === 'assistant') {boundary = i; break;}
      const recent = this.history.slice(boundary);
      const retainedImages = this.history.slice(0, boundary).filter(message => message.images?.length);
      const archive = await this.context.save(JSON.stringify({previousSummary: this.memory, messages: original.map(({images, ...message}) => ({...message, ...(images?.length ? {content: message.content + '\n[Image bytes omitted from archive; metadata and existing notes remain valid.]'} : {})}))}), 'Conversation before compaction');
      signal.throwIfAborted();
      this.memory = contextCheckpoint(original.slice(0, boundary), this.memory, archive);
      // Keep the newest complete call/result batch and its images. Do not remove a
      // just-returned visual batch before the model has had a chance to see it.
      this.history = [goal, ...retainedImages.filter(message => message !== goal), ...recent];
      for(const message of recent) if(message.role === 'assistant' && message.content.length > 1800) message.content = await this.context.shorten(message.content, 'Recent assistant notes', 1800);
      // Schemas can be rediscovered through the permanent dispatcher. Free their
      // space before sacrificing recent results or images.
      const essential = new Set(['discover_tools', 'read_context_result', 'call_editor_tool', 'record_video_observations', 'read_work_state']);
      for(let i = tools.length - 1; size() > budget && i >= 0; i--) if(!essential.has(tools[i].function.name)) tools.splice(i, 1);
      if(size() > budget) this.memory = `Local checkpoint: read_context_result id=${archive}. Read exact prior results there as needed; do not repeat completed edits or restart the scan. The latest result batch and images remain below. Declines remain declined. Read the project revision before editing.`;
      if(size() > budget) throw new Error('The latest tool/image batch and editing request exceed this context even after local compaction. Increase Context tokens or request fewer inspection images at once. Full history is saved; the latest results have not been discarded.');
      signal.throwIfAborted();
      activity.status = 'completed'; activity.detail = 'Local checkpoint saved. Request, recent results and latest images retained; continuing without a model summarization call.';
      await this.persist();
    } catch(error) {activity.status = signal.aborted ? 'interrupted' : 'failed'; activity.detail = (error as Error).message; throw error;}
    finally {this.publish();}
  }
  private async run(signal: AbortSignal) {
    const mcp = this.mcp!; const client = this.client();
    let stream = true; let protocolRetries = 0; let protocolNotice = '';
    const availableTools = [...mcp.tools, ...(mcp.tools.some(t => t.name === 'edit_project') ? ollamaEditorTools : []), ...(mcp.tools.some(t => t.name === 'save_video_cut') ? [repairVideoCutTool] : []), ...this.workspace.tools];
    const latestRequest = this.history[lastUserIndex(this.history)]?.content ?? '';
    let enabled = initialOllamaTools(latestRequest);
    enabled.push(...availableTools.filter(t => latestRequest.split(/[^\w]+/).includes(t.name)).map(t => t.name));
    const prioritize = (names: string[]) => {enabled = [...new Set(['get_project', ...names.filter(name => availableTools.some(t => t.name === name)), ...enabled])].slice(0, 8);};
    const helpers = [discovery, readContextTool, callEditorTool, recordVideoObservationsTool, readWorkStateTool];
    const inputSchemas = new Map([...availableTools.map(t => [t.name, t.name === 'inspect_video' ? localInspectionParameters : t.inputSchema] as const), ...helpers.map(t => [t.function.name, t.function.parameters] as const)]);
    const execution = new OllamaToolExecution(new Map([...availableTools.map(t => [t.name, t.inputSchema] as const), ...helpers.map(t => [t.function.name, t.function.parameters] as const)]));
    const catalog = availableTools.map(t => `${t.name}: ${t.description?.split('. ')[0]?.slice(0, 75) ?? ''}`).join('\n');
    const system = `${ollamaInstructions(!!this.state.vision, this.settings().workspaceAccess)}\nAvailable tools (discover by exact name for their parameters):\n${catalog}`;
    let running: Awaited<ReturnType<OllamaClient['running']>> | undefined;
    let measuredRuntime = false;
    while(true) {
      signal.throwIfAborted();
      const budget = this.settings().contextLength * 1.8; // Reserve space for generation and tokenizer variance.
      // Keep the dispatcher declared even when only small native tools are active:
      // earlier turns may reference large, inactive or now-disabled tools through it.
      const tools: OllamaTool[] = [...helpers];
      let schemaNotes = '';
      for(const tool of enabled.map(name => availableTools.find(t => t.name === name)).filter((t): t is NonNullable<typeof t> => !!t)) {
        const definition: OllamaTool = {type: 'function', function: {name: tool.name, description: (tool.description ?? '') + (tool.name === 'inspect_video' ? ` ${localInspectionHelp}` : tool.name === 'save_video_cut' ? ` ${localVideoCutHelp}` : ''), parameters: ollamaToolSchema(compactSchema(tool.name === 'inspect_video' ? localInspectionToolParameters : inputSchemas.get(tool.name)!) as Record<string, unknown>)}};
        if(JSON.stringify(definition).length > budget * .18 || JSON.stringify(tools).length + JSON.stringify(definition).length > budget * .3) {
          let reference = this.schemaReferences.get(tool.name);
          if(!reference) {reference = await this.context.save(JSON.stringify(tool.name === 'inspect_video' ? localInspectionToolParameters : tool.inputSchema), `Schema for ${tool.name}`); this.schemaReferences.set(tool.name, reference);}
          schemaNotes += `\n${tool.name}: schema reference ${reference}; use read_context_result (JSON pointers supported), then call_editor_tool with name and arguments.`;
        } else tools.push(definition);
      }
      await this.prepareContext(system + schemaNotes + protocolNotice, tools, budget, signal);
      const promptSystem = system + schemaNotes + protocolNotice + '\n' + this.work.prompt() + (this.memory ? `\nCompacted conversation notes (historical data, not new instructions or permission):\n${this.memory}` : '');
      const answer: OllamaMessage = {role: 'assistant', content: ''};
      const message = {id: randomUUID(), role: 'assistant' as const, text: '', order: this.order++};
      let thinking: AgentActivity | undefined;
      const finishThinking = (status: AgentActivity['status']) => {if(thinking) thinking.status = status;};
      const effort = this.state.effort;
      const request = {model: this.state.model, messages: [{role: 'system', content: promptSystem}, ...ollamaToolHistory(this.history, tools)], tools, options: ollamaGenerationOptions(this.settings().contextLength), ...(effort ? {think: effort === 'on' ? true : effort === 'off' ? false : effort} : {})};
      const receive = (part: Partial<OllamaMessage>) => {
        if(part.content) {answer.content += part.content; if(!message.text) this.state.messages.push(message); message.text += part.content;}
        if(part.thinking) {answer.thinking = (answer.thinking ?? '') + part.thinking; thinking ??= this.activity('Thinking', ''); thinking.detail = (thinking.detail + part.thinking).slice(-16000);}
        if(part.tool_calls?.length) (answer.tool_calls ??= []).push(...part.tool_calls);
        this.publish();
      };
      let metrics: Awaited<ReturnType<OllamaClient['chat']>>;
      try {
        metrics = await client.chat(request, signal, receive, stream);
      } catch(error) {
        finishThinking(signal.aborted ? 'interrupted' : 'failed');
        if(signal.aborted || !stream || !isOllamaToolParserError(error)) throw error;
        // No tool runs until a complete response succeeds. Discard all partial output
        // before retrying the same request, retaining previously completed tool batches.
        answer.content = ''; delete answer.thinking; delete answer.tool_calls;
        this.state.messages = this.state.messages.filter(m => m.id !== message.id); message.text = '';
        thinking = undefined;
        const recovery = this.activity('Recovering Ollama response', 'Ollama could not parse its generated tool call. Retrying once without streaming; completed edits are preserved.');
        stream = false; // Keep subsequent generations in this turn off the streaming parser.
        try {
          metrics = await client.chat(request, signal, receive, false);
          recovery.status = 'completed'; recovery.detail = 'Recovered without streaming. Continuing the editing task.';
        } catch(retryError) {
          recovery.status = signal.aborted ? 'interrupted' : 'failed'; recovery.detail = (retryError as Error).message;
          finishThinking(recovery.status);
          if(!signal.aborted && isOllamaToolParserError(retryError)) throw new Error(`Ollama could not generate a valid tool call, including on retry without streaming. Try updating Ollama or selecting another tool-capable model. Completed edits are preserved. ${recovery.detail}`);
          throw retryError;
        } finally {this.publish();}
      }
      if(!measuredRuntime) {measuredRuntime = true; running = await client.running(signal).catch(() => undefined);}
      this.state.ollamaRuntime = ollamaRuntimeSnapshot(this.state.model!, metrics, running);
      if(metrics.doneReason === 'length') {
        finishThinking('failed');
        throw new Error('Ollama exhausted its response token budget. No tool calls from the truncated response were executed. Turn thinking off or request a smaller editing step; completed edits remain.');
      }
      finishThinking('completed');
      // Preserve ordinary image commentary without requiring another model/tool
      // exchange. Only associate a reply with an unambiguous single inspection.
      const viewedImages = this.history.filter(message => message.images?.length);
      if(viewedImages.length === 1 && viewedImages[0].tool_name === 'inspect_video' && !isLeakedToolCall(answer.content)) this.work.rememberInspectionComment(answer.content);
      this.history.push(answer);
      if(!answer.tool_calls?.length && isLeakedToolCall(answer.content)) {
        if(protocolRetries++ >= 1) throw new Error('Ollama repeatedly returned tool syntax as plain text instead of a tool call. No action was executed from that text. Try a fresh chat or another tool-capable model.');
        const recovery = this.activity('Recovering tool call', 'The model printed tool syntax without making a call. Requesting one real tool call; no action was executed from the text.'); recovery.status = 'completed';
        protocolNotice = '\nYour previous response printed tool syntax as plain text and executed nothing. Use the supplied native tool-calling protocol now. Arguments must be actual JSON objects/arrays, not strings containing JSON. Do not repeat completed actions.';
        continue;
      }
      if(!answer.tool_calls?.length) {
        if(!answer.content.trim()) throw new Error('Ollama ended its response without a tool call or an answer. The task is not complete; completed edits are preserved.');
        if(execution.unresolved().length) this.state.error = `Some tool steps did not succeed: ${execution.unresolved().join(', ')}. Completed edits remain; do not treat the task as fully completed.`;
        this.publish(); return;
      }
      const imageResults: OllamaMessage[] = [];
      for(const call of answer.tool_calls) {
        signal.throwIfAborted();
        let {name, arguments: args} = call.function;
        const wireName = call.function.name;
        const item = this.activity(name, JSON.stringify(args, null, 2));
        let executed = false;
        let cutAttempt: Record<string, unknown> | undefined;
        let failureName = name;
        const resultStart = this.history.length;
        try {
          let decoded = decodeToolArguments(args, inputSchemas.get(name) ?? {type: 'object'}); args = decoded.arguments;
          if(decoded.note) item.detail += `\n${decoded.note}`;
          if(name === 'call_editor_tool') {
            if(typeof args.name !== 'string' || !inputSchemas.has(args.name) || args.name === 'call_editor_tool') throw new Error('call_editor_tool needs the exact name of an available tool and an arguments object. Use discover_tools to find its schema.');
            name = args.name; item.label = name; prioritize([name]);
            failureName = name;
            if(!args.arguments || typeof args.arguments !== 'object' || Array.isArray(args.arguments) || Object.keys(args).some(key => !['name', 'arguments'].includes(key))) {
              throw new Error(`Malformed call_editor_tool for ${name}: use {"name":"${name}","arguments":{...}}. Put tool parameters inside arguments; id is not a dispatcher parameter. Prefer calling ${name} directly using its native schema, now selected.${name === 'inspect_video' ? ` ${localInspectionHelp}` : ''}`);
            }
            decoded = decodeToolArguments(args.arguments, inputSchemas.get(name) ?? {type: 'object'}); args = decoded.arguments;
            if(decoded.note) item.detail += `\n${decoded.note}`;
          }
          // Store the actual parsed call for future turns so bad serialization is not
          // repeatedly shown as an example. Approvals still inspect the effective args.
          call.function.arguments = wireName === 'call_editor_tool' && name !== wireName ? {name, arguments: args} : args;
          if(name === 'read_context_result') {
            execution.validate(name, args);
            this.history.push({role: 'tool', tool_name: wireName, content: await this.context.read(args, Math.min(5000, Math.floor(budget * .12)))});
            execution.succeeded(name);
          } else if(name === 'record_video_observations' || name === 'read_work_state') {
            execution.validate(name, args);
            if(name === 'record_video_observations' && imageResults.length) throw new Error('Wait for the inspection image to arrive in your next response before recording observations. You have not received this image yet.');
            const result = name === 'record_video_observations' ? this.work.recordObservations(args) : this.work.read(args);
            if(name === 'record_video_observations' && !this.work.pendingInspection()) for(const previous of this.history) if(previous.images) {delete previous.images; previous.content += '\n[All frame observations saved. Image input released; read_work_state retains the notes.]';}
            const content = JSON.stringify(result);
            this.history.push({role: 'tool', tool_name: wireName, content}); item.detail += `\n${content}`;
            execution.succeeded(name); await this.persist();
          } else if(name === 'discover_tools') {
            execution.validate(name, args);
            const names = Array.isArray(args.names) ? args.names.filter((n): n is string => typeof n === 'string') : [];
            const words = typeof args.query === 'string' ? [...new Set(args.query.toLowerCase().split(/[^\w]+/).filter(Boolean))] : [];
            const matches = names.length ? availableTools.filter(t => names.includes(t.name)) : availableTools.map(tool => ({tool, score: words.includes(tool.name) ? 100000 : words.reduce((sum, word) => sum + (tool.name.includes(word) ? 3 : `${tool.description}`.toLowerCase().includes(word) ? 1 : 0), 0)})).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map(item => item.tool);
            prioritize([...matches.filter(t => t.name !== 'edit_project').map(t => t.name), ...(matches.some(t => t.name === 'edit_project') ? ['add_text_clip', 'add_media_clip', 'update_clip', 'split_clip', 'edit_project'] : [])]);
            const missing = names.filter(name => !availableTools.some(t => t.name === name));
            this.history.push({role: 'tool', tool_name: wireName, content: (matches.length ? `Selected schemas: ${matches.map(t => t.name).join(', ')}. Prefer native tool calls. Previously selected tools remain available; no rediscovery is needed to call a known tool.` : 'No tools matched. Use exact names from the catalog.') + (missing.length ? ` Unknown or disabled tools: ${missing.join(', ')}.` : '')});
            execution.succeeded(name);
          } else {
            if(!availableTools.some(t => t.name === name)) throw new Error(`Unknown or disabled tool: ${name}. Use a tool from the available catalog. Workspace tools require the user to enable workspace access.`);
            prioritize([name]);
            const prepared = prepareLocalToolArguments(name, args); args = prepared.arguments;
            if(name === 'inspect_video') call.function.arguments = wireName === 'call_editor_tool' ? {name, arguments: args.inspection} : args.inspection as Record<string, unknown>;
            if(prepared.note) {item.detail += `\n${prepared.note}\nEffective arguments: ${JSON.stringify(args)}`; this.publish();}
            execution.validate(name, args);
            const target = name === 'repair_video_cut' ? this.cutDraft.prepare(args, this.work.projectId()) : prepareOllamaEditorTool(name, args) ?? {name, arguments: args};
            if(target.name === 'save_video_cut') {cutAttempt = target.arguments; failureName = 'save_video_cut'; this.work.validateCut(target.arguments);}
            if(target.name !== name) {execution.validate(target.name, target.arguments); item.detail += `\nMCP ${target.name}: ${JSON.stringify(target.arguments)}`;}
            const allowed = await this.approve(target.name, target.arguments, signal); signal.throwIfAborted();
            if(!allowed) {this.history.push({role: 'tool', tool_name: wireName, content: 'User declined this action. Do not retry it without a new user request.'}); item.status = 'declined'; continue;}
            item.detail += this.state.autoApprove ? '\nAutomatically allowed' : '\nAllowed'; this.publish();
            const result = this.workspace.has(target.name) ? await this.workspace.call(target.name, target.arguments, signal) : await mcp.call(target.name, target.arguments, signal);
            const blocks = Array.isArray(result.content) ? result.content : [];
            const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
            const images = blocks.filter(b => b.type === 'image').map(b => b.data as string);
            if(result.isError) throw new Error(text || `MCP ${target.name} returned an error.`);
            executed = true;
            execution.succeeded(name);
            execution.succeeded(failureName);
            if(target.name === 'save_video_cut') this.cutDraft.reset();
            let projection: unknown;
            try {
              const parsed = JSON.parse(text);
              const reference = await this.context.save(text, `${target.name} full result`);
              projection = this.work.observe(target.name, target.arguments, parsed, reference, !!this.state.vision && images.length > 0);
            } catch(error) {if(!(error instanceof SyntaxError)) throw error;}
            this.history.push({role: 'tool', tool_name: wireName, content: projection === undefined
              ? (prepared.note ? `${prepared.note}\n` : '') + await this.context.shorten(text || (images.length ? 'Image result follows.' : JSON.stringify(result)), `${name} result`, Math.min(7000, Math.floor(budget * .15)))
              : JSON.stringify(projection)});
            // Retain only the newest inspection images; older timestamps/text remain available.
            if(images.length) {
              for(const previous of this.history) if(previous.images) {delete previous.images; previous.content += '\n[Previous images released. Saved visual observations remain in work state.]';}
              if(this.state.vision) {
                // Keep timestamps with the image itself: the original tool exchange
                // may be archived after a later prose-only assistant response.
                const frameMap = name === 'inspect_video' && projection && typeof projection === 'object' && 'reportId' in projection && 'frames' in projection ? JSON.stringify({reportId: projection.reportId, frames: projection.frames}) : '';
                imageResults.push({role: 'user', tool_name: name, content: `Images returned by ${name}. Read cells left-to-right, top-to-bottom. ${frameMap ? `Exact source timestamp map: ${frameMap}. ` : ''}Describe visible results honestly; state uncertainty for unclear details. You may use record_video_observations for precise frame notes, but it is optional. Continue the requested task.`, images});
              }
              else this.history[this.history.length - 1].content += '\nImages were returned but this model has no vision support. Do not claim visual inspection.';
            }
            item.detail += `\n${text.slice(0, 12000)}`; item.status = 'completed';
            await this.persist();
          }
          if(item.status === 'inProgress') item.status = 'completed';
        } catch(error) {
          item.status = signal.aborted ? 'interrupted' : 'failed'; item.detail += `\n${(error as Error).message}`; if(signal.aborted) throw error;
          if(executed) {
            if(!this.history.slice(resultStart).some(message => message.role === 'tool' && message.tool_name === wireName)) this.history.push({role: 'tool', tool_name: wireName, content: `The tool succeeded but local result processing failed: ${(error as Error).message}. Read the project before continuing. Do not replay this operation.`});
            throw new Error(`The ${name} tool succeeded, but Framecraft could not retain its result: ${(error as Error).message}. Stopped to avoid repeating completed edits. Read the project before continuing.`);
          }
          const draftId = cutAttempt && this.cutDraft.remember(cutAttempt, this.work.projectId());
          const repair = draftId ? `\nFailed proposal retained as draftId=${draftId}. Call repair_video_cut with this draftId and changes containing only the affected shot IDs and corrected start/end/evidence fields. Do not rewrite the full proposal or alter good shots. This saves through the normal approval path. Read exact recorded timestamps with read_work_state if needed.` : '';
          if(draftId) {prioritize(['repair_video_cut']); item.detail += repair; await this.persist();}
          this.history.push({role: 'tool', tool_name: wireName, content: `Tool error: ${(error as Error).message}\n${execution.hint(name)}${repair}`});
          const failureLimit = execution.failed(failureName, (error as Error).message);
          if(failureLimit) throw new Error(`Ollama ${failureLimit} for ${failureName}. Stopped the error loop; the task is not complete and completed edits are preserved. ${(error as Error).message}`);
        }
        finally {this.publish();}
      }
      this.history.push(...imageResults);
    }
  }
}
