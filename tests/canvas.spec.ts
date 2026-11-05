import { test, expect, type Page } from '@playwright/test';

const storageKey = 'logia.browser-workspace.v1';
const now = '2026-11-02T12:00:00.000Z';
// What createNote gives a new canvas: text-note content, not a drawing.
const heading = JSON.stringify([{ id: 'h', type: 'heading', props: { level: 1 }, content: 'Untitled', children: [] }]);
const records = [
  { id: 'map', title: 'Map', note_type: 'canvas', content: heading },
  { id: 'other', title: 'Other', note_type: 'text', content: heading },
].map((note) => ({ starred: false, created_at: now, updated_at: now, ...note }));

async function openCanvas(page: Page) {
  await page.addInitScript(({ key, notes }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ notes, folders: [] }));
  }, { key: storageKey, notes: records });
  await page.goto('/');
  await page.getByText('Map', { exact: true }).first().click();
  await page.locator('.tl-container').waitFor();
  await expect(page.locator('.tl-canvas')).toBeVisible();
}

const stored = (page: Page, id: string) => page.evaluate(({ key, id }) =>
  JSON.parse(localStorage.getItem(key) || '{}').notes.find((note: { id: string }) => note.id === id).content as string, { key: storageKey, id });

async function drawRectangle(page: Page) {
  await page.keyboard.press('r');
  await page.mouse.move(500, 250);
  await page.mouse.down();
  await page.mouse.move(700, 370, { steps: 8 });
  await page.mouse.up();
}

test('a drawing with text is saved to the note and comes back without the browser cache', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openCanvas(page);
  await drawRectangle(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Interviews');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await expect(page.getByText('Error', { exact: true })).toHaveCount(0);
  await expect.poll(() => stored(page, 'map'), { timeout: 8000 }).toContain('Interviews');
  expect(errors).toEqual([]);

  // Only the note should be able to bring it back, as it would be after syncing to another machine.
  await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    await Promise.all(databases.map((db) => new Promise((resolve) => {
      const request = indexedDB.deleteDatabase(db.name!);
      request.onsuccess = request.onerror = request.onblocked = resolve;
    })));
  });
  await page.reload();
  await page.getByText('Map', { exact: true }).first().click();
  await expect(page.getByTestId('canvas').getByText('Interviews')).toBeVisible();
});

test('leaving straight after drawing saves to the canvas, not the note opened next', async ({ page }) => {
  await openCanvas(page);
  await drawRectangle(page);
  await page.getByText('Other', { exact: true }).first().click();
  await expect(page.locator('[data-note-editor="other"]')).toBeVisible();

  await expect.poll(() => stored(page, 'map'), { timeout: 8000 }).toContain('"type":"geo"');
  await page.waitForTimeout(800);
  expect(await stored(page, 'other')).not.toContain('tldraw');
  expect(await stored(page, 'other')).not.toContain('"type":"geo"');
});
