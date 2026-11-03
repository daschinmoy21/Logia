import { test, expect, type Page } from '@playwright/test';
import { openAgentWorkspace, installAgentFixture, agentCalls } from './agent-fixture';

async function choose(page: Page, name: string) {
  await page.getByRole('button', { name: /^Choose agent\. Current:/ }).click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${name}( |$)`) }).click();
  await page.getByRole('button', { name: 'Open agent terminal', exact: true }).click();
}

async function openPanel(page: Page) {
  await page.getByRole('button', { name: 'Open AI sidebar', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Choose agent\. Current:/ })).toBeVisible();
}

test('external agent chooser is honest about browser capability and never starts automatically', async ({ page }) => {
  await openAgentWorkspace(page);
  await openPanel(page);
  for (const name of ['Codex', 'Claude Code', 'Pi', 'OpenCode']) {
    await choose(page, name);
    await expect(page.getByTestId('agent-availability')).toHaveText('Desktop only');
    await expect(page.getByRole('button', { name: 'Start session', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
  }
});

test('composer Vim edits its draft and keeps Escape away from the note editor', async ({ page }) => {
  await openAgentWorkspace(page);
  await openPanel(page);
  const composer = page.getByRole('textbox', { name: 'Message Logia', exact: true });
  await page.getByRole('button', { name: 'Enable vim mode', exact: true }).click();
  await composer.fill('alpha beta\nsecond line');
  await composer.press('Escape');
  await expect(composer).toBeFocused();
  await expect(page.getByTestId('composer-vim-mode')).toContainText('NORMAL');
  await composer.press('g'); await composer.press('g'); await composer.press('0');
  await composer.press('d'); await composer.press('w');
  await expect(composer).toHaveValue('beta\nsecond line');
  await composer.press('u');
  await expect(composer).toHaveValue('alpha beta\nsecond line');
  await composer.press('A');
  await expect(page.getByTestId('composer-vim-mode')).toContainText('INSERT');
  await composer.press('Shift+Enter');
  await expect(composer).toHaveValue('alpha beta\n\nsecond line');
  await expect(page.locator('[data-note-editor="agent-note"]')).toContainText('Keep notes local.');
});

test('interactive session streams early output, attaches only an explicit snapshot, keeps sessions on hide, and stops', async ({ page }) => {
  await openAgentWorkspace(page);
  await installAgentFixture(page);
  await openPanel(page);
  await choose(page, 'Codex');
  await expect(page.getByTestId('agent-availability')).toHaveText('Installed');
  expect((await agentCalls(page)).filter(c => c.command === 'agent_terminal_start')).toHaveLength(0);
  await page.getByRole('checkbox', { name: /snapshot|attach/i }).check();
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Prompt for Codex', exact: true })).toBeVisible();
  await expect(page.getByText('Codex · Running', { exact: true })).toBeVisible();
  const start = (await agentCalls(page)).find(c => c.command === 'agent_terminal_start')!;
  expect(start.args.options.login).toBe(false);
  expect(start.args.options.context.markdown).toContain('Keep notes local.');
  await expect(page.getByTestId('agent-terminal').locator('.xterm')).toBeVisible();
  await page.getByRole('textbox', { name: 'Prompt for Codex' }).fill('Read note-context.md');
  await page.getByRole('button', { name: 'Send to Codex', exact: true }).click();
  await expect.poll(async () => (await agentCalls(page)).filter(c => c.command === 'agent_terminal_write').length).toBeGreaterThan(0);
  expect((await agentCalls(page)).filter(c => c.command === 'agent_terminal_write').map(c => c.args.data).join('')).toContain('Read note-context.md');
  await page.getByRole('button', { name: 'Close AI sidebar', exact: true }).first().click();
  await openPanel(page);
  await expect(page.getByRole('textbox', { name: 'Prompt for Codex' })).toBeVisible();
  expect((await agentCalls(page)).filter(c => c.command === 'agent_terminal_start')).toHaveLength(1);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New session', exact: true })).toBeVisible();
  expect((await agentCalls(page)).filter(c => c.command === 'agent_terminal_close')).toHaveLength(1);
});

test('login launches explicitly without attaching note context, and startup failures remain recoverable', async ({ page }) => {
  await openAgentWorkspace(page);
  await installAgentFixture(page);
  await openPanel(page);
  await choose(page, 'Claude Code');
  await page.getByRole('checkbox', { name: /snapshot|attach/i }).check();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Claude Code · Sign-in running', { exact: true })).toBeVisible();
  const start = (await agentCalls(page)).find(c => c.command === 'agent_terminal_start')!;
  expect(start.args.options.login).toBe(true);
  expect(start.args.options.context).toBeUndefined();
  await expect(page.getByRole('textbox', { name: 'Prompt for Claude Code' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.evaluate(() => { (window as any).__agentFailStart = true; });
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('executable could not be started');
  await expect(page.getByRole('button', { name: 'Start session', exact: true })).toBeEnabled();
});


test('agent menu owns keyboard navigation even with note Vim enabled', async ({ page }) => {
  await openAgentWorkspace(page);
  await page.getByRole('button', { name: 'Enable vim mode', exact: true }).click();
  await openPanel(page);
  const chooser = page.getByRole('button', { name: /^Choose agent\. Current:/ });
  await chooser.click();
  const logia = page.getByRole('menuitemradio', { name: 'Logia', exact: true });
  await expect(logia).toBeFocused();
  await logia.press('j');
  const codex = page.getByRole('menuitemradio', { name: /^Codex / });
  await expect(codex).toBeFocused();
  await codex.press('Escape');
  await expect(page.getByRole('menu', { name: 'Agents', exact: true })).toHaveCount(0);
  await expect(chooser).toBeFocused();
});

test('raw terminal keys reach the CLI and Stop during spawn closes the eventual process', async ({ page }) => {
  await openAgentWorkspace(page);
  await installAgentFixture(page);
  await page.getByRole('button', { name: 'Enable vim mode', exact: true }).click();
  await openPanel(page);
  await choose(page, 'Pi');
  await page.evaluate(() => { (window as any).__agentStartDelay = 1200; });
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await expect(page.locator('.xterm-helper-textarea')).toBeAttached();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect.poll(async () => (await agentCalls(page)).filter(c => c.command === 'agent_terminal_close').length).toBe(1);
  await page.evaluate(() => { (window as any).__agentStartDelay = 25; });
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Prompt for Pi', exact: true })).toBeVisible();
  const input = page.locator('.xterm-helper-textarea');
  await input.focus();
  await input.press('Control+p');
  await input.press('Escape');
  await expect.poll(async () => (await agentCalls(page)).filter(c => c.command === 'agent_terminal_write').map(c => c.args.data).join('')).toContain('\u0010');
  await expect(input).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await input.press('Control+h');
  await expect.poll(async () => page.evaluate(() => !!document.activeElement?.closest('[data-note-editor]'))).toBe(true);
});

test('pane shortcuts move between tree, editor and agent composer with Vim off', async ({ page }) => {
  await openAgentWorkspace(page);
  const editor = page.locator('[data-note-editor="agent-note"] [contenteditable="true"]').first();
  await editor.focus();
  await page.keyboard.press('Control+h');
  await expect.poll(async () => page.evaluate(() => !!document.activeElement?.closest('[data-tree-id]'))).toBe(true);
  await page.keyboard.press('Control+l');
  await expect.poll(async () => page.evaluate(() => !!document.activeElement?.closest('[data-note-editor]'))).toBe(true);
  await page.keyboard.press('Control+l');
  await expect(page.getByRole('textbox', { name: 'Message Logia', exact: true })).toBeFocused();
  await page.keyboard.press('Control+h');
  await expect.poll(async () => page.evaluate(() => !!document.activeElement?.closest('[data-note-editor]'))).toBe(true);
  await page.keyboard.press('Control+j');
  await expect(page.getByRole('textbox', { name: 'Message Logia', exact: true })).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect.poll(async () => page.evaluate(() => !!document.activeElement?.closest('[data-note-editor]'))).toBe(true);
});


test('early channel errors and failed writes close their native processes', async ({ page }) => {
  await openAgentWorkspace(page);
  await installAgentFixture(page);
  await openPanel(page);
  await choose(page, 'OpenCode');
  await page.evaluate(() => { (window as any).__agentEarlyError = true; });
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('early channel error');
  await expect.poll(async () => (await agentCalls(page)).filter(c => c.command === 'agent_terminal_close').length).toBe(1);
  await page.evaluate(() => { (window as any).__agentEarlyError = false; (window as any).__agentFailWrite = true; });
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Prompt for OpenCode', exact: true });
  await expect(composer).toBeVisible();
  await composer.fill('hello');
  await page.getByRole('button', { name: 'Send to OpenCode', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('broken terminal input');
  await expect.poll(async () => (await agentCalls(page)).filter(c => c.command === 'agent_terminal_close').length).toBe(2);
});


for (const variant of ['Vim on', 'mobile'] as const) {
  test(`pane navigation reveals hidden panes and returns to the editor (${variant})`, async ({ page }) => {
    if (variant === 'mobile') await page.setViewportSize({ width: 390, height: 844 });
    await openAgentWorkspace(page);
    if (variant === 'Vim on') await page.getByRole('button', { name: 'Enable vim mode', exact: true }).click();
    await page.locator('[data-note-editor="agent-note"] [contenteditable="true"]').first().focus();
    await page.keyboard.press('Control+h');
    await expect.poll(async () => page.evaluate(() => !!document.activeElement?.closest('[data-tree-id]'))).toBe(true);
    await page.keyboard.press('Control+l');
    await expect.poll(async () => page.evaluate(() => !!document.activeElement?.closest('[data-note-editor]'))).toBe(true);
    await page.keyboard.press('Control+l');
    await expect(page.getByRole('textbox', { name: 'Message Logia', exact: true })).toBeFocused();
    await page.keyboard.press('Control+h');
    await expect.poll(async () => page.evaluate(() => !!document.activeElement?.closest('[data-note-editor]'))).toBe(true);
  });
}


test('running terminal fits after a desktop-to-mobile resize', async ({ page }) => {
  await openAgentWorkspace(page);
  await installAgentFixture(page);
  await openPanel(page);
  await choose(page, 'Codex');
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Prompt for Codex' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => page.getByTestId('agent-terminal').evaluate(el => {
    const rect = el.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.width <= innerWidth;
  })).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Prompt for Codex' })).toBeVisible();
  expect((await agentCalls(page)).filter(c => c.command === 'agent_terminal_start')).toHaveLength(1);
});
