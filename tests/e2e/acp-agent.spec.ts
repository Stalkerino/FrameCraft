import {test, expect} from '@playwright/test';
import path from 'node:path';

test('custom CLI uses the existing chat and real MCP bridge; sidebar controls fit their text', async ({page, request}) => {
  await page.goto('/');
  await page.getByRole('button', {name: 'Tools', exact: true}).click();
  const controls = page.locator('.assist-workspace .field select');
  // Fixed 28px height plus 18px padding previously left less room than a line of text.
  expect(await controls.count()).toBeGreaterThan(0);
  for(const select of await controls.all()) expect(await select.evaluate(el => {const s = getComputedStyle(el); return el.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom) >= parseFloat(s.fontSize) * 1.2;})).toBe(true);
  const configured = await request.post('/api/agent/chat/provider', {data: {provider: 'custom-acp', cliAgents: {'custom-acp': {command: process.execPath, args: [path.resolve('tests/fixtures/acp-agent.mjs')], cwd: ''}}}}); expect(configured.ok()).toBe(true);
  try {
    await page.reload();
    await page.locator('.tool-rail__agent').click();
    await page.getByRole('button', {name: 'Start Custom agent', exact: true}).click();
    await page.getByRole('tab', {name: 'Settings', exact: true}).click();
    await expect(page.getByLabel('AI provider')).toHaveValue('custom-acp');
    await expect(page.getByLabel('AI provider').locator('option')).toHaveText(['Codex CLI', 'Ollama · Local / network', 'Claude Code · ACP adapter', 'Gemini CLI', 'OpenCode CLI', 'Custom ACP CLI']);
    await page.getByLabel('Model', {exact: true}).selectOption('fast');
    await page.getByRole('tab', {name: 'Chat', exact: true}).click();
    await page.getByRole('textbox', {name: 'Message Custom agent'}).fill('real MCP'); await page.getByRole('button', {name: 'Send', exact: true}).click();
    await expect(page.locator('.agent-message--assistant').last()).toContainText('save_asset_preset');
    await expect(page.locator('.agent-message--assistant').last()).toContainText('edit_project');
    await expect(page.locator('.agent-conversation').getByText('framecraft · get_project', {exact: true})).toBeVisible();
    await page.reload(); await page.locator('.tool-rail__agent').click(); await expect(page.locator('.agent-message--assistant').last()).toContainText('Real MCP connected.');
  } finally {await request.post('/api/agent/chat/interrupt'); await request.post('/api/agent/chat/provider', {data: {provider: 'codex'}});}
});
