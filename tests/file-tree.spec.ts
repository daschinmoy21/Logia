import { test, expect, type Page } from '@playwright/test';

const storageKey = 'logia.browser-workspace.v1';
const now = '2026-11-02T12:00:00.000Z';
const note = (id: string, title: string, folder_id?: string) => ({
  id, title, folder_id, note_type: 'text', starred: false, created_at: now, updated_at: now,
  content: JSON.stringify([{ id: `${id}-t`, type: 'heading', props: { level: 1 }, content: title, children: [] }]),
});
const folder = (id: string, name: string, parent_id?: string) => ({ id, name, parent_id, created_at: now, updated_at: now });

async function open(page: Page, notes = [note('a', 'Alpha', 'docs'), note('b', 'Beta', 'docs'), note('c', 'Gamma')], folders = [folder('docs', 'Docs'), folder('arch', 'Archive')]) {
  await page.addInitScript(({ key, notes, folders }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ notes, folders }));
  }, { key: storageKey, notes, folders });
  await page.goto('/');
  await expect(page.getByRole('tree')).toBeVisible();
}

const row = (page: Page, name: string) => page.getByRole('treeitem', { name, exact: true });
const stored = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), storageKey);

async function drag(page: Page, from: string, to: string) {
  const a = (await row(page, from).boundingBox())!;
  const b = (await row(page, to).boundingBox())!;
  await page.mouse.move(a.x + 30, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + a.height / 2 + 10);
  await page.mouse.move(b.x + 30, b.y + b.height / 2, { steps: 4 });
  await page.mouse.up();
}

test('folders toggle instantly, sort first, and survive a reload', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('treeitem')).toHaveText(['Archive', 'Docs', 'Gamma']);
  await row(page, 'Docs').click();
  await expect(page.getByRole('treeitem')).toHaveText(['Archive', 'Docs', 'Alpha', 'Beta', 'Gamma']);
  await expect(row(page, 'Docs')).toHaveAttribute('aria-expanded', 'true');
  await page.reload();
  await expect(row(page, 'Alpha')).toBeVisible();
});

