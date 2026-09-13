export const agentProviderIds = ['codex', 'ollama', 'claude', 'gemini', 'opencode', 'custom-acp'] as const;
export type AgentProvider = typeof agentProviderIds[number];
export type CliAgentProvider = Exclude<AgentProvider, 'codex' | 'ollama'>;
export const agentProviderNames: Record<AgentProvider, string> = {codex: 'Codex', ollama: 'Ollama', claude: 'Claude', gemini: 'Gemini', opencode: 'OpenCode', 'custom-acp': 'Custom agent'};
export const isCliAgent = (provider?: string): provider is CliAgentProvider => !!provider && ['claude', 'gemini', 'opencode', 'custom-acp'].includes(provider);
export interface CliAgentPreset {command: string; args: string[]; npmPackage?: string; setup: string; docs: string}
export const cliAgentPresets: Record<CliAgentProvider, CliAgentPreset> = {
  claude: {command: 'claude-agent-acp', args: [], npmPackage: '@agentclientprotocol/claude-agent-acp', setup: 'Install Claude Code and sign in with claude. Then install its ACP adapter: npm install -g @agentclientprotocol/claude-agent-acp. Select the adapter executable here, not the claude executable.', docs: 'https://github.com/agentclientprotocol/claude-agent-acp'},
  gemini: {command: 'gemini', args: ['--experimental-acp'], npmPackage: '@google/gemini-cli', setup: 'Install with npm install -g @google/gemini-cli, then run gemini once in your terminal to sign in. The ACP flag can be changed in Arguments for your installed version.', docs: 'https://geminicli.com/docs/cli/acp-mode/'},
  opencode: {command: 'opencode', args: ['acp'], npmPackage: 'opencode-ai', setup: 'Install OpenCode and configure your model provider in its terminal interface before starting it here.', docs: 'https://opencode.ai/docs/acp/'},
  'custom-acp': {command: '', args: [], setup: 'Choose an installed agent that supports ACP over stdio, and its ACP arguments. MCP support alone is not a chat protocol. Sign in using that agent’s own setup.', docs: 'https://agentclientprotocol.com/get-started/agents'},
};
export interface CliAgentConfig {command: string; args: string[]; cwd: string; authMethod?: string}
export interface AgentConfigOption {id: string; name: string; description?: string; category?: string; currentValue: string; options: {value: string; name: string; description?: string}[]}
