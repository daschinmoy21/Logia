import { test, expect, type Page } from '@playwright/test';

const storageKey = 'logia.browser-workspace.v1';
const block = (id: string, type: string, content: string, level = 1) => ({ id, type, content, props: type === 'heading' ? { level } : {}, children: [] });
const now = '2026-11-02T12:00:00.000Z';
const records = [
  { id: 'plan', title: 'Research plan', starred: true, content: JSON.stringify([block('plan-title', 'heading', 'Research plan'), block('plan-body', 'paragraph', '#research Investigate local-first tools. [[Source#Details|reference]] [[New idea]]'), block('plan-next', 'heading', 'Next steps', 2), block('plan-task', 'paragraph', 'Run the comparison.')]) },
  { id: 'source', title: 'Source', content: JSON.stringify([block('source-title', 'heading', 'Source'), block('source-detail', 'heading', 'Details', 2), block('source-body', 'paragraph', 'Evidence about offline notes.')]) },
  { id: 'canvas', title: 'Concept map', note_type: 'canvas', content: '{}' },
].map((note) => ({ note_type: 'text', starred: false, created_at: now, updated_at: now, ...note }));

async function seed(page: Page, notes = records) {
  await page.addInitScript(({ key, notes }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ notes, folders: [] }));
  }, { key: storageKey, notes });
  await page.goto('/');
  await expect(page.getByRole('list', { name: 'Notes', exact: true })).toBeVisible();
}

const homeRows = (page: Page) => page.getByRole('list', { name: 'Notes', exact: true }).locator('[data-note-row]');
const openHomeNote = (page: Page, title: string) => homeRows(page).filter({ hasText: title }).click();
async function readStored(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), storageKey);
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => console.log('Browser exception:', error.message));
});

