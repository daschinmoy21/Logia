import { test, expect, type Page } from '@playwright/test';

/** The phone shell, in a Pixel 7-sized touch viewport. `?mobile=1` asks for it in a browser. */
test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

const storageKey = 'logia.browser-workspace.v1';
const tasksKey = 'logia.browser-tasks.v1';
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const block = (type: string, content: string, props: Record<string, unknown> = {}) => ({ id: crypto.randomUUID(), type, props, content, children: [] });
const note = (id: string, title: string, body: string, updated: string, extra: Record<string, unknown> = {}) => ({
  id, title, note_type: 'text', starred: false, created_at: updated, updated_at: updated,
  content: JSON.stringify([block('heading', title, { level: 1 }), block('paragraph', body)]), ...extra,
});
const seedNotes = [
  note('plan', 'Weekly planning', 'Ship the phone app. #work', ago(20 * 60e3), { starred: true }),
  note('groceries', 'Grocery list', 'Oat milk, tomatoes, basil', ago(26 * 3600e3)),
  note('lisbon', 'Trip to Lisbon', 'Stay near Alfama. #travel', ago(5 * 24 * 3600e3)),
];
const seedTasks = [
  { id: 't1', name: 'Call the bank', column: 'todo', created_at: ago(1e5), updated_at: ago(1e5) },
  { id: 't2', name: 'Renew passport', column: 'done', created_at: ago(1e5), updated_at: ago(1e5) },
];

async function open(page: Page, notes: unknown[] = seedNotes, tasks: unknown[] = seedTasks) {
  page.on('pageerror', (error) => console.log('Browser exception:', error.message));
  await page.addInitScript(({ storageKey, tasksKey, notes, tasks }) => {
    if (!localStorage.getItem(storageKey)) localStorage.setItem(storageKey, JSON.stringify({ notes, folders: [] }));
    if (!localStorage.getItem(tasksKey)) localStorage.setItem(tasksKey, JSON.stringify(tasks));
  }, { storageKey, tasksKey, notes, tasks });
  await page.goto('/?mobile=1');
  await expect(page.getByRole('heading', { name: 'Notes', level: 1 })).toBeVisible();
}

const rows = (page: Page) => page.locator('[data-note-row]');
const row = (page: Page, title: string) => rows(page).filter({ hasText: title });
const stored = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), storageKey);
const storedTasks = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), tasksKey);

async function noHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    view: window.innerWidth,
    wide: [...document.querySelectorAll('.m-root *')]
      .filter((el) => !el.closest('.m-chips, [role="toolbar"]'))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1; })
      .map((el) => `${el.tagName}.${(el as HTMLElement).className}`.slice(0, 80)),
  }));
  expect(widths.doc).toBeLessThanOrEqual(widths.view);
  expect(widths.body).toBeLessThanOrEqual(widths.view);
  expect(widths.wide).toEqual([]);
}

test('the list shows notes newest first, with sections, and fits the screen', async ({ page }) => {
  await open(page);
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).first()).toContainText('Weekly planning');
  await expect(rows(page).first()).toContainText('Ship the phone app.');
  await expect(page.getByRole('region', { name: 'Today' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  // None of the desktop workspace comes along.
  await expect(page.locator('[data-workspace-pane]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New note' })).toBeVisible();
  await noHorizontalOverflow(page);
});

test('a new note is typed, saved, and listed after going back', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.locator('[data-mobile-editor] .bn-editor');
  await expect(editor).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeHidden();
  // The cursor starts on the title.
  await expect(editor).toBeFocused();
  await page.keyboard.type('Packing list');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Passport and chargers');
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to notes' }).click();
  await expect(page.locator('[data-mobile-editor]')).toHaveCount(0);
  await expect(rows(page).first()).toContainText('Packing list');
  await expect(rows(page).first()).toContainText('Passport and chargers');
  await expect.poll(async () => (await stored(page)).notes.find((n: { title: string }) => n.title === 'Packing list')?.content ?? '').toContain('Passport and chargers');
});

