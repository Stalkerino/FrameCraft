import {EventEmitter} from 'node:events';
import {readFile, writeFile, rename} from 'node:fs/promises';
import path from 'node:path';
import {agentProviderSettingsSchema, type AgentProviderSettings, type AgentModelSettings, type AgentReply} from '../../shared/agent';
import {CodexSessionService} from './codex-session-service';
import {OllamaSessionService} from './ollama-session-service';
import {AgentWorkspaceService} from './agent-workspace-service';
import {isCliAgent, type CliAgentProvider} from '../../shared/agent-providers';
import {AcpSessionService} from './acp-session-service';

/** One UI/session contract; each provider retains its own conversation. */
export class AgentSessionService extends EventEmitter {
  private settings = agentProviderSettingsSchema.parse({provider: 'codex'});
  private codex: CodexSessionService;
  private ollama: OllamaSessionService;
  private cli = new Map<CliAgentProvider, AcpSessionService>();
  private configuring = false;
  constructor(private options: {root: string; data: string; url: string}) {
    super(); this.codex = new CodexSessionService(options); this.ollama = new OllamaSessionService(options, () => this.settings);
    for(const id of ['claude', 'gemini', 'opencode', 'custom-acp'] as const) this.cli.set(id, new AcpSessionService(options, id, () => this.settings));
    for(const provider of [this.codex, this.ollama, ...this.cli.values()]) provider.on('change', () => {if(provider === this.active()) this.emit('change', this.snapshot());});
  }
  async init() {
    try {this.settings = agentProviderSettingsSchema.parse(JSON.parse(await readFile(path.join(this.options.data, 'agent-provider.json'), 'utf8')));} catch {}
    await this.ollama.init();
  }
  private active() {return isCliAgent(this.settings.provider) ? this.cli.get(this.settings.provider)! : this.settings.provider === 'ollama' ? this.ollama : this.codex;}
  snapshot() {return {...this.active().snapshot(), provider: this.settings.provider, providerSettings: this.settings};}
  private check() {if(this.configuring) throw new Error('Wait for the provider settings to finish saving.');}
  async configureProvider(input: AgentProviderSettings) {
    this.check(); if(['working', 'starting'].includes(this.active().snapshot().status)) throw new Error('Finish or stop the current response before changing provider settings.');
    this.configuring = true;
    try {
      const settings = agentProviderSettingsSchema.parse(input);
      if(settings.provider === 'ollama') await new AgentWorkspaceService(this.options, () => settings).validate();
      const file = path.join(this.options.data, 'agent-provider.json');
      await writeFile(file + '.tmp', JSON.stringify(settings, null, 2)); await rename(file + '.tmp', file);
      this.active().close(); if(settings.ollamaUrl !== this.settings.ollamaUrl) this.ollama.resetServer(); this.settings = settings;
      this.emit('change', this.snapshot()); return this.snapshot();
    } finally {this.configuring = false;}
  }
  async start(fresh = false) {this.check(); await this.active().start(fresh); return this.snapshot();}
  async send(text: string) {this.check(); await this.active().send(text); return this.snapshot();}
  async interrupt() {await this.active().interrupt(); return this.snapshot();}
  respond(reply: AgentReply) {this.active().respond(reply); return this.snapshot();}
  setAutoApprove(enabled: boolean) {this.active().setAutoApprove(enabled); return this.snapshot();}
  async refreshModels() {this.check(); this.configuring = true; try {await this.active().refreshModels(); return this.snapshot();} finally {this.configuring = false;}}
  async configure(settings: AgentModelSettings) {this.check(); this.configuring = true; try {await this.active().configure(settings); return this.snapshot();} finally {this.configuring = false;}}
  async configureOption(id: string, value: string) {
    this.check(); const active = this.active(); if(!(active instanceof AcpSessionService)) throw new Error('CLI options require an ACP agent.');
    this.configuring = true; try {await active.configureOption(id, value); return this.snapshot();} finally {this.configuring = false;}
  }
  close() {this.codex.close(); this.ollama.close(); for(const cli of this.cli.values()) cli.close();}
}
