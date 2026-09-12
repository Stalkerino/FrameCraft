import {test, expect} from '@playwright/test';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

// Controlled model responses; the MCP bridge and project edits are real.
test('network Ollama uses real MCP tools, approval, streaming, undo and provider switching', async ({page, request}) => {
  let requests = 0; let projectRevision = 0; let editRequests = 0;
  const workspace = await mkdtemp(path.join(tmpdir(), 'fc-ollama-workspace-'));
  const generatedSvg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Local asset</text></svg>';
  const generatorScript = `import {writeFileSync} from "node:fs"; writeFileSync("title.svg", ${JSON.stringify(generatedSvg)});`;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await(const chunk of req) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    res.setHeader('Content-Type', 'application/json');
    if(req.url === '/api/tags') {res.end(JSON.stringify({models: [{name: 'local-test:8b'}, {name: 'cloud-test:cloud'}]})); return;}
    if(req.url === '/api/show') {res.end(JSON.stringify({capabilities: ['completion', 'tools', 'vision', 'thinking']})); return;}
    if(req.url !== '/api/chat') {res.statusCode = 404; res.end('{}'); return;}
    requests++;
    const tools = (body.tools ?? []).map((t: {function: {name: string}}) => t.function.name);
    // Model templates can reject historical calls absent from the current tool list.
    const missing = body.messages.flatMap((m: {tool_calls?: {function: {name: string}}[]}) => m.tool_calls ?? []).find((call: {function: {name: string}}) => !tools.includes(call.function.name));
    if(missing) {res.statusCode = 400; res.end(JSON.stringify({error: `tool '${missing.function.name}' not found`})); return;}
    const last = body.messages[body.messages.length - 1];
    const call = (name: string, args: unknown) => ({role: 'assistant', content: '', tool_calls: [{function: {name, arguments: args}}]});
    let message;
    if(last.role === 'user' && last.content === 'Generate a workspace asset') message = call('discover_tools', {names: ['write_workspace_file', 'run_workspace_command']});
    else if(last.tool_name === 'discover_tools' && tools.includes('write_workspace_file')) message = call('write_workspace_file', {path: 'generate.mjs', content: generatorScript, expectedSha256: null});
    else if(last.tool_name === 'write_workspace_file') message = call('run_workspace_command', {executable: 'node', args: ['generate.mjs']});
    else if(last.tool_name === 'run_workspace_command') message = {role: 'assistant', content: 'Workspace asset generated.'};
    else if(last.role === 'user') message = call('get_project', {});
    else if(last.tool_name === 'get_project') {
      const result = JSON.parse(last.content);
      if(result.contextReference) message = call('read_context_result', {id: result.contextReference, pointer: '/project/revision'});
      else {projectRevision = result.project.revision; message = call('discover_tools', {names: ['edit_project']});}
    } else if(last.tool_name === 'read_context_result') {
      projectRevision = JSON.parse(JSON.parse(last.content).text); message = call('discover_tools', {names: ['edit_project']});
    } else if(last.tool_name === 'discover_tools') {
      expect(tools.includes('edit_project') || tools.includes('call_editor_tool')).toBe(true); editRequests++;
      const args = {revision: projectRevision, label: 'Ollama test title', commands: [{type: 'clip.add', clip: {id: `ollama-title-${editRequests}`, name: 'Ollama title', kind: 'text', track: 'text', text: 'Made through local MCP', start: 0, duration: 60}}]};
      message = tools.includes('edit_project') ? call('edit_project', args) : call('call_editor_tool', {name: 'edit_project', arguments: args});
    } else message = {role: 'assistant', content: 'Title added through Framecraft tools.'};
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.write(JSON.stringify({message, done: false}) + '\n'); res.end(JSON.stringify({done: true}) + '\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const before = (await (await request.get('/api/project')).json()).project;
    await page.goto('/'); await page.getByRole('button', {name: 'Codex', exact: true}).click();
    await page.getByRole('tab', {name: 'Settings', exact: true}).click();
    await page.getByRole('combobox', {name: 'AI provider', exact: true}).selectOption('ollama');
    await page.getByRole('textbox', {name: 'Ollama server URL'}).fill(url);
    await page.getByRole('button', {name: 'Save provider settings'}).click();
    await page.getByRole('button', {name: 'Load Ollama models'}).click();
    await expect(page.getByRole('combobox', {name: 'Ollama model', exact: true})).toBeEnabled();
    await page.getByRole('combobox', {name: 'Ollama model', exact: true}).selectOption('local-test:8b');
    await page.getByRole('tab', {name: 'Chat', exact: true}).click();
    await page.getByRole('button', {name: 'Start Ollama', exact: true}).click();
    await expect(page.getByText('Ollama · MCP connected', {exact: true})).toBeVisible();
    await page.getByRole('textbox', {name: 'Message Ollama'}).fill('Add a title'); await page.getByRole('button', {name: 'Send', exact: true}).click();
    await expect(page.getByRole('heading', {name: 'Allow edit_project?'})).toBeVisible({timeout: 20000});
    expect((await (await request.get('/api/project')).json()).project.revision).toBe(before.revision);
    await page.getByRole('button', {name: 'Allow once', exact: true}).click();
    await expect(page.getByText('Title added through Framecraft tools.', {exact: true})).toBeVisible();
    const after = (await (await request.get('/api/project')).json()).project;
    expect(after.clips.some((c: {id: string}) => c.id === 'ollama-title-1')).toBe(true);
    await page.getByRole('switch', {name: 'Automatically allow Ollama tool calls'}).click(); await expect(page.getByRole('switch', {name: 'Automatically allow Ollama tool calls'})).toBeChecked();
    await page.getByRole('textbox', {name: 'Message Ollama'}).fill('Add another'); await page.getByRole('button', {name: 'Send', exact: true}).click();
    await expect(page.getByText('Title added through Framecraft tools.', {exact: true})).toHaveCount(2);
    await expect(page.locator('.agent-tool summary').filter({hasText: 'edit_project'})).toHaveCount(2);
    expect(requests).toBeGreaterThanOrEqual(8); expect(editRequests).toBe(2);
    const current = (await (await request.get('/api/project')).json()).project;
    const undo = await request.post('/api/history/undo', {data: {revision: current.revision}}); expect(undo.ok()).toBe(true);
    expect((await undo.json()).project.clips.some((c: {id: string}) => c.id === 'ollama-title-2')).toBe(false);
    await page.reload(); await page.getByRole('button', {name: 'Ollama', exact: true}).click();
    await expect(page.getByText('Title added through Framecraft tools.', {exact: true})).toHaveCount(2);
    await page.getByRole('tab', {name: 'Settings', exact: true}).click();
    await page.getByRole('combobox', {name: 'Ollama workspace access'}).selectOption('commands');
    await page.getByRole('textbox', {name: 'Ollama workspace folder'}).fill(workspace);
    await page.getByRole('button', {name: 'Save provider settings'}).click();
    await page.getByRole('tab', {name: 'Chat', exact: true}).click();
    await page.getByRole('button', {name: 'Start Ollama', exact: true}).click();
    await page.getByRole('switch', {name: 'Automatically allow Ollama tool calls'}).click();
    await expect(page.getByRole('switch', {name: 'Automatically allow Ollama tool calls'})).not.toBeChecked();
    await page.getByRole('textbox', {name: 'Message Ollama'}).fill('Generate a workspace asset');
    await page.getByRole('button', {name: 'Send', exact: true}).click();
    await expect(page.getByRole('heading', {name: 'Allow write_workspace_file?'})).toBeVisible();
    await expect(readFile(path.join(workspace, 'generate.mjs'))).rejects.toThrow();
    await page.getByRole('button', {name: 'Allow once', exact: true}).click();
    await expect(page.getByRole('heading', {name: 'Allow run_workspace_command?'})).toBeVisible();
    await expect(readFile(path.join(workspace, 'title.svg'))).rejects.toThrow();
    await page.getByRole('button', {name: 'Allow once', exact: true}).click();
    await expect(page.getByText('Workspace asset generated.', {exact: true})).toBeVisible();
    expect(await readFile(path.join(workspace, 'title.svg'), 'utf8')).toContain('Local asset');
    await expect(page.locator('.agent-tool summary').filter({hasText: 'run_workspace_command'})).toHaveCount(1);
    const switched = await request.post('/api/agent/chat/provider', {data: {provider: 'codex', ollamaUrl: url, contextLength: 32768}}); expect(switched.ok()).toBe(true);
    await expect(page.getByRole('button', {name: 'Start Codex', exact: true})).toBeVisible();
  } finally {server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(workspace, {recursive: true, force: true});}
});