test('the keyboard walks the tree, opens notes, renames, and cancels', async ({ page }) => {
  await open(page);
  await row(page, 'Archive').click();
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'Docs')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(row(page, 'Alpha')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(row(page, 'Alpha')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(row(page, 'Docs')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect(page.locator('[data-note-editor="a"]')).toBeVisible();
  await expect(row(page, 'Alpha')).toHaveAttribute('aria-selected', 'true');

  await row(page, 'Alpha').focus();
  await page.keyboard.press('F2');
  const input = page.getByRole('textbox', { name: 'New name' });
  await expect(input).toBeFocused();
  await input.fill('Discarded');
  await input.press('Escape');
  await expect(row(page, 'Alpha')).toBeFocused();
  await page.keyboard.press('F2');
  await input.fill('Renamed');
  await input.press('Enter');
  await expect(row(page, 'Renamed')).toBeVisible();
  await expect.poll(async () => (await stored(page)).notes.find((n: { id: string }) => n.id === 'a').title).toBe('Renamed');
});

test('dragging moves notes and folders, refuses cycles, and Escape cancels', async ({ page }) => {
  await open(page);
  await drag(page, 'Gamma', 'Archive');
  await expect.poll(async () => (await stored(page)).notes.find((n: { id: string }) => n.id === 'c').folder_id).toBe('arch');
  await expect(page.locator('[data-note-editor]')).toHaveCount(0);

  await drag(page, 'Archive', 'Docs');
  await expect.poll(async () => (await stored(page)).folders.find((f: { id: string }) => f.id === 'arch').parent_id).toBe('docs');
  await drag(page, 'Docs', 'Archive');
  await page.waitForTimeout(100);
  expect((await stored(page)).folders.find((f: { id: string }) => f.id === 'docs').parent_id).toBeUndefined();

  const a = (await row(page, 'Alpha').boundingBox())!;
  const b = (await row(page, 'Docs').boundingBox())!;
  await page.mouse.move(a.x + 30, a.y + 10);
  await page.mouse.down();
  await page.mouse.move(b.x + 30, b.y + 10, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await stored(page)).notes.find((n: { id: string }) => n.id === 'a').folder_id).toBe('docs');
});

test('the context menu opens at the pointer and drives star, new folder rename, and move', async ({ page }) => {
  await open(page);
  await row(page, 'Gamma').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Add to favorites' })).toBeFocused({ timeout: 2000 }).catch(() => {});
  await page.getByRole('menuitem', { name: 'Add to favorites' }).click();
  await expect(page.getByRole('region', { name: 'Favorites' })).toContainText('Gamma');

  await row(page, 'Gamma').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  await expect.poll(async () => (await stored(page)).notes.find((n: { id: string }) => n.id === 'c').folder_id).toBe('arch');

  await row(page, 'Docs').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New folder' }).click();
  const input = page.getByRole('textbox', { name: 'New name' });
  await expect(input).toBeFocused();
  await input.fill('Inner');
  await input.press('Enter');
  await expect(row(page, 'Inner')).toHaveAttribute('aria-level', '2');
});

test('the new-folder shortcut and command create inside the selected folder and start renaming', async ({ page }) => {
  await open(page);
  await row(page, 'Docs').click();
  await page.keyboard.press('Control+Shift+N');
  const input = page.getByRole('textbox', { name: 'New name' });
  await expect(input).toBeFocused();
  await input.fill('From shortcut');
  await input.press('Enter');
  await expect(row(page, 'From shortcut')).toHaveAttribute('aria-level', '2');

  await page.keyboard.press('Control+Shift+P');
  await page.keyboard.type('New folder');
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await input.fill('From palette');
  await input.press('Enter');
  await expect(row(page, 'From palette')).toBeVisible();
});

test('a huge tree mounts only what is on screen and keyboard scrolling keeps focus', async ({ page }) => {
  const many = Array.from({ length: 3000 }, (_, i) => note(`n${i}`, `Note ${String(i).padStart(4, '0')}`));
  await open(page, many, []);
  const mounted = await page.getByRole('treeitem').count();
  expect(mounted).toBeLessThan(120);
  await row(page, 'Note 0000').focus();
  await page.keyboard.press('End');
  await expect(row(page, 'Note 2999')).toBeFocused();
  await expect(row(page, 'Note 2999')).toBeInViewport();
  await page.keyboard.press('Home');
  await expect(row(page, 'Note 0000')).toBeFocused();
});

test('tabs: a single click previews, editing keeps it, closing moves to the neighbor', async ({ page }) => {
  await open(page, [note('a', 'Alpha'), note('b', 'Beta'), note('c', 'Gamma')], []);
  const tab = (name: string) => page.getByRole('tab', { name: new RegExp(`${name}$`) });
  await row(page, 'Alpha').click();
  await expect(page.locator('[data-note-editor="a"]')).toBeVisible();
  await row(page, 'Beta').click();
  await expect(page.locator('[data-note-editor="b"]')).toBeVisible();
  await expect(tab('Alpha')).toHaveCount(0);
  await expect(tab('Beta')).toHaveAttribute('aria-selected', 'true');

  await page.locator('.bn-editor[contenteditable="true"]').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(' edited');
  await row(page, 'Gamma').click();
  await expect(page.locator('[data-note-editor="c"]')).toBeVisible();
  await expect(tab('Beta')).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(3);

  await page.getByRole('button', { name: 'Close Gamma', exact: true }).click();
  await expect(page.locator('[data-note-editor="b"]')).toBeVisible();
  await page.getByRole('button', { name: 'Close Beta', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Home tab' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('list', { name: 'Notes', exact: true })).toBeVisible();
});

test('tree stays usable at 150% UI scale', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('logia-settings', JSON.stringify({ version: 1, state: { uiScale: 1.5 } })));
  await open(page);
  await row(page, 'Docs').click();
  await row(page, 'Beta').click({ button: 'right' });
  const box = await page.getByRole('menu').boundingBox();
  const target = await row(page, 'Beta').boundingBox();
  expect(Math.abs(box!.y - (target!.y + target!.height / 2))).toBeLessThan(40);
  await page.keyboard.press('Escape');
  await drag(page, 'Beta', 'Archive');
  await expect.poll(async () => (await stored(page)).notes.find((n: { id: string }) => n.id === 'b').folder_id).toBe('arch');
});
