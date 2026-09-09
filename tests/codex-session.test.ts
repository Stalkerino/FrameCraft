import {afterEach, describe, expect, it} from 'vitest';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CodexSessionService} from '../server/services/codex-session-service';
import {codexMcpArguments, resolveCodex} from '../server/services/codex-command-service';
import {agentConversationEntries} from '../shared/agent';

const services: CodexSessionService[] = []; const directories: string[] = [];
async function service() {
  const data = await mkdtemp(path.join(os.tmpdir(), 'framecraft-codex-')); directories.push(data);
  const options = {root: path.resolve('.'), data, url: 'http://127.0.0.1:4319', executable: async () => ({command: process.execPath, args: [path.resolve('tests/fixtures/fake-codex.mjs')]})};
  const agent = new CodexSessionService(options); services.push(agent); return {agent, data, options};
}
afterEach(async () => {services.splice(0).forEach(s => s.close()); await Promise.all(directories.splice(0).map(dir => rm(dir, {recursive: true, force: true})));});

describe('Codex process boundary', () => {
  it('resolves Windows npm shims without shell interpolation', async () => {
    const bin = 'C:\\Users\\A & B\\npm';
    const script = path.win32.join(bin, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    const result = await resolveCodex({platform: 'win32', env: {Path: bin}, node: 'C:\\Program Files\\nodejs\\node.exe', available: async file => [path.win32.join(bin, 'codex.cmd'), script].includes(file)});
    expect(result).toEqual({command: 'C:\\Program Files\\nodejs\\node.exe', args: [script]});
    const args = codexMcpArguments('C:\\Projects\\Devlog & clips', 'http://127.0.0.1:4319', result.command, 'win32');
    expect(args).toHaveLength(2); expect(args[1]).toContain(JSON.stringify('C:\\Projects\\Devlog & clips\\scripts\\mcp.mjs'));
    expect(args[1]).toContain('FRAMECRAFT_URL = "http://127.0.0.1:4319"');
  });
  it('gives an actionable error when the CLI is missing', async () => {
    await expect(resolveCodex({env: {PATH: '/missing'}, available: async () => false})).rejects.toThrow('Codex CLI was not found');
  });
});

describe('embedded Codex session', () => {
  it('discovers all model pages and saves model, effort and speed on the same thread', async () => {
    const {agent, options} = await service(); await agent.start();
    expect(agent.snapshot().models.map(model => model.model)).toEqual(['test-model', 'test-thinking']);
    const selected = {model: 'test-thinking', effort: 'high', serviceTier: 'priority'};
    await agent.configure(selected); await agent.send('report model');
    await expect.poll(() => agent.snapshot().status).toBe('ready');
    expect(JSON.parse(agent.snapshot().messages.at(-1)!.text)).toEqual(selected);
    expect(agent.snapshot().threadId).toBe('test-thread');
    await expect(agent.configure({...selected, effort: 'unsupported'})).rejects.toThrow('thinking effort');
    await agent.send('wait'); await expect(agent.configure(selected)).rejects.toThrow('Wait for Codex'); await agent.interrupt();
    await expect.poll(() => agent.snapshot().status).toBe('ready');
    agent.close(); const resumed = new CodexSessionService(options); services.push(resumed); await resumed.start();
    expect(resumed.snapshot()).toMatchObject(selected);
    await resumed.configure({...selected, effort: null, serviceTier: null});
    await resumed.send('report model'); await expect.poll(() => resumed.snapshot().status).toBe('ready');
    expect(JSON.parse(resumed.snapshot().messages.at(-1)!.text)).toEqual({...selected, effort: 'low', serviceTier: null});
  });
  it('auto-allows pending and future approvals only while enabled, retaining real questions', async () => {
    const {agent} = await service(); await agent.start(); await agent.send('approval');
    await expect.poll(() => agent.snapshot().requests.length).toBe(1);
    agent.setAutoApprove(true); await expect.poll(() => agent.snapshot().status).toBe('ready');
    expect(agent.snapshot().messages.at(-1)?.text).toBe('Approval received.');
    for(const prompt of ['mcp approval', 'file approval', 'permissions']) {await agent.send(prompt); await expect.poll(() => agent.snapshot().status).toBe('ready'); expect(agent.snapshot().requests).toEqual([]);}
    expect(agent.snapshot().messages.at(-1)?.text).toContain('"scope":"turn"');
    expect(agent.snapshot().activity.filter(a => a.label === 'Automatically allowed')).toHaveLength(4);
    const entries = agentConversationEntries(agent.snapshot());
    const approvedTool = entries.findIndex(entry => entry.kind === 'activity' && entry.item.id === 'approved-tool-2');
    expect(approvedTool).toBeGreaterThan(0);
    expect(entries[approvedTool].item).toMatchObject({label: 'framecraft · get_project', status: 'completed'});
    expect(entries[approvedTool + 1].item).toMatchObject({label: 'Automatically allowed'});
    expect(entries[approvedTool + 2].item).toMatchObject({role: 'assistant', text: 'MCP accept: {}'});
    await agent.send('question'); await expect.poll(() => agent.snapshot().requests.length).toBe(1); expect(agent.snapshot().requests[0].kind).toBe('questions'); await agent.interrupt();
    await expect.poll(() => agent.snapshot().status).toBe('ready');
    await agent.send('external form'); await expect.poll(() => agent.snapshot().requests.length).toBe(1); expect(agent.snapshot().requests[0].kind).toBe('unsupported'); await agent.interrupt();
    await expect.poll(() => agent.snapshot().status).toBe('ready'); agent.setAutoApprove(false); await agent.send('approval'); await expect.poll(() => agent.snapshot().requests.length).toBe(1);
    agent.close(); expect(agent.snapshot().autoApprove).toBe(false);
  });
  it('shares one startup, streams replies, retains tool activity and resumes the stored thread', async () => {
    const {agent, data, options} = await service();
    const sessions = await Promise.all([agent.start(), agent.start()]); expect(sessions.map(s => s.threadId)).toEqual(['test-thread', 'test-thread']);
    await agent.send('Read the timeline');
    await expect.poll(() => agent.snapshot().status).toBe('ready');
    expect(agent.snapshot().messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(agent.snapshot().messages[1].text).toContain('**Codex reply**');
    expect(agent.snapshot().activity[0].label).toBe('framecraft · get_project');
    const entries = agentConversationEntries(agent.snapshot());
    expect(entries.map(entry => entry.kind)).toEqual(['message', 'activity', 'message']);
    expect(entries.map(entry => entry.item.order)).toEqual([0, 1, 2]);
    expect(entries[1].item).toMatchObject({status: 'completed'});
    expect(JSON.parse(await readFile(path.join(data, 'codex-session.json'), 'utf8')).threadId).toBe('test-thread');
    agent.close(); const resumed = new CodexSessionService(options); services.push(resumed);
    expect((await resumed.start()).messages[0].text).toBe('Resumed conversation.');
  });
  it('waits for explicit approval and rejects stale approval replies', async () => {
    const {agent} = await service(); await agent.start(); await agent.send('approval');
    await expect.poll(() => agent.snapshot().requests.length).toBe(1);
    const request = agent.snapshot().requests[0]; expect(request.detail).toContain('example command with spaces');
    expect(agent.snapshot().status).toBe('working');
    await expect(agent.send('another request')).rejects.toThrow('Wait for Codex');
    agent.respond({id: request.id, decision: 'decline'});
    expect(() => agent.respond({id: request.id, decision: 'accept'})).toThrow('no longer pending');
    await expect.poll(() => agent.snapshot().status).toBe('ready');
    expect(agent.snapshot().messages.at(-1)?.text).toBe('Request declined.');
  });
  it('answers questions, interrupts active turns and clears pending requests', async () => {
    const {agent} = await service(); await agent.start(); await agent.send('question');
    await expect.poll(() => agent.snapshot().requests.length).toBe(1);
    const id = agent.snapshot().requests[0].id;
    expect(() => agent.respond({id, answers: {}})).toThrow('Answer each question');
    agent.respond({id, answers: {style: 'Minimal'}});
    await expect.poll(() => agent.snapshot().status).toBe('ready');
    expect(agent.snapshot().messages.at(-1)?.text).toBe('Answer received: Minimal');
    await agent.send('approval'); await agent.interrupt();
    await expect.poll(() => agent.snapshot().status).toBe('ready');
    expect(agent.snapshot().requests).toEqual([]); expect(agent.snapshot().turnId).toBeNull();
  });
  it('recovers after a rejected turn and reports a crashed process', async () => {
    const {agent} = await service(); await agent.start();
    await expect(agent.send('reject')).rejects.toThrow('Test upstream failure'); expect(agent.snapshot().status).toBe('ready');
    await expect(agent.send('crash')).rejects.toThrow('Codex stopped');
    expect(agent.snapshot().status).toBe('error'); expect(agent.snapshot().turnId).toBeNull();
  });
  it('accepts a real MCP tool confirmation shape and refuses unsupported structured forms', async () => {
    const {agent} = await service(); await agent.start(); await agent.send('mcp approval');
    await expect.poll(() => agent.snapshot().requests.length).toBe(1);
    let request = agent.snapshot().requests[0]; expect(request.kind).toBe('approval');
    agent.respond({id: request.id, decision: 'accept'});
    await expect.poll(() => agent.snapshot().status).toBe('ready');
    expect(agent.snapshot().messages.at(-1)?.text).toBe('MCP accept: {}');
    await agent.send('external form'); await expect.poll(() => agent.snapshot().requests.length).toBe(1);
    request = agent.snapshot().requests[0]; expect(request.kind).toBe('unsupported');
    expect(() => agent.respond({id: request.id, decision: 'accept'})).toThrow('not supported');
    agent.respond({id: request.id, decision: 'decline'});
    await expect.poll(() => agent.snapshot().status).toBe('ready');
    expect(agent.snapshot().messages.at(-1)?.text).toBe('MCP decline: null');
  });
});
