import { test, expect, type Page } from '@playwright/test';
import { openAgentWorkspace, installAgentFixture, agentCalls } from './agent-fixture';

const insert = (text: string) => ({ type: 'editor_action', action: 'insertText', description: 'Add a paragraph', data: { text } });
const editor = (page: Page) => page.locator('[data-note-editor="agent-note"] .bn-editor');

async function openChat(page: Page) {
  await openAgentWorkspace(page);
  await installAgentFixture(page);
  await page.getByRole('button', { name: 'Open AI sidebar', exact: true }).click();
  await expect.poll(async () => (await agentCalls(page)).some((call) => call.command === 'ai_cli_detect')).toBe(true);
  await page.getByRole('button', { name: /^Choose chat model/ }).click();
  await page.getByRole('menuitemradio', { name: 'Codex CLI: Fixture Model', exact: true }).click();
}

async function mode(page: Page, name: 'Supervised' | 'Auto-accept edits') {
  await page.getByRole('button', { name: /^Edit approval mode:/ }).click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${name}`) }).click();
}

async function send(page: Page, reply: unknown) {
  await page.evaluate((text) => { (window as any).__agentChatReply = text; }, JSON.stringify(reply));
  await page.getByRole('textbox', { name: 'Message Logia', exact: true }).fill('Please edit this note');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop generating', exact: true })).toHaveCount(0);
}

test('Supervised keeps approval and refusal; changing modes leaves previous suggestions pending', async ({ page }) => {
  await openChat(page);
  await expect(page.getByRole('button', { name: 'Edit approval mode: Supervised', exact: true })).toBeVisible();
  await send(page, insert('Manually accepted paragraph'));
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  await expect(editor(page)).not.toContainText('Manually accepted paragraph');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(editor(page)).toContainText('Manually accepted paragraph');
  await expect(page.getByText('1 Change Applied', { exact: true })).toBeVisible();
  await send(page, insert('Rejected paragraph'));
  await mode(page, 'Auto-accept edits');
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Refuse', exact: true }).click();
  await expect(editor(page)).not.toContainText('Rejected paragraph');
});

test('auto-accept applies a whole reply once and persists across reload, with a keyboard dropdown on mobile', async ({ page }, testInfo) => {
  await openChat(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /^Edit approval mode:/ }).click();
  await page.getByRole('menuitemradio', { name: /^Supervised/ }).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Edit approval mode: Auto-accept edits', exact: true })).toBeVisible();
  await send(page, [insert('First automatic paragraph'), insert('Second automatic paragraph with { braces }')]);
  await expect(page.getByText('2 Changes Applied', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Approve/ })).toHaveCount(0);
  await expect(editor(page)).toContainText('Second automatic paragraph with { braces }');
  await page.getByRole('button', { name: 'Close AI sidebar', exact: true }).first().click();
  await page.getByRole('button', { name: 'Open AI sidebar', exact: true }).click();
  await expect(editor(page).getByText('First automatic paragraph', { exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: /^Edit approval mode:/ }).click();
  await page.screenshot({ path: testInfo.outputPath('edit-approval-mobile.png') });
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('list', { name: 'Notes', exact: true }).getByRole('button', { name: /^Agent collaboration / }).click();
  await installAgentFixture(page);
  await page.getByRole('button', { name: 'Open AI sidebar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit approval mode: Auto-accept edits', exact: true })).toBeVisible();
  await mode(page, 'Supervised');
  await send(page, insert('Supervised again'));
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  await expect(editor(page)).not.toContainText('Supervised again');
});

test('a failed batch reports partial progress and retries only remaining edits after remount', async ({ page }) => {
  await openChat(page);
  await mode(page, 'Auto-accept edits');
  const missing = { type: 'editor_action', action: 'update', description: 'Update missing target', data: { searchText: 'Repair target', newContent: 'Repaired paragraph' } };
  await send(page, [insert('Applied exactly once'), missing]);
  await expect(page.getByRole('alert')).toContainText('1/2 changes applied');
  await expect(page.getByText('2 Changes Applied', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close AI sidebar', exact: true }).first().click();
  await page.getByRole('button', { name: 'Open AI sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Approve remaining (1)', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('1/2 changes applied');
  await expect(editor(page).getByText('Applied exactly once', { exact: true })).toHaveCount(1);
  await editor(page).locator('.bn-block-content').last().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Repair target');
  await page.getByRole('button', { name: 'Approve remaining (1)', exact: true }).click();
  await expect(page.getByText('2 Changes Applied', { exact: true })).toBeVisible();
  await expect(editor(page)).toContainText('Repaired paragraph');
  await expect(editor(page).getByText('Applied exactly once', { exact: true })).toHaveCount(1);
});

test('a late response cannot auto-edit a different note, and returning does not replay it', async ({ page }) => {
  await openChat(page);
  await mode(page, 'Auto-accept edits');
  await page.evaluate(() => { (window as any).__agentHoldChat = true; });
  await page.getByRole('textbox', { name: 'Message Logia', exact: true }).fill('Delayed edit');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(async () => (await agentCalls(page)).some((call) => call.command === 'ai_cli_run')).toBe(true);
  const requestId = (await agentCalls(page)).find((call) => call.command === 'ai_cli_run')!.args.requestId;
  await page.evaluate(async () => {
    const { useNotesStore } = await import('/src/store/notesStore.ts');
    await useNotesStore.getState().createNote('text', undefined, { title: 'Another note' });
  });
  await expect(editor(page)).toHaveCount(0);
  await page.evaluate(({ requestId, reply }) => (window as any).__agentCompleteChat(requestId, reply), { requestId, reply: JSON.stringify(insert('Belongs to original note')) });
  await expect(page.getByRole('button', { name: 'Stop generating', exact: true })).toHaveCount(0);
  await expect(page.locator('.bn-editor')).not.toContainText('Belongs to original note');
  await page.getByText('Agent collaboration', { exact: true }).first().click();
  await expect(page.getByRole('alert')).toContainText('Open the original note');
  await expect(editor(page)).not.toContainText('Belongs to original note');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(editor(page)).toContainText('Belongs to original note');
});

test('switching back to Supervised while a reply loads prevents auto-approval', async ({ page }) => {
  await openChat(page);
  await mode(page, 'Auto-accept edits');
  await page.evaluate(() => { (window as any).__agentHoldChat = true; });
  await page.getByRole('textbox', { name: 'Message Logia', exact: true }).fill('Delayed edit');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(async () => (await agentCalls(page)).some((call) => call.command === 'ai_cli_run')).toBe(true);
  await mode(page, 'Supervised');
  const requestId = (await agentCalls(page)).find((call) => call.command === 'ai_cli_run')!.args.requestId;
  await page.evaluate(({ requestId, reply }) => (window as any).__agentCompleteChat(requestId, reply), { requestId, reply: JSON.stringify(insert('Wait for approval')) });
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  await expect(editor(page)).not.toContainText('Wait for approval');
});

test('stopping a reply leaves complete streamed edits for manual approval', async ({ page }) => {
  await openChat(page);
  await mode(page, 'Auto-accept edits');
  await page.evaluate(() => { (window as any).__agentHoldChat = true; });
  await page.getByRole('textbox', { name: 'Message Logia', exact: true }).fill('An interrupted edit');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(async () => (await agentCalls(page)).some((call) => call.command === 'ai_cli_run')).toBe(true);
  const requestId = (await agentCalls(page)).find((call) => call.command === 'ai_cli_run')!.args.requestId;
  const reply = JSON.stringify(insert('Interrupted addition'));
  await page.evaluate(({ requestId, reply }) => (window as any).__agentChatChunk(requestId, reply), { requestId, reply });
  await page.getByRole('button', { name: 'Stop generating', exact: true }).click();
  await expect.poll(async () => (await agentCalls(page)).some((call) => call.command === 'ai_cli_cancel')).toBe(true);
  await page.evaluate(({ requestId, reply }) => (window as any).__agentCompleteChat(requestId, reply), { requestId, reply });
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  await expect(editor(page)).not.toContainText('Interrupted addition');
});
