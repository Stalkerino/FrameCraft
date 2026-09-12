import {useEffect, useState} from 'react';
import {useAgent} from '../../stores/agent-store';
import {Field} from '../atoms/Field';
import {Button} from '../atoms/Button';
import type {AgentProviderSettings as ProviderSettings} from '../../../shared/agent';

export function AgentProviderSettings() {
  const {session, pending, online, configureProvider, refreshModels} = useAgent();
  const saved = session.providerSettings;
  const [provider, setProvider] = useState<'codex' | 'ollama'>(session.provider ?? 'codex');
  const [url, setUrl] = useState(saved?.ollamaUrl ?? 'http://127.0.0.1:11434');
  const [context, setContext] = useState(saved?.contextLength ?? 32768);
  const [workspaceAccess, setWorkspaceAccess] = useState<ProviderSettings['workspaceAccess']>(saved?.workspaceAccess ?? 'disabled');
  const [workspacePath, setWorkspacePath] = useState(saved?.workspacePath ?? '');
  useEffect(() => {setWorkspaceAccess(saved?.workspaceAccess ?? 'disabled'); setWorkspacePath(saved?.workspacePath ?? '');}, [saved?.workspaceAccess, saved?.workspacePath]);
  useEffect(() => {setProvider(session.provider ?? 'codex'); setUrl(saved?.ollamaUrl ?? 'http://127.0.0.1:11434'); setContext(saved?.contextLength ?? 32768);}, [session.provider, saved?.ollamaUrl, saved?.contextLength]);
  const disabled = !online || pending || ['working', 'starting'].includes(session.status);
  const runtime = session.provider === 'ollama' && session.ollamaRuntime?.model === session.model ? session.ollamaRuntime : undefined;
  const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);
  return <details className="agent-provider-settings" open={session.provider === 'ollama' && session.status === 'idle' ? true : undefined}>
    <summary>AI provider · {session.provider === 'ollama' ? 'Ollama' : 'Codex CLI'}</summary>
    <Field label="AI provider"><select aria-label="AI provider" value={provider} disabled={disabled} onChange={event => setProvider(event.target.value as typeof provider)}><option value="codex">Codex CLI</option><option value="ollama">Ollama · Local / network</option></select></Field>
    {provider === 'ollama' && <>
      <Field label="Ollama server URL"><input type="url" aria-label="Ollama server URL" value={url} placeholder="http://192.168.1.50:11434" disabled={disabled} onChange={event => setUrl(event.target.value)}/></Field>
      <Field label="Context tokens"><input type="number" aria-label="Ollama context tokens" min={4096} max={262144} step={1024} value={context} disabled={disabled} onChange={event => setContext(Number(event.target.value))}/></Field>
      <Button disabled={disabled} onClick={() => setContext(16384)}>Use 16 GB context preset</Button>
      <p className="field-help">16 GB starting point: 16,384 context tokens and an 8–14B quantized model with tools and vision. Model size, images and context all affect memory use; check the runtime allocation below after your first response.</p>
      <p className="field-help">The editor host connects to this server. Prompts and inspected frames are sent there. Larger contexts use more server memory.</p>
      {runtime && <p className="field-help" aria-label="Ollama runtime">
        Last response: {runtime.model}
        {runtime.contextLength !== undefined && <> · {runtime.contextLength.toLocaleString()} context</>}
        {runtime.vramBytes !== undefined && <> · {gib(runtime.vramBytes)} GiB in GPU memory</>}
        {runtime.cpuBytes !== undefined && runtime.cpuBytes > 1024 ** 2 && <> · {gib(runtime.cpuBytes)} GiB outside GPU memory</>}
        {runtime.tokensPerSecond !== undefined && <> · {runtime.tokensPerSecond.toFixed(1)} tokens/s</>}
        {runtime.promptTokens !== undefined && <> · {runtime.promptTokens.toLocaleString()} prompt tokens</>}
      </p>}
      <Field label="Workspace access"><select aria-label="Ollama workspace access" value={workspaceAccess} disabled={disabled} onChange={event => setWorkspaceAccess(event.target.value as ProviderSettings['workspaceAccess'])}><option value="disabled">Editor tools only</option><option value="files">Editor + read and edit files</option><option value="commands">Editor + files and commands</option></select></Field>
      {workspaceAccess !== 'disabled' && <>
        <Field label="Workspace folder"><input aria-label="Ollama workspace folder" value={workspacePath} placeholder="Framecraft project folder (default)" disabled={disabled} onChange={event => setWorkspacePath(event.target.value)}/></Field>
        <p className="field-help">An existing folder on the Framecraft host, where files and generated assets are saved. File changes are not covered by timeline Undo. Writes follow chat approvals, including Auto-allow.</p>
        {workspaceAccess === 'commands' && <p className="field-help">Commands also follow Auto-allow and run with your host account permissions. This folder is a working directory, not a sandbox.</p>}
      </>}
    </>}
    <Button disabled={disabled || !url.trim() || !Number.isInteger(context) || context < 4096 || context > 262144} onClick={() => void configureProvider({provider, ollamaUrl: url, contextLength: context, workspaceAccess, workspacePath})}>Save provider settings</Button>
    {session.provider === 'ollama' && <Button disabled={disabled} onClick={() => void refreshModels()}>Load Ollama models</Button>}
  </details>;
}
