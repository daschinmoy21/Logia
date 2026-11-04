import { test, expect, type Page } from '@playwright/test';
import { openAgentWorkspace, installAgentFixture, agentCalls } from './agent-fixture';

async function openGrok(page: Page) {
  await openAgentWorkspace(page);
  await installAgentFixture(page);
  await page.evaluate(() => { (window as any).__agentInstalledTools = ['codex', 'grok']; });
  await page.getByRole('button', { name: 'Open AI sidebar', exact: true }).click();
  await page.getByRole('button', { name: /^Choose agent\. Current:/ }).click();
  await page.getByRole('menuitemradio', { name: /^Grok Build( |$)/ }).click();
}

test('Grok Build chats through the CLI with its own icon and a custom model ID', async ({ page }) => {
  await openGrok(page);
  await page.evaluate(() => { (window as any).__agentModelError = true; });
  await page.getByRole('button', { name: /^Choose model for Grok Build/ }).click();
  await page.getByRole('button', { name: 'Use a custom model ID' }).click();
  const custom = page.getByRole('textbox', { name: 'Custom model ID', exact: true });
  await custom.fill('grok-custom-id');
  await custom.press('Enter');
  const composer = page.getByRole('textbox', { name: 'Message Grok Build', exact: true });
  await composer.fill('Hello Grok');
  await page.getByRole('button', { name: 'Send to Grok Build', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Fixture chat reply');
  const run = (await agentCalls(page)).find((call) => call.command === 'ai_cli_run')!;
  expect(run.args.tool).toBe('grok');
  expect(run.args.model).toBe('grok-custom-id');
  await expect.poll(async () => page.getByTestId('agent-chat').locator('img').first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
});

test('Grok Build starts a terminal session and signs in only when asked', async ({ page }) => {
  await openGrok(page);
  await page.getByRole('button', { name: 'Open agent terminal', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  expect((await agentCalls(page)).filter((call) => call.command === 'agent_terminal_start')).toHaveLength(0);
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await expect(page.getByText('Grok Build · Running', { exact: true })).toBeVisible();
  const start = (await agentCalls(page)).find((call) => call.command === 'agent_terminal_start')!;
  expect(start.args.options.tool).toBe('grok');
  expect(start.args.options.login).toBe(false);
});
