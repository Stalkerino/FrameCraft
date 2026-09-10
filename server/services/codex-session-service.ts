import {EventEmitter} from 'node:events';
import {readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {agentModelSchema, agentModelSettingsSchema, emptyAgentSession, type AgentActivity, type AgentModel, type AgentModelSettings, type AgentReply, type AgentSession} from '../../shared/agent';
import {codexMcpArguments, resolveCodex, type Executable} from './codex-command-service';
import {JsonRpcProcess, type RpcMessage} from './json-rpc-process';
import {activityFromItem, isMcpToolApproval, messageFromItem, questionsFrom, readable, record} from './codex-event-service';

interface ThreadResult {thread: {id: string; turns?: {items: unknown[]}[]}; model: string; reasoningEffort?: string | null; serviceTier?: string | null}
interface Options {root: string; data: string; url: string; executable?: () => Promise<Executable>}
const projectInstructions = 'The workspace supports multiple saved projects through list_projects and manage_project (new/copy/open). Only create or switch projects when requested. Save as opens an independent copy; original projects retain their history. The same chat follows the active project. Read get_project at the start of each request and after any switch; never reuse an old project revision or selection. Project media lists are separate; reusable asset presets are shared.';
const automaticCutInstructions = 'For visually guided Automatic Cuts on any video, with or without narration, use analyze_video, get_analysis, get_video_analysis and inspect_video. The local scan only measures brightness and visual changes; you perform visual interpretation from actual returned images. Do not use transcription or filename matching as a substitute for inspecting footage. Read every overview page for whole-source coverage, inspect short ranges around promising/ambiguous moments and cut boundaries, and use a larger single frame for details. Keep setup/action/payoff and avoid repetition according to the user goal. Low motion or darkness alone does not justify removal. Be explicit about uncertain visual judgments and sampled coverage. Save a cut with save_video_cut using exact inspected timestamps as evidence and honest reasons/confidence; it appears in Tools → Automatic Cuts. Use apply_video_cut when asked to apply. Start/end values are source seconds and proposals persist; target length is approximate. Use the existing chat throughout and avoid unnecessary repeated image inspections.';
const instructions = 'You are embedded in Framecraft, a devlog video editor. Use the framecraft MCP tools to inspect and edit the active video project. Read get_project before edits and use its revision. Use render_frame to inspect visual results. Changes appear live in the editor. Never directly overwrite data/project.json. For reusable assets use list_asset_presets (pass id for a complete recipe), save_asset_preset, preview_asset_preset, and apply_asset_preset. Prefer portable recipes with editable parameters and normalized keyframes for transitions, titles, backgrounds, intros and overlays; they appear live in Asset Studio without rebuilding. Read starter recipes before authoring. Save and inspect a preview before applying; never claim generation completed until the tool succeeds. Updating presets requires expectedVersion; applying uses both preset version and project revision. Existing timeline instances keep their embedded recipe. Extend composition code only for effects beyond the recipe primitives when requested. Use the same timeline, undo history, and media service as the visual editor. Read the playhead and selection from get_project for context. Use get_transcript/transcribe_media/search_footage for spoken content; these are real local analysis jobs, poll get_analysis. Word timestamps are source seconds; timeline commands use frames at the current project fps. Use project.settings to change canvas dimensions/fps; timing is resampled automatically. Export settings can differ from project settings. Use cut_transcript_words, generate_captions and propose_first_cut/apply_first_cut for assisted editing. Never invent analysis results. Annotations use kind=annotation, track=text and annotation={shape:arrow|box|circle,width,height,rotation,stroke}; positions and dimensions are percentages. Visual clips accept zoom={from,to,x,y,start,end} with frame-based timing, set motionOffset=0 for a new animation. Inspect renders to position overlays. Use the same right-hand conversation for asset generation, placement and timeline edits; there is no separate asset chat. Projects contain ordered tracks (top first): use track.add/update/move/remove and clip.move-track through edit_project, and set clip.trackId or apply_asset_preset.trackId to target one. Video, text/graphics and audio tracks can be added. Removing a track requires it to be empty. Track hidden/muted flags affect preview and export. Preserve positionLocked clip x/y unless the user explicitly requests unlocking.';

export class CodexSessionService extends EventEmitter {
  private state = emptyAgentSession();
  private rpc: JsonRpcProcess | null = null;
  private starting: Promise<AgentSession> | null = null;
  private requests = new Map<string, RpcMessage>();
  private publishTimer: ReturnType<typeof setTimeout> | null = null;
  private configuring = false;
  private nextOrder = 0;
  constructor(private options: Options) {super();}
  snapshot(): AgentSession {return structuredClone(this.state);}
  private publish() {
    if(this.publishTimer) return;
    this.publishTimer = setTimeout(() => {this.publishTimer = null; this.emit('change', this.snapshot());}, 40);
  }
  async start(fresh = false): Promise<AgentSession> {
    if(this.configuring) throw new Error('Wait for the Codex settings to finish saving.');
    if(this.starting) return this.starting;
    if(this.state.status === 'working') {if(fresh) throw new Error('Stop the current response before starting a new chat.'); return this.snapshot();}
    if(this.rpc && this.state.status === 'ready' && !fresh) return this.snapshot();
    this.starting = this.open(fresh).finally(() => {this.starting = null;});
    return this.starting;
  }
  private async open(fresh: boolean) {
    const autoApprove = this.state.autoApprove;
    this.close(); this.state = {...emptyAgentSession(), autoApprove, status: 'starting'}; this.nextOrder = 0; this.publish();
    try {
      const executable = await (this.options.executable || resolveCodex)();
      const rpc = new JsonRpcProcess({command: executable.command, args: [...executable.args, ...codexMcpArguments(this.options.root, this.options.url), 'app-server', '--listen', 'stdio://']}, this.options.root);
      this.rpc = rpc;
      rpc.on('message', message => {if(this.rpc === rpc) this.receive(message);});
      rpc.on('closed', (error: Error) => {
        if(this.rpc !== rpc) return;
        this.rpc = null; this.state.status = 'error'; this.state.error = error.message; this.state.turnId = null; this.clearRequests(); this.publish();
      });
      await rpc.request('initialize', {clientInfo: {name: 'framecraft_studio', title: 'Framecraft Studio', version: '0.1.0'}, capabilities: {experimentalApi: true}});
      rpc.send({method: 'initialized', params: {}});
      let savedId: string | null = null; let settings: AgentModelSettings | undefined;
      try {
        const saved = JSON.parse(await readFile(path.join(this.options.data, 'codex-session.json'), 'utf8'));
        savedId = !fresh && typeof saved.threadId === 'string' ? saved.threadId : null;
        const parsed = agentModelSettingsSchema.safeParse(saved.settings); if(parsed.success) settings = parsed.data;
      } catch {}
      const params = {cwd: this.options.root, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write', developerInstructions: `${instructions} ${projectInstructions} ${automaticCutInstructions}`,
        ...(settings ? {model: settings.model, serviceTier: settings.serviceTier, ...(settings.effort ? {config: {model_reasoning_effort: settings.effort}} : {})} : {})};
      let result: ThreadResult;
      try {result = await rpc.request<ThreadResult>(savedId ? 'thread/resume' : 'thread/start', {...params, ...(savedId ? {threadId: savedId} : {})});}
      catch(error) {
        if(!savedId || !/no rollout found for thread id/i.test((error as Error).message)) throw error;
        // Codex may not persist an empty thread before its first prompt.
        result = await rpc.request<ThreadResult>('thread/start', params);
        this.acceptActivity({id: randomUUID(), label: 'Codex session restored', detail: 'The saved thread was unavailable in Codex storage. Started a new thread with your model settings.', status: 'completed'});
      }
      this.state.threadId = result.thread.id; this.state.model = result.model;
      this.state.effort = result.reasoningEffort ?? null; this.state.serviceTier = result.serviceTier === 'default' ? null : result.serviceTier ?? null;
      for(const turn of result.thread.turns || []) for(const item of turn.items) this.acceptItem(item);
      await this.loadModels(rpc).catch(error => {this.state.modelsError = (error as Error).message;});
      await this.savePointer();
      this.state.status = 'ready'; this.publish(); return this.snapshot();
    } catch(error) {
      this.close(); this.state.status = 'error'; this.state.error = (error as Error).message; this.publish(); throw error;
    }
  }
  async send(text: string) {
    if(this.configuring) throw new Error('Wait for the Codex settings to finish saving.');
    if(!this.rpc || !this.state.threadId) throw new Error('Start Codex before sending a request.');
    if(this.state.status !== 'ready') throw new Error('Wait for Codex to finish, or stop the current response.');
    this.state.status = 'working'; this.state.error = null; this.publish();
    try {
      const result = await this.rpc.request<{turn: {id: string}}>('turn/start', {threadId: this.state.threadId, input: [{type: 'text', text, text_elements: []}]});
      if(this.state.status === 'working') this.state.turnId = result.turn.id;
      this.publish(); return this.snapshot();
    } catch(error) {
      // Notifications may already confirm an accepted turn; preserve its interrupt control.
      if(!this.state.turnId && this.rpc) this.state.status = 'ready';
      this.state.error = (error as Error).message; this.publish(); throw error;
    }
  }
  private async savePointer() {
    const pointer = path.join(this.options.data, 'codex-session.json');
    const settings = this.state.model ? {model: this.state.model, effort: this.state.effort, serviceTier: this.state.serviceTier} : undefined;
    await writeFile(pointer + '.tmp', JSON.stringify({threadId: this.state.threadId, settings}) + '\n'); await rename(pointer + '.tmp', pointer);
  }
  private async loadModels(rpc: JsonRpcProcess) {
    const models: AgentModel[] = []; let cursor: string | null = null; const visited = new Set<string>();
    do {
      const page: {data: unknown[]; nextCursor: string | null} = await rpc.request('model/list', {includeHidden: true, limit: 100, ...(cursor ? {cursor} : {})});
      for(const entry of page.data) {
        const model = agentModelSchema.parse(entry);
        if(!model.serviceTiers.length && model.additionalSpeedTiers.includes('fast')) model.serviceTiers = [{id: 'priority', name: 'Fast', description: 'Faster responses with increased usage.'}];
        models.push(model);
      }
      cursor = page.nextCursor;
      if(cursor && visited.has(cursor)) throw new Error('Codex returned a repeated model catalog page.');
      if(cursor) visited.add(cursor);
    } while(cursor);
    if(this.rpc !== rpc) return;
    this.state.models = models; this.state.modelsError = null; this.publish();
  }
  async refreshModels() {
    if(!this.rpc || this.state.status === 'starting') throw new Error('Start Codex before loading its models.');
    try {await this.loadModels(this.rpc);} catch(error) {this.state.modelsError = (error as Error).message; this.publish(); throw error;}
    return this.snapshot();
  }
  async configure(settings: AgentModelSettings) {
    if(!this.rpc || !this.state.threadId || this.state.status !== 'ready' || this.configuring) throw new Error('Wait for Codex to finish before changing its model settings.');
    const model = this.state.models.find(candidate => candidate.model === settings.model);
    if(!model) throw new Error('Choose a model from the current Codex catalog.');
    if(settings.effort !== null && !model.supportedReasoningEfforts.some(option => option.reasoningEffort === settings.effort)) throw new Error('This model does not support that thinking effort.');
    if(settings.serviceTier !== null && !model.serviceTiers.some(option => option.id === settings.serviceTier)) throw new Error('This model does not support that speed tier.');
    // A null effort means "no override" in Codex; send the catalog default to
    // actually reset a previously selected high effort.
    const applied = {...settings, effort: settings.effort ?? model.defaultReasoningEffort};
    this.configuring = true;
    try {
      await this.rpc.request('thread/settings/update', {threadId: this.state.threadId, ...applied});
      this.state.model = applied.model; this.state.effort = applied.effort; this.state.serviceTier = applied.serviceTier; this.state.error = null;
      await this.savePointer(); this.publish(); return this.snapshot();
    } finally {this.configuring = false;}
  }
  async interrupt() {
    if(!this.rpc || !this.state.threadId || !this.state.turnId) throw new Error('There is no active response to stop.');
    await this.rpc.request('turn/interrupt', {threadId: this.state.threadId, turnId: this.state.turnId});
    return this.snapshot();
  }
  respond(reply: AgentReply) {
    const request = this.requests.get(reply.id);
    if(!request || !this.rpc) throw new Error('This Codex request is no longer pending.');
    const params = request.params || {}; let result: unknown;
    if(request.method === 'item/tool/requestUserInput') {
      const questions = questionsFrom(params.questions);
      if(!questions.every(q => reply.answers?.[q.id]?.trim())) throw new Error('Answer each question before sending.');
      result = {answers: Object.fromEntries(questions.map(q => [q.id, {answers: [reply.answers![q.id]]}]))};
    } else {
      if(!reply.decision) throw new Error('Choose Allow or Decline.');
      if(request.method === 'item/permissions/requestApproval') result = {permissions: reply.decision === 'accept' ? params.permissions : {}, scope: 'turn'};
      else if(request.method === 'mcpServer/elicitation/request') {
        if(reply.decision === 'accept' && !isMcpToolApproval(params)) throw new Error('This external form is not supported here. Decline it to continue.');
        result = {action: reply.decision, content: reply.decision === 'accept' ? {} : null, _meta: null};
      } else result = {decision: reply.decision};
    }
    this.rpc.send({id: request.id, result}); this.requests.delete(reply.id); this.state.requests = this.state.requests.filter(r => r.id !== reply.id); this.publish();
    return this.snapshot();
  }
  private clearRequests() {this.requests.clear(); this.state.requests = [];}
  setAutoApprove(enabled: boolean) {
    this.state.autoApprove = enabled;
    if(enabled) for(const request of [...this.state.requests]) this.autoApproveRequest(request.id);
    this.publish(); return this.snapshot();
  }
  private autoApproveRequest(id: string) {
    const pending = this.state.requests.find(r => r.id === id); const rpcRequest = this.requests.get(id);
    if(!this.state.autoApprove || !pending || !rpcRequest || !['approval', 'permissions'].includes(pending.kind)) return;
    if(rpcRequest.params?.turnId && rpcRequest.params.turnId !== this.state.turnId) return;
    const decisions = rpcRequest.params?.availableDecisions;
    if(Array.isArray(decisions) && !decisions.includes('accept')) return;
    try {
      this.respond({id, decision: 'accept'});
      this.acceptActivity({id: randomUUID(), label: 'Automatically allowed', detail: `${pending.title}\n${pending.detail}`, status: 'completed'});
    } catch(error) {this.state.autoApprove = false; this.state.error = (error as Error).message;}
  }
  private acceptActivity(activity: AgentActivity) {
    const index = this.state.activity.findIndex(a => a.id === activity.id);
    // Completion/output updates stay in the original call's position in the chat.
    const ordered = {...activity, order: index === -1 ? this.nextOrder++ : this.state.activity[index].order};
    if(index === -1) this.state.activity.push(ordered); else this.state.activity[index] = ordered;
    this.state.activity = this.state.activity.slice(-100);
  }
  private acceptItem(item: unknown) {
    const message = messageFromItem(item);
    if(message) {
      const index = this.state.messages.findIndex(m => m.id === message.id);
      const ordered = {...message, order: index === -1 ? this.nextOrder++ : this.state.messages[index].order};
      if(index === -1) this.state.messages.push(ordered); else this.state.messages[index] = ordered;
      this.state.messages = this.state.messages.slice(-200);
    }
    const activity = activityFromItem(item);
    if(activity) this.acceptActivity(activity);
  }
  private receive(message: RpcMessage) {
    const params = message.params || {};
    if(params.threadId && this.state.threadId && params.threadId !== this.state.threadId) return;
    if(message.id !== undefined) {
      const methods = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'item/tool/requestUserInput', 'mcpServer/elicitation/request'];
      if(!methods.includes(message.method || '')) {this.rpc?.send({id: message.id, error: {code: -32601, message: 'Framecraft does not support this request.'}}); return;}
      const id = randomUUID(); this.requests.set(id, message);
      const mcpApproval = message.method === 'mcpServer/elicitation/request' && isMcpToolApproval(params);
      const kind = message.method === 'item/tool/requestUserInput' ? 'questions' : message.method === 'item/permissions/requestApproval' ? 'permissions' : message.method === 'mcpServer/elicitation/request' && !mcpApproval ? 'unsupported' : 'approval';
      const item = this.state.activity.find(a => a.id === params.itemId);
      const meta = record(params._meta);
      const detail = mcpApproval ? [typeof meta.tool_description === 'string' ? meta.tool_description : '', Object.keys(record(meta.tool_params)).length ? readable(meta.tool_params) : ''].filter(Boolean).join('\n\n') : [typeof params.reason === 'string' ? params.reason : '', item?.label || '', item?.detail || '', readable(params)].filter(Boolean).join('\n');
      this.state.requests.push({id, kind, title: mcpApproval && typeof params.message === 'string' ? params.message : kind === 'questions' ? 'Codex has a question' : kind === 'unsupported' ? 'External form requires another client' : 'Codex needs your approval', detail, ...(kind === 'questions' ? {questions: questionsFrom(params.questions)} : {})});
      this.autoApproveRequest(id);
    } else if(message.method === 'item/started' || message.method === 'item/completed') this.acceptItem(params.item);
    else if(message.method === 'item/agentMessage/delta') {
      const id = String(params.itemId); let item = this.state.messages.find(m => m.id === id);
      if(!item) {item = {id, role: 'assistant', text: '', order: this.nextOrder++}; this.state.messages.push(item);}
      if(typeof params.delta === 'string') item.text += params.delta;
    } else if(message.method === 'item/commandExecution/outputDelta') {
      const item = this.state.activity.find(a => a.id === params.itemId);
      if(item && typeof params.delta === 'string') item.detail = (item.detail + params.delta).slice(-20_000);
    } else if(message.method === 'thread/settings/updated') {
      const settings = record(params.threadSettings);
      if(typeof settings.model === 'string') this.state.model = settings.model;
      if(settings.effort === null || typeof settings.effort === 'string') this.state.effort = settings.effort;
      if(settings.serviceTier === null || typeof settings.serviceTier === 'string') this.state.serviceTier = settings.serviceTier === 'default' ? null : settings.serviceTier;
    } else if(message.method === 'turn/started') {
      this.state.status = 'working'; this.state.turnId = String(record(params.turn).id);
    } else if(message.method === 'turn/completed') {
      this.state.status = 'ready'; this.state.turnId = null; this.clearRequests();
      const turn = record(params.turn); const error = record(turn.error);
      if(typeof error.message === 'string') this.state.error = error.message;
      if(turn.status === 'interrupted') this.acceptActivity({id: randomUUID(), label: 'Response stopped', detail: 'Edits already applied remain in the shared undo history.', status: 'interrupted'});
    } else if(message.method === 'serverRequest/resolved') {
      for(const [id, request] of this.requests) if(request.id === params.requestId) {this.requests.delete(id); this.state.requests = this.state.requests.filter(r => r.id !== id);}
    } else if(message.method === 'error') {
      const error = record(params.error); this.state.error = typeof error.message === 'string' ? error.message : 'Codex reported an error.';
    } else return;
    this.publish();
  }
  close() {
    this.state.autoApprove = false;
    const rpc = this.rpc; this.rpc = null; rpc?.close();
    this.clearRequests(); if(this.publishTimer) clearTimeout(this.publishTimer); this.publishTimer = null;
  }
}
