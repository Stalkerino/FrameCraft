import {afterEach, describe, expect, it} from 'vitest';
import path from 'node:path';
import {AcpSessionService} from '../server/services/acp-session-service';
import {resolveCliAgent} from '../server/services/cli-agent-command-service';
import {agentProviderSettingsSchema} from '../shared/agent';
const sessions: AcpSessionService[] = [];
afterEach(() => {for(const session of sessions.splice(0)) session.close();});
function create() {
  const settings = agentProviderSettingsSchema.parse({provider: 'custom-acp', cliAgents: {'custom-acp': {command: process.execPath, args: [path.resolve('tests/fixtures/acp-agent.mjs')], cwd: ''}}});
  const service = new AcpSessionService({root: process.cwd(), data: '/unused', url: 'http://127.0.0.1:4319'}, 'custom-acp', () => settings); sessions.push(service); return service;
}
describe('ACP CLI integration', () => {
  it('streams settings and responses, records auto-approved tools, declines permissions, cancels and reconnects', async () => {
    const service = create(); await service.start();
    expect(service.snapshot().configOptions?.[0].currentValue).toBe('balanced');
    await service.configureOption('model', 'fast'); await service.send('hello');
    await expect.poll(() => service.snapshot().status).toBe('ready'); expect(service.snapshot().messages.at(-1)?.text).toBe('ACP response using fast.');
    service.setAutoApprove(true); await service.send('approval');
    await expect.poll(() => service.snapshot().status).toBe('ready');
    expect(service.snapshot().activity.at(-1)).toMatchObject({label: 'framecraft · edit_project', status: 'completed'});
    service.setAutoApprove(false); await service.send('approval');
    await expect.poll(() => service.snapshot().requests.length).toBe(1);
    service.respond({id: service.snapshot().requests[0].id, decision: 'decline'});
    await expect.poll(() => service.snapshot().status).toBe('ready'); expect(service.snapshot().messages.at(-1)?.text).toBe('Permission declined.');
    await service.send('wait'); await service.interrupt(); expect(service.snapshot().status).toBe('ready');
    const thread = service.snapshot().threadId; service.close(); await service.start();
    expect(service.snapshot().threadId).toBe(thread); expect(service.snapshot().messages.at(-1)?.text).toBe('Resumed ACP conversation.');
    await service.send('crash'); await expect.poll(() => service.snapshot().status).toBe('error'); expect(service.snapshot().turnId).toBeNull();
  });
  it('resolves Windows npm shims without invoking a shell, including spaced paths', async () => {
    const root = 'C:\\My Programs\\npm'; const script = path.win32.join(root, 'node_modules/@google/gemini-cli/dist/index.js');
    const executable = await resolveCliAgent('gemini', {command: path.win32.join(root, 'gemini.cmd'), args: ['--experimental-acp'], cwd: root}, {
      platform: 'win32', node: 'C:\\Node\\node.exe', available: async file => [script, path.win32.join(root, 'gemini.cmd')].includes(file), read: async () => JSON.stringify({bin: {gemini: 'dist/index.js'}}),
    });
    expect(executable).toEqual({command: 'C:\\Node\\node.exe', args: [script, '--experimental-acp']});
  });
  it('preserves old Codex/Ollama settings and defaults approval off', () => {
    expect(agentProviderSettingsSchema.parse({provider: 'codex'}).cliAgents).toEqual({});
    expect(create().snapshot().autoApprove).toBe(false);
  });
  it('exposes required authentication without silently choosing an account method', async () => {
    const settings = agentProviderSettingsSchema.parse({provider: 'custom-acp', cliAgents: {'custom-acp': {command: process.execPath, args: [path.resolve('tests/fixtures/acp-agent.mjs'), '--auth-required'], cwd: ''}}});
    const service = new AcpSessionService({root: process.cwd(), data: '/unused', url: 'http://127.0.0.1:4319'}, 'custom-acp', () => settings); sessions.push(service);
    await expect(service.start()).rejects.toThrow('Authentication required');
    expect(service.snapshot().authMethods).toEqual([{id: 'fixture-login', name: 'Fixture sign-in'}]);
    settings.cliAgents['custom-acp'].authMethod = 'fixture-login'; await service.start(); expect(service.snapshot().status).toBe('ready');
  });
});