test('the keyboard toolbar formats text and can put the keyboard away', async ({ page }) => {
  await open(page);
  await row(page, 'Grocery list').click();
  await page.locator('.bn-editor [data-content-type="paragraph"]').first().click();
  const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
  await expect(toolbar).toBeVisible();
  await page.keyboard.press('End');
  await toolbar.getByRole('button', { name: 'Checklist' }).click();
  await expect(page.locator('.bn-editor [data-content-type="checkListItem"]')).toHaveCount(1);
  await expect(toolbar.getByRole('button', { name: 'Checklist' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-mobile-editor] .bn-editor')).toBeFocused();
  await toolbar.getByRole('button', { name: 'Hide keyboard' }).click();
  await expect(toolbar).toBeHidden();
  // No desktop-only chrome: no slash side menu handles, no vim, no command palette.
  await expect(page.locator('.bn-side-menu')).toHaveCount(0);
  await expect(page.locator('.vim-block-cursor')).toHaveCount(0);
});

test('search narrows the list and chips filter favorites and tags', async ({ page }) => {
  await open(page);
  await page.getByRole('searchbox', { name: 'Search notes' }).fill('alfama');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText('Trip to Lisbon');
  await page.getByRole('searchbox', { name: 'Search notes' }).fill('no-such-thing');
  await expect(page.getByText('No results for “no-such-thing”')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).first().click();
  await expect(rows(page)).toHaveCount(3);
  const filters = page.getByRole('group', { name: 'Filter notes' });
  await filters.getByRole('button', { name: 'Favorites' }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText('Weekly planning');
  await filters.getByRole('button', { name: 'Tag travel' }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText('Trip to Lisbon');
  await filters.getByRole('button', { name: 'All' }).click();
  await expect(rows(page)).toHaveCount(3);
});

test('long-press actions favorite and delete a note, and delete can be undone', async ({ page }) => {
  await open(page);
  // A long press reaches the page as a context menu.
  await row(page, 'Grocery list').click({ button: 'right' });
  const sheet = page.getByRole('dialog', { name: 'Grocery list' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Add to favorites' }).click();
  await expect(sheet).toBeHidden();
  await expect(row(page, 'Grocery list').getByLabel('Favorite')).toBeVisible();
  await expect.poll(async () => (await stored(page)).notes.find((n: { id: string }) => n.id === 'groceries')?.starred).toBe(true);

  await row(page, 'Grocery list').click({ button: 'right' });
  await page.getByRole('dialog', { name: 'Grocery list' }).getByRole('button', { name: 'Delete' }).click();
  await expect(row(page, 'Grocery list')).toHaveCount(0);
  const snackbar = page.getByRole('status').filter({ hasText: 'Note deleted' });
  await expect(snackbar).toBeVisible();
  await snackbar.getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Grocery list')).toHaveCount(1);
  await expect(rows(page)).toHaveCount(3);
});

test('deleting from the editor returns to the list with undo', async ({ page }) => {
  await open(page);
  await row(page, 'Trip to Lisbon').click();
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.locator('[data-mobile-editor]')).toHaveCount(0);
  await expect(row(page, 'Trip to Lisbon')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Trip to Lisbon')).toHaveCount(1);
  // Both layers gave their history entries back: one more back has nothing of ours to close.
  await expect.poll(() => page.evaluate(() => history.state?.logiaLayer ?? null)).toBeNull();
});

test('tasks are added, completed and reopened', async ({ page }) => {
  await open(page);
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Tasks' }).click();
  await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();
  await expect(page.getByText('1 of 2 done')).toBeVisible();
  const input = page.getByRole('textbox', { name: 'New task' });
  await input.fill('Buy stamps');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  const todo = page.getByRole('list', { name: 'To do' });
  await expect(todo).toContainText('Buy stamps');
  await expect.poll(async () => (await storedTasks(page)).map((t: { name: string }) => t.name)).toContain('Buy stamps');

  await page.getByRole('checkbox', { name: 'Mark “Buy stamps” as done' }).click();
  await expect(page.getByRole('list', { name: 'Completed' })).toContainText('Buy stamps');
  await expect(page.getByText('2 of 3 done')).toBeVisible();
  await expect.poll(async () => (await storedTasks(page)).find((t: { name: string }) => t.name === 'Buy stamps')?.column).toBe('done');

  await page.getByRole('checkbox', { name: 'Mark “Renew passport” as not done' }).click();
  await expect(todo).toContainText('Renew passport');
  await noHorizontalOverflow(page);
});

test('Android back closes the top layer first: sheet, editor, then tab', async ({ page }) => {
  await open(page);
  await row(page, 'Grocery list').click({ button: 'right' });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Notes', level: 1 })).toBeVisible();

  await row(page, 'Grocery list').click();
  await expect(page.locator('[data-mobile-editor]')).toBeVisible();
  await page.getByRole('button', { name: 'More options' }).click();
  await expect(page.getByRole('menu', { name: 'Note options' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('[data-mobile-editor]')).toBeVisible();
  await page.goBack();
  await expect(page.locator('[data-mobile-editor]')).toHaveCount(0);
  await expect(row(page, 'Grocery list')).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Notes', level: 1 })).toBeVisible();
  // Still the app: the next back would leave it, not reopen anything.
  await expect(page).toHaveURL(/mobile=1/);
});

test('dark mode follows the system and can be chosen in settings', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  const background = () => page.evaluate(() => getComputedStyle(document.querySelector('.m-root')!).backgroundColor);
  expect(await background()).toBe('rgb(18, 17, 16)');
  await noHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Light' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await background()).toBe('rgb(251, 248, 243)');
  await page.getByRole('radiogroup', { name: 'Text size' }).getByRole('radio', { name: 'Large' }).click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--m-editor-size').trim())).toBe('19px');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
});

test('inputs are at least 16px so focusing them never zooms the page', async ({ page }) => {
  await open(page);
  const sizes = await page.evaluate(() => [...document.querySelectorAll('input')].map((el) => parseFloat(getComputedStyle(el).fontSize)));
  expect(sizes.length).toBeGreaterThan(0);
  for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16);
});

test('a desktop-sized browser keeps the desktop workspace', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('[data-workspace-pane="editor"]')).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-shell', 'mobile');
  await context.close();
});

/** A one-finger horizontal drag, sent as real touch input. */
async function swipe(page: Page, title: string, distance: number) {
  const box = (await row(page, title).boundingBox())!;
  const y = box.y + box.height / 2;
  const startX = distance < 0 ? box.x + box.width - 40 : box.x + 40;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, x: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', startX);
  for (let step = 1; step <= 12; step += 1) await touch('touchMove', startX + (distance * step) / 12);
  await touch('touchEnd', startX + distance);
  await cdp.detach();
}

test('swiping a row right favorites it, and left deletes it with undo', async ({ page }) => {
  await open(page);
  await swipe(page, 'Trip to Lisbon', 260);
  await expect(row(page, 'Trip to Lisbon').getByLabel('Favorite')).toBeVisible();
  await expect(page.locator('[data-mobile-editor]')).toHaveCount(0);

  await swipe(page, 'Trip to Lisbon', -260);
  await expect(row(page, 'Trip to Lisbon')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Trip to Lisbon')).toHaveCount(1);

  // A short drag snaps back and does nothing.
  await swipe(page, 'Grocery list', -60);
  await expect(row(page, 'Grocery list')).toHaveCount(1);
  await expect(page.getByText('Note deleted')).toHaveCount(0);
});

test('pulling the list down refreshes it from storage', async ({ page }) => {
  await open(page);
  // Another writer (later: sync) adds a note behind the app's back.
  await page.evaluate((key) => {
    const data = JSON.parse(localStorage.getItem(key)!);
    const now = new Date().toISOString();
    data.notes.unshift({ id: 'later', title: 'Arrived later', note_type: 'text', starred: false, created_at: now, updated_at: now, content: '[]' });
    localStorage.setItem(key, JSON.stringify(data));
  }, storageKey);
  await expect(row(page, 'Arrived later')).toHaveCount(0);
  const box = (await page.locator('[data-notes-list]').boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const x = box.x + 100;
  const touch = (type: string, y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', box.y);
  for (let step = 1; step <= 12; step += 1) await touch('touchMove', box.y + step * 22);
  await touch('touchEnd', box.y + 264);
  await cdp.detach();
  await expect(row(page, 'Arrived later')).toHaveCount(1);
});
