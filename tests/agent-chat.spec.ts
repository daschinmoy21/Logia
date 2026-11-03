import { test, expect, type Page } from '@playwright/test';
import { openAgentWorkspace, installAgentFixture, agentCalls } from './agent-fixture';

async function choose(page: Page, name: string) {
  await page.getByRole('button', { name: /^Choose agent\. Current:/ }).click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${name}( |$)`) }).click();
}

async function openChat(page: Page) {
  await openAgentWorkspace(page);
  await installAgentFixture(page);
  await page.getByRole('button', { name: 'Open AI sidebar', exact: true }).click();
  await choose(page, 'Codex');
  await expect(page.getByRole('textbox', { name: 'Message Codex', exact: true })).toBeVisible();
}

test('new sessions open directly into a composer and send real model, effort, access, and note controls', async ({ page }, testInfo) => {
  await openChat(page);
  const composer = page.getByRole('textbox', { name: 'Message Codex', exact: true });
  await expect(composer).toBeFocused();
  await expect(page.getByRole('button', { name: 'Start session', exact: true })).toHaveCount(0);
  await expect(page.locator('.xterm')).toHaveCount(0);
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await expect(composer).toBeFocused();
  await page.getByRole('button', { name: /^Choose model for Codex CLI/ }).click();
  await page.getByRole('radio', { name: 'Codex CLI: Second Model', exact: true }).check();
  await page.getByRole('radio', { name: 'Codex CLI: Fixture Model', exact: true }).check();
  await page.getByRole('button', { name: 'Close model settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Reasoning effort', exact: true }).locator('option[value="high"]')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Reasoning effort', exact: true }).selectOption('high');
  await page.getByRole('combobox', { name: 'Agent access', exact: true }).selectOption('workspace-write');
  await page.getByRole('button', { name: 'Attach current note', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('agent-chat.png') });
  await composer.fill('Summarize the attached note');
  await page.getByRole('button', { name: 'Send to Codex', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Fixture chat reply');
  const run = (await agentCalls(page)).find((call) => call.command === 'ai_cli_run')!;
  expect(run.args.model).toBe('fixture-model');
  expect(run.args.options).toMatchObject({ reasoningEffort: 'high', access: 'workspace-write' });
  expect(run.args.options.sessionId).toMatch(/^[a-f\d-]{36}$/);
  expect(run.args.prompt).toContain('Keep notes local.');
  expect(run.args.prompt).not.toContain('Do not run tools or modify files.');
  expect((await agentCalls(page)).some((call) => call.command === 'agent_terminal_start')).toBe(false);
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await expect(page.getByRole('log')).not.toContainText('Fixture chat reply');
  await expect(composer).toBeFocused();
  await composer.fill('A fresh question');
  await page.getByRole('button', { name: 'Send to Codex', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Fixture chat reply');
  const runs = (await agentCalls(page)).filter((call) => call.command === 'ai_cli_run');
  expect(runs[1].args.options.sessionId).not.toBe(run.args.options.sessionId);
  expect(runs[1].args.prompt).not.toContain('Summarize the attached note');
});

test('follow-ups and agent switching keep the conversation, while closing the panel leaves it intact', async ({ page }) => {
  await openChat(page);
  await page.getByRole('combobox', { name: 'Agent access', exact: true }).selectOption('workspace-write');
  await page.getByRole('textbox', { name: 'Message Codex', exact: true }).fill('First question');
  await page.getByRole('button', { name: 'Send to Codex', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Fixture chat reply');
  await choose(page, 'Pi');
  await expect(page.getByRole('textbox', { name: 'Message Pi', exact: true })).toBeVisible();
  await choose(page, 'Codex');
  await expect(page.getByRole('combobox', { name: 'Agent access', exact: true })).toHaveValue('workspace-write');
  await expect(page.getByRole('log')).toContainText('First question');
  await page.getByRole('button', { name: 'Close AI sidebar', exact: true }).first().click();
  await page.getByRole('button', { name: 'Open AI sidebar', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message Codex', exact: true }).fill('Follow-up question');
  await page.getByRole('button', { name: 'Send to Codex', exact: true }).click();
  await expect(page.getByRole('log').getByText('Fixture chat reply', { exact: true })).toHaveCount(2);
  const runs = (await agentCalls(page)).filter((call) => call.command === 'ai_cli_run');
  expect(runs[1].args.options.sessionId).toBe(runs[0].args.options.sessionId);
  expect(runs[1].args.prompt).toContain('First question');
  expect(runs[1].args.prompt).toContain('Fixture chat reply');
  expect(runs[1].args.prompt).toContain('Follow-up question');
});

test('streaming, stopping, and restarting ignore late output from a previous session', async ({ page }) => {
  await openChat(page);
  await page.evaluate(() => { (window as any).__agentHoldChat = true; });
  const composer = page.getByRole('textbox', { name: 'Message Codex', exact: true });
  await composer.fill('Old question');
  await page.getByRole('button', { name: 'Send to Codex', exact: true }).click();
  await expect.poll(async () => (await agentCalls(page)).filter((call) => call.command === 'ai_cli_run').length).toBe(1);
  const old = (await agentCalls(page)).find((call) => call.command === 'ai_cli_run')!.args.requestId;
  await page.evaluate((id) => (window as any).__agentChatChunk(id, 'Partial answer'), old);
  await expect(page.getByRole('log')).toContainText('Partial answer');
  await page.getByRole('button', { name: 'Stop generating', exact: true }).click();
  await expect.poll(async () => (await agentCalls(page)).some((call) => call.command === 'ai_cli_cancel' && call.args.requestId === old)).toBe(true);
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await expect(composer).toBeFocused();
  await page.evaluate(() => { (window as any).__agentHoldChat = false; });
  await composer.fill('New question');
  await page.getByRole('button', { name: 'Send to Codex', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Fixture chat reply');
  await page.evaluate((id) => (window as any).__agentCompleteChat(id, 'Late stale answer'), old);
  await expect.poll(async () => (await agentCalls(page)).filter((call) => call.command === 'plugin:event|unlisten').length).toBe(2);
  await expect(page.getByRole('log')).not.toContainText('Late stale answer');
  await expect(page.getByRole('log')).not.toContainText('Partial answer');
  await expect(page.getByRole('button', { name: 'Send to Codex', exact: true })).toBeDisabled();
});

test('composer controls and transcript fit a mobile viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page);
  await expect.poll(async () => page.getByTestId('agent-chat').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(page.getByRole('combobox', { name: 'Agent access', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send to Codex', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('agent-chat-mobile.png') });
  await page.getByRole('textbox', { name: 'Message Codex', exact: true }).fill('Hello on mobile');
  await page.getByRole('button', { name: 'Send to Codex', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Fixture chat reply');
});
