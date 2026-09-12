import {afterEach, expect, it} from 'vitest';
import {mkdtemp, mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {agentProviderSettingsSchema} from '../shared/agent';
import {AgentWorkspaceService} from '../server/services/agent-workspace-service';

const directories: string[] = [];
afterEach(async () => {for(const directory of directories.splice(0)) await rm(directory, {recursive: true, force: true});});
async function workspace(access: 'disabled' | 'files' | 'commands' = 'files') {
  const root = await mkdtemp(path.join(tmpdir(), 'fc-workspace-')); directories.push(root);
  const settings = agentProviderSettingsSchema.parse({provider: 'ollama', workspaceAccess: access});
  const service = new AgentWorkspaceService({root, data: path.join(root, 'data')}, () => settings);
  return {root, settings, service, call: async (name: string, args: Record<string, unknown>, signal = new AbortController().signal) => JSON.parse((await service.call(name, args, signal)).content[0].text)};
}
it('gates tools at discovery and execution, with editor-only defaults', async () => {
  const {service, settings, call} = await workspace('disabled');
  expect(service.tools).toEqual([]);
  await expect(call('write_workspace_file', {path: 'test.txt', content: 'hello', expectedSha256: null})).rejects.toThrow('disabled');
  settings.workspaceAccess = 'files'; expect(service.tools).toHaveLength(4);
  await expect(call('run_workspace_command', {executable: 'node'})).rejects.toThrow('disabled');
  settings.workspaceAccess = 'commands'; expect(service.tools).toHaveLength(5);
});
it('creates assets, pages reads and refuses stale or ambiguous edits', async () => {
  const {root, call} = await workspace();
  const saved = await call('write_workspace_file', {path: 'assets/title.svg', content: '<svg>Title</svg>', expectedSha256: null});
  const read = await call('read_workspace_file', {path: 'assets/title.svg', limit: 5});
  expect(read.content).toBe('<svg>'); expect(read.nextOffset).toBe(5); expect(read.sha256).toBe(saved.sha256);
  await expect(call('write_workspace_file', {path: 'assets/title.svg', content: 'overwrite', expectedSha256: null})).rejects.toThrow('already exists');
  await call('edit_workspace_file', {path: 'assets/title.svg', search: 'Title', replacement: 'New title', expectedSha256: saved.sha256});
  await expect(call('write_workspace_file', {path: 'assets/title.svg', content: 'stale', expectedSha256: saved.sha256})).rejects.toThrow('File changed');
  expect(await readFile(path.join(root, 'assets/title.svg'), 'utf8')).toBe('<svg>New title</svg>');
});
it('blocks traversal, symlink escapes and direct live-data writes', async () => {
  const {root, call} = await workspace();
  const outside = await mkdtemp(path.join(tmpdir(), 'fc-outside-')); directories.push(outside);
  await symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  for(const target of ['../escape.txt', 'escape/new.txt', 'data/project.json', '.git/config']) {
    await expect(call('write_workspace_file', {path: target, content: 'bad', expectedSha256: null})).rejects.toThrow();
  }
  await writeFile(path.join(outside, 'private.txt'), 'outside');
  await expect(call('read_workspace_file', {path: 'escape/private.txt'})).rejects.toThrow('outside');
  await mkdir(path.join(root, 'data')); await writeFile(path.join(root, 'data/project.json'), 'original');
  expect(await readFile(path.join(root, 'data/project.json'), 'utf8')).toBe('original');
});
it('runs a real command with literal arguments and reports errors and bounded output', async () => {
  const {root, call} = await workspace('commands');
  const literal = 'a b; $(not-a-command) "quoted"';
  const output = await call('run_workspace_command', {executable: 'node', args: ['-e', 'console.log(JSON.stringify({cwd:process.cwd(),arg:process.argv[1]}))', literal]});
  expect(output.exitCode).toBe(0); expect(JSON.parse(output.stdout)).toEqual({cwd: root, arg: literal});
  const failed = await call('run_workspace_command', {executable: 'node', args: ['-e', 'process.stdout.write("x".repeat(50000));console.error("failed");process.exitCode=3']});
  expect(failed.exitCode).toBe(3); expect(failed.stderr).toContain('failed'); expect(failed.stdout.length).toBe(32000); expect(failed.truncated).toBe(true);
});
it('terminates a command on timeout or cancellation', async () => {
  const {call} = await workspace('commands');
  const args = {executable: 'node', args: ['-e', 'setInterval(()=>{},100)'], timeoutMs: 1000};
  const timed = await call('run_workspace_command', args); expect(timed.timedOut).toBe(true);
  const controller = new AbortController();
  const result = call('run_workspace_command', args, controller.signal);
  const timer = setTimeout(() => controller.abort(new Error('User stopped command')), 100);
  try {await expect(result).rejects.toThrow('User stopped');} finally {clearTimeout(timer);}
});
