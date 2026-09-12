import {test, expect} from '@playwright/test';

test('embedded chat streams replies, handles approvals/questions, preserves errors and survives reloads', async ({page, request}) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.getByRole('complementary', {name: 'Inspector and Codex'}).getByRole('button', {name: 'Codex AI', exact: true}).click();
  await page.getByRole('button', {name: 'Start Codex', exact: true}).click();
  const prompt = page.getByRole('textbox', {name: 'Message Codex'}); const send = page.getByRole('button', {name: 'Send', exact: true});
  await page.getByRole('tab', {name: 'Settings', exact: true}).click();
  await page.getByLabel('Codex model', {exact: true}).selectOption('test-thinking');
  await expect(page.getByLabel('Thinking effort', {exact: true})).toHaveValue('low');
  await page.getByLabel('Thinking effort', {exact: true}).selectOption('high');
  await expect(page.getByLabel('Thinking effort', {exact: true})).toHaveValue('high');
  await page.getByLabel('Response speed', {exact: true}).selectOption('priority');
  await expect(page.getByLabel('Response speed', {exact: true})).toHaveValue('priority');
  await page.getByRole('tab', {name: 'Chat', exact: true}).click();
  await prompt.fill('report model'); await send.click();
  await expect(page.locator('.agent-message--assistant')).toContainText('"model":"test-thinking","effort":"high","serviceTier":"priority"');
  await page.reload(); await page.getByRole('complementary', {name: 'Inspector and Codex'}).getByRole('button', {name: 'Codex AI', exact: true}).click();
  await page.getByRole('tab', {name: 'Settings', exact: true}).click();
  await expect(page.getByLabel('Codex model', {exact: true})).toHaveValue('test-thinking');
  await page.getByLabel('Codex model', {exact: true}).selectOption('test-model');
  await expect(page.getByLabel('Response speed', {exact: true})).toHaveValue('');
  await page.getByRole('tab', {name: 'Chat', exact: true}).click();
  await prompt.fill('Read my timeline'); await expect(send).toBeEnabled(); await send.click();
  await expect(page.locator('.agent-message--assistant').last()).toContainText('Codex reply');
  // A started app-server is not itself evidence of an initialized MCP connection.
  await expect(page.getByText('Waiting for a Codex session', {exact: true})).toBeVisible();
  await page.reload(); await page.getByRole('complementary', {name: 'Inspector and Codex'}).getByRole('button', {name: 'Codex AI', exact: true}).click();
  await expect(page.locator('.agent-message--assistant').last()).toContainText('Codex reply');
  await page.getByRole('tab', {name: 'Activity', exact: true}).click();
  await expect(page.getByText('framecraft · get_project', {exact: true})).toBeVisible();
  await page.getByRole('tab', {name: 'Chat', exact: true}).click();
  await prompt.fill('My draft'); await page.getByRole('button', {name: 'Expand Codex chat'}).click();
  await expect(page.getByRole('dialog', {name: 'Expanded Codex chat'})).toBeVisible(); await expect(prompt).toHaveValue('My draft');
  await page.getByRole('button', {name: 'Collapse Codex chat'}).click(); await expect(prompt).toHaveValue('My draft');
  await prompt.fill('approval'); await send.click(); await expect(page.getByText('Codex needs your approval')).toBeVisible();
  await page.getByRole('button', {name: 'Allow once', exact: true}).click(); await expect(page.getByText('Approval received.', {exact: true})).toBeVisible();
  await prompt.fill('mcp approval'); await send.click();
  await expect(page.getByText('Allow Framecraft to inspect the timeline?', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Allow once', exact: true}).click(); await expect(page.getByText('MCP accept: {}', {exact: true})).toBeVisible();
  await prompt.fill('question'); await send.click();
  await page.getByRole('button', {name: 'Minimal', exact: true}).click(); await page.getByRole('button', {name: 'Send answer', exact: true}).click();
  await expect(page.getByText('Answer received: Minimal', {exact: true})).toBeVisible();
  await prompt.fill('reject'); await send.click(); await expect(page.getByRole('alert')).toContainText('Test upstream failure'); await expect(prompt).toHaveValue('reject');
  await prompt.fill('wait'); await send.click(); await page.getByRole('button', {name: 'Stop response', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Send', exact: true})).toBeVisible();
  const denied = await request.post('/api/agent/chat/start', {headers: {Origin: 'https://unrelated.example'}, data: {}}); expect(denied.status()).toBe(403);
  const invalid = await request.post('/api/agent/chat/start', {data: {command: 'arbitrary-command'}}); expect(invalid.status()).toBe(400);
  expect(errors).toEqual([]);
});

test('auto-allow toggle handles current and future approvals and can be switched off', async ({page, request}) => {
  await request.post('/api/agent/chat/start', {data: {fresh: true}}); await request.post('/api/agent/chat/auto-approve', {data: {enabled: false}});
  await page.goto('/'); await page.getByRole('complementary', {name: 'Inspector and Codex'}).getByRole('button', {name: 'Codex AI', exact: true}).click();
  const prompt = page.getByRole('textbox', {name: 'Message Codex'}); const send = page.getByRole('button', {name: 'Send', exact: true});
  await prompt.fill('approval'); await send.click(); await expect(page.getByRole('button', {name: 'Allow once', exact: true})).toBeVisible();
  const toggle = page.getByRole('switch', {name: 'Automatically allow Codex approvals'}); await toggle.click(); await expect(toggle).toBeChecked(); await expect(page.getByText('Approval received.', {exact: true})).toBeVisible();
  await prompt.fill('mcp approval'); await send.click(); await expect(page.getByText('MCP accept: {}', {exact: true})).toBeVisible();
  await toggle.click(); await expect(toggle).not.toBeChecked(); await prompt.fill('approval'); await send.click(); await expect(page.getByRole('button', {name: 'Allow once', exact: true})).toBeVisible(); await page.getByRole('button', {name: 'Decline', exact: true}).click();
  await expect(page.getByText('Request declined.', {exact: true})).toBeVisible();
});

test('dictation stays editable before send and reports microphone denial', async ({page, request}) => {
  await page.addInitScript(() => {
    let count = 0;
    class Recognition {
      lang = ''; continuous = false; interimResults = false;
      onresult: ((event: unknown) => void) | null = null; onerror: ((event: unknown) => void) | null = null; onend: (() => void) | null = null;
      start() {
        count++;
        setTimeout(() => {
          if(count === 2) {this.onerror?.({error: 'not-allowed'}); this.onend?.(); return;}
          this.onresult?.({results: [{isFinal: false, 0: {transcript: 'Add a title'}}]});
          this.onresult?.({results: [{isFinal: true, 0: {transcript: 'Add a title'}}]});
        }, 60);
      }
      stop() {this.onend?.();}
      abort() {}
    }
    Object.assign(window, {SpeechRecognition: Recognition});
  });
  await request.post('/api/agent/chat/start', {data: {fresh: true}});
  await page.goto('/'); await page.getByRole('complementary', {name: 'Inspector and Codex'}).getByRole('button', {name: 'Codex AI', exact: true}).click();
  const prompt = page.getByRole('textbox', {name: 'Message Codex'}); await prompt.fill('Please');
  await page.getByRole('combobox', {name: 'Dictation language'}).selectOption('fr-FR');
  await page.getByRole('button', {name: 'Dictate a prompt'}).click();
  await expect(prompt).toHaveValue('Please Add a title');
  await expect(page.getByRole('button', {name: 'Send', exact: true})).toBeDisabled();
  await page.getByRole('button', {name: 'Stop dictation'}).click();
  await expect(page.locator('.agent-message--user')).toHaveCount(0);
  await prompt.fill('Add an opening title'); await page.getByRole('button', {name: 'Send', exact: true}).click();
  await expect(page.locator('.agent-message--user')).toContainText('Add an opening title');
  await page.getByRole('button', {name: 'Dictate a prompt'}).click();
  await expect(page.getByRole('alert')).toContainText('Microphone access was denied');
  await expect(page.getByRole('button', {name: 'Dictate a prompt'})).toBeVisible();
  await prompt.fill('I can still type'); await expect(prompt).toHaveValue('I can still type');
});