test('home searches human text and combines type, star, tag and sort controls', async ({ page }) => {
  await seed(page);
  await expect(homeRows(page)).toHaveCount(3);
  await page.getByRole('searchbox', { name: 'Search notes' }).fill('offline');
  await expect(homeRows(page)).toHaveCount(1);
  await expect(homeRows(page)).toContainText('Source');
  await page.getByRole('searchbox', { name: 'Search notes' }).fill('');
  await page.getByRole('group', { name: 'Filter by type' }).getByRole('button', { name: /Starred/ }).click();
  await expect(homeRows(page)).toHaveCount(1);
  await expect(homeRows(page)).toContainText('Research plan');
  await page.getByRole('group', { name: 'Filter by type' }).getByRole('button', { name: /All/ }).click();
  await page.getByRole('group', { name: 'Filter by tag' }).getByRole('button', { name: /#research/ }).click();
  await expect(homeRows(page)).toHaveCount(1);
  await page.getByRole('group', { name: 'Filter by tag' }).getByRole('button', { name: /#research/ }).click();
  await page.getByRole('combobox', { name: 'Sort' }).selectOption('title');
  await expect(homeRows(page).first()).toContainText('Concept map');
  await page.getByRole('searchbox', { name: 'Search notes' }).fill('no-such-note');
  await expect(page.getByText('Nothing found for “no-such-note”')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search and filters' }).click();
  await expect(homeRows(page)).toHaveCount(3);
});

test('keyboard palette opens notes and command mode creates only one daily note', async ({ page }) => {
  await seed(page);
  await page.keyboard.press('Control+p');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole('combobox');
  await input.fill('offline');
  await input.press('Enter');
  await expect(page.locator('[data-note-editor="source"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+p');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox').fill('>today');
  await dialog.getByRole('combobox').press('Enter');
  await expect(page.locator('[data-note-editor]')).toBeVisible();
  await expect.poll(async () => (await readStored(page)).notes.filter((note: { title: string }) => /^\d{4}-\d{2}-\d{2}$/.test(note.title)).length).toBe(1);
  await page.keyboard.press('Control+Shift+d');
  await expect.poll(async () => (await readStored(page)).notes.filter((note: { title: string }) => /^\d{4}-\d{2}-\d{2}$/.test(note.title)).length).toBe(1);
});

test('outline, outgoing links, heading targets, backlinks and unresolved note creation work', async ({ page }) => {
  await seed(page);
  await openHomeNote(page, 'Research plan');
  const panel = page.getByRole('complementary', { name: 'Note context' });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Next steps', exact: true }).click();
  await expect(page.locator('.bn-block-content[data-content-type="heading"]').filter({ hasText: 'Next steps' })).toBeVisible();
  await panel.getByRole('button', { name: /reference/ }).click();
  await expect(page.locator('[data-note-editor="source"]')).toBeVisible();
  await expect(panel.locator('#note-context-backlinks')).toContainText('Research plan');
  await panel.locator('#note-context-backlinks').getByRole('button', { name: /^Research plan/ }).click();
  await expect(page.locator('[data-note-editor="plan"]')).toBeVisible();
  await panel.getByRole('button', { name: 'Create note New idea', exact: true }).click();
  await expect.poll(async () => (await readStored(page)).notes.some((note: { title: string }) => note.title === 'New idea')).toBe(true);
});

test('Markdown import keeps YAML metadata and export works in a browser', async ({ page }) => {
  await seed(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await (await chooser).setFiles({ name: 'Imported.md', mimeType: 'text/markdown', buffer: Buffer.from('---\ntags: [migration]\naliases: [Incoming]\n---\n# Imported\n\n## Details\n\nA portable note with [[Source]].\n') });
  await expect(page.getByText('Imported 1 note', { exact: true })).toBeVisible();
  await expect(page.locator('[data-note-editor] .bn-editor')).toContainText('A portable note');
  await expect(page.getByRole('complementary', { name: 'Note context' })).toContainText('#migration');
  await page.getByRole('button', { name: /Export/ }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Markdown (.md)', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('Imported.md');
  await page.reload();
  await expect(homeRows(page).filter({ hasText: 'Imported' })).toBeVisible();
});

test('last keystrokes survive an immediate note switch and reload', async ({ page }) => {
  await seed(page);
  await openHomeNote(page, 'Research plan');
  const editor = page.locator('.bn-editor[contenteditable="true"]');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(' immediate-save-proof');
  // Deliberately navigate before the old 500ms editor debounce could fire.
  await page.keyboard.press('Control+p');
  await page.getByRole('dialog').getByRole('combobox').fill('Source');
  await page.getByRole('dialog').getByRole('combobox').press('Enter');
  await expect(page.locator('[data-note-editor="source"]')).toBeVisible();
  await expect.poll(async () => (await readStored(page)).notes.find((note: { id: string }) => note.id === 'plan').content).toContain('immediate-save-proof');
  await page.reload();
  await page.getByRole('searchbox', { name: 'Search notes' }).fill('immediate-save-proof');
  await expect(homeRows(page)).toHaveCount(1);
});

test('narrow screens keep home and note context within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await expect(homeRows(page)).toHaveCount(3);
  await openHomeNote(page, 'Research plan');
  await page.getByRole('button', { name: /Show note context/ }).click();
  const panel = page.getByRole('complementary', { name: 'Note context' });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Next steps', exact: true }).click();
  await expect(panel).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('failed saves keep the edited note open and Retry persists the changes', async ({ page }) => {
  await seed(page);
  await openHomeNote(page, 'Research plan');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as unknown as { restoreStorage: () => void }).restoreStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'logia.browser-workspace.v1') throw new DOMException('Workspace storage is full', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await page.locator('.bn-editor[contenteditable="true"]').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(' retry-proof');
  await expect(page.getByTestId('footer-save-status')).toContainText('Not saved');
  await page.keyboard.press('Control+p');
  await page.getByRole('dialog').getByRole('combobox').fill('Source');
  await page.getByRole('dialog').getByRole('combobox').press('Enter');
  await expect(page.locator('[data-note-editor="plan"]')).toBeVisible();
  await page.evaluate(() => (window as unknown as { restoreStorage: () => void }).restoreStorage());
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByTestId('footer-save-status')).toContainText('Saved');
  await expect.poll(async () => (await readStored(page)).notes.find((note: { id: string }) => note.id === 'plan').content).toContain('retry-proof');
});

test('a load failure shows an error and can recover without declaring the workspace empty', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('logia.browser-workspace.v1', '{invalid JSON'));
  await page.goto('/');
  await expect(page.getByText("Couldn't load your notes", { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nothing here yet' })).not.toBeVisible();
  await page.evaluate(({ key, notes }) => localStorage.setItem(key, JSON.stringify({ notes, folders: [] })), { key: storageKey, notes: records });
  await page.getByRole('button', { name: 'Retry', exact: true }).first().click();
  await expect(homeRows(page)).toHaveCount(3);
});

test('editing an active note alias refreshes cached backlinks immediately', async ({ page }) => {
  const notes = records.map((note) => ({ ...note }));
  const planBlocks = JSON.parse(notes[0].content);
  planBlocks.splice(1, 0, { id: 'plan-aliases', type: 'codeBlock', props: { language: 'yaml' }, content: 'aliases: [OldAlias]', children: [] });
  notes[0].content = JSON.stringify(planBlocks);
  notes[1].content = JSON.stringify([block('source-title', 'heading', 'Source'), block('source-body', 'paragraph', 'See [[SharedAlias]].')]);
  await seed(page, notes);
  await openHomeNote(page, 'Research plan');
  const backlinks = page.getByRole('button', { name: /^Backlinks:/ });
  await expect(backlinks).toHaveAccessibleName('Backlinks: 0 notes link here');
  const aliases = page.locator('.bn-block-content').filter({ hasText: 'aliases: [OldAlias]' });
  await aliases.click();
  await page.keyboard.press('End');
  for (const _ of '[OldAlias]') await page.keyboard.press('Backspace');
  await page.keyboard.insertText('[SharedAlias]');
  await expect(backlinks).toHaveAccessibleName('Backlinks: 1 note links here');
  await page.keyboard.press('End');
  for (const _ of '[SharedAlias]') await page.keyboard.press('Backspace');
  await page.keyboard.insertText('[AnotherAlias]');
  await expect(backlinks).toHaveAccessibleName('Backlinks: 0 notes link here');
});
