import { test, expect } from '@playwright/test';
import { openAgentWorkspace, installAgentFixture, agentCalls } from './agent-fixture';

test('chat discovers CLI models, sends the selected model, and shares it with terminal sessions', async ({ page }) => {
  await openAgentWorkspace(page);
  await installAgentFixture(page);
  await page.getByRole('button', { name: 'Open AI sidebar', exact: true }).click();
  await expect.poll(async () => (await agentCalls(page)).some((c) => c.command === 'ai_cli_detect')).toBe(true);
  await page.getByRole('button', { name: /^Choose chat model/ }).click();
  await page.getByRole('radio', { name: 'Codex CLI: Fixture Model', exact: true }).check();
  await expect(page.getByRole('radio', { name: 'Codex CLI: Fixture Model', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Close model settings' }).click();
  await page.getByRole('textbox', { name: 'Message Logia', exact: true }).fill('hello');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Fixture chat reply', { exact: true })).toBeVisible();
  expect((await agentCalls(page)).find((c) => c.command === 'ai_cli_run')?.args.model).toBe('fixture-model');
  await page.getByRole('button', { name: /^Choose agent\. Current:/ }).click();
  await page.getByRole('menuitemradio', { name: /^Codex / }).click();
  await page.getByRole('button', { name: 'Open agent terminal', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Choose model for Codex CLI/ })).toContainText('fixture-model');
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Prompt for Codex' })).toBeVisible();
  expect((await agentCalls(page)).find((c) => c.command === 'agent_terminal_start')?.args.options.model).toBe('fixture-model');
  const input = page.locator('.xterm-helper-textarea');
  await input.focus();
  // Tauri's core API checks this flag; the terminal fixture uses the IPC object.
  await page.evaluate(() => { (window as any).isTauri = true; });
  await input.press('Control+=');
  await expect.poll(async () => (await agentCalls(page)).filter((c) => c.command === 'plugin:webview|set_webview_zoom').at(-1)?.args.value).toBe(1.1);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await expect.poll(async () => (await agentCalls(page)).filter((c) => c.command === 'agent_terminal_start').length).toBe(2);
  expect((await agentCalls(page)).filter((c) => c.command === 'agent_terminal_start')[1].args.options.model).toBe('fixture-model');
});

test('failed discovery allows custom model IDs and remembers them across reload', async ({ page }) => {
  await openAgentWorkspace(page);
  await installAgentFixture(page);
  await page.evaluate(() => { (window as any).__agentModelError = true; });
  await page.getByRole('button', { name: 'Open AI sidebar', exact: true }).click();
  await page.getByRole('button', { name: /^Choose agent\. Current:/ }).click();
  await page.getByRole('menuitemradio', { name: /^OpenCode / }).click();
  await page.getByRole('button', { name: /^Choose model for OpenCode/ }).click();
  await expect(page.getByText('Fixture: model discovery unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await page.getByRole('button', { name: 'Use a custom model ID' }).click();
  const query = page.getByRole('textbox', { name: 'Custom model ID', exact: true });
  await query.fill('my-provider/my-model');
  await query.press('Enter');
  await page.reload();
  await page.getByRole('button', { name: 'Open AI sidebar', exact: true }).click();
  await page.getByRole('button', { name: /^Choose agent\. Current:/ }).click();
  await page.getByRole('menuitemradio', { name: /^OpenCode / }).click();
  await expect(page.getByRole('button', { name: /^Choose model for OpenCode/ })).toContainText('my-provider/my-model');
});

test('UI scaling works while editing, in Vim explorer and settings, persists, and resets', async ({ page }) => {
  await openAgentWorkspace(page);
  await page.locator('[data-note-editor="agent-note"] [contenteditable="true"]').first().focus();
  await page.keyboard.press('Control+=');
  const scale = () => page.evaluate(() => Number(getComputedStyle(document.documentElement).zoom));
  await expect.poll(scale).toBe(1.1);
  await expect.poll(async () => page.locator('#root').evaluate((el) => Math.round(el.getBoundingClientRect().bottom))).toBe(1000);
  await page.keyboard.press('Control++');
  await expect.poll(scale).toBe(1.2);
  await page.reload();
  await expect.poll(scale).toBe(1.2);
  await page.getByRole('button', { name: 'Enable vim mode', exact: true }).click();
  await page.keyboard.press('Control+h');
  await page.keyboard.press('Control+-');
  await expect.poll(scale).toBe(1.1);
  await page.keyboard.press('Control+0');
  await expect.poll(scale).toBe(1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.keyboard.press('Meta+=');
  await expect.poll(scale).toBe(1.1);
  await page.keyboard.press('Meta+0');
  await expect.poll(scale).toBe(1);
});

test('provider settings use a focused list and add flow on desktop and mobile', async ({ page }) => {
  await openAgentWorkspace(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add provider', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Codex CLI', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add provider', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search providers' }).fill('codex');
  await page.getByRole('button', { name: 'Codex CLI', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Codex CLI', exact: true })).toBeVisible();
  await expect(page.getByText('CLI detection is available in the desktop app.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use this provider', exact: true }).click();
  await page.getByRole('button', { name: /^Choose model for Codex CLI/ }).click();
  await page.getByRole('button', { name: 'Use a custom model ID' }).click();
  const query = page.getByRole('textbox', { name: 'Custom model ID' });
  await query.fill('custom-settings-model');
  await query.press('Enter');
  await expect(page.getByRole('button', { name: /^Choose model for Codex CLI/ })).toContainText('custom-settings-model');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Add provider', exact: true })).toBeVisible();
  await expect.poll(async () => page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('grouped model settings refresh catalogs, filter favorites, and fit a mobile screen', async ({ page }) => {
  await openAgentWorkspace(page);
  await installAgentFixture(page);
  await page.getByRole('button', { name: 'Open AI sidebar', exact: true }).click();
  await expect.poll(async () => (await agentCalls(page)).some((c) => c.command === 'ai_cli_detect')).toBe(true);
  await page.getByRole('button', { name: /^Choose chat model/ }).click();
  const codex = page.getByRole('region', { name: 'Codex CLI models', exact: true });
  await expect(codex.getByRole('radio', { name: 'Codex CLI: Fixture Model', exact: true })).toBeVisible();
  await codex.getByRole('button', { name: 'Favorite Codex CLI: Second Model', exact: true }).click();
  await page.getByRole('button', { name: 'Show favorite models' }).click();
  await expect(page.getByRole('radio')).toHaveCount(1);
  await expect(page.getByRole('radio', { name: 'Codex CLI: Second Model', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__agentModels = { codex: [
    { id: 'new-live-id', label: 'Newly available model', isDefault: true },
    { id: 'provider/second-model', label: 'Second Model' },
  ] }; });
  await page.getByRole('button', { name: 'Show favorite models' }).click();
  await page.getByRole('button', { name: 'Refresh models', exact: true }).click();
  await expect(codex.getByRole('radio', { name: 'Codex CLI: Newly available model', exact: true })).toBeVisible();
  await expect(codex.getByRole('radio', { name: 'Codex CLI: Fixture Model', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Find a model' }).fill('Newly available');
  await expect(page.getByRole('radio')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => page.getByRole('dialog').evaluate((el) => {
    const panel = el.querySelector('[id^="headlessui-dialog-panel"]')!;
    const box = panel.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight && panel.scrollWidth <= panel.clientWidth;
  })).toBe(true);
  await expect.poll(async () => page.getByRole('dialog').locator('img').evaluateAll((imgs) => imgs.every((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0))).toBe(true);
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('logia-settings')!).state.favoriteModels.codex)).toContain('provider/second-model');
});

test('API model settings display refreshed server results without a static fallback', async ({ page }) => {
  let generation = 1;
  await page.route('**/catalog/v1/models', (route) => route.fulfill({ json: { data: [
    { id: `server-${generation}`, name: `Server model ${generation}`, is_default: true },
  ] } }));
  await page.addInitScript(() => localStorage.setItem('logia-settings', JSON.stringify({ version: 1, state: {
    activeProvider: 'custom', addedProviders: ['custom'], baseUrls: { custom: 'http://127.0.0.1:3420/catalog/v1' },
  } })));
  await openAgentWorkspace(page);
  await page.getByRole('button', { name: 'Open AI sidebar', exact: true }).click();
  await page.getByRole('button', { name: /^Choose chat model/ }).click();
  await expect(page.getByRole('radio', { name: /Server model 1$/ })).toBeVisible();
  generation = 2;
  await page.getByRole('button', { name: 'Refresh models', exact: true }).click();
  await expect(page.getByRole('radio', { name: /Server model 2$/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Server model 1$/ })).toHaveCount(0);
  await page.route('**/catalog/v1/models', (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.getByRole('button', { name: 'Refresh models', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('HTTP 503');
  await expect(page.getByRole('radio')).toHaveCount(0);
});
