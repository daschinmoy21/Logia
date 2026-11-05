import { test, expect, type Page } from '@playwright/test';

const at = new Date(Date.now() - 2 * 3600e3).toISOString();
const task = (id: string, name: string, column: string) => ({ id, name, column, created_at: at, updated_at: at });

/** Only the board's storage is simulated: it sits behind native IPC, which a browser page lacks. */
async function openBoard(page: Page, tasks = [task('a', 'Send the survey', 'todo'), task('b', 'Book two calls', 'todo'), task('c', 'Tag transcripts', 'in-progress')], failLoad = false) {
  await page.goto('/');
  await page.evaluate(({ tasks, failLoad }) => {
    const win = window as any;
    win.__saved = [];
    win.__failSave = false;
    win.__failLoad = failLoad;
    win.__TAURI_INTERNALS__ = {
      metadata: { currentWebview: { label: 'main' }, currentWindow: { label: 'main' } },
      invoke: async (command: string, args: any) => {
        if (command === 'get_kanban_data') {
          if (win.__failLoad) throw new Error('Fixture: unreadable tasks');
          return tasks;
        }
        if (command === 'save_kanban_data') {
          if (win.__failSave) throw new Error('Fixture: disk full');
          win.__saved.push(args.tasks);
          return;
        }
        throw new Error(`Unexpected IPC: ${command}`);
      },
    };
  }, { tasks, failLoad });
  await page.evaluate(async () => {
    const { default: ui } = await import('/src/store/UiStore.ts' as string);
    ui.getState().setIsKanbanOpen(true);
  });
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
}

const saved = (page: Page) => page.evaluate(() => { const win = window as any; return win.__saved.at(-1) as Array<{ id: string; name: string; column: string }>; });
const column = (page: Page, name: string) => page.getByRole('region', { name: new RegExp(`^${name},`) });
const card = (page: Page, name: string) => page.getByRole('listitem', { name: new RegExp(`^${name},`) });

test('tasks can be captured one after another without touching the mouse', async ({ page }) => {
  await openBoard(page, []);
  const composer = page.getByRole('textbox', { name: 'New task' });
  await expect(composer).toBeFocused();
  await composer.fill('First');
  await composer.press('Enter');
  await composer.fill('Second');
  await composer.press('Enter');
  await expect(composer).toBeFocused();
  await expect(column(page, 'Todo')).toContainText('First');
  await expect(column(page, 'Todo')).toContainText('Second');
  await expect.poll(async () => (await saved(page))?.map((item) => item.name)).toEqual(['First', 'Second']);
  await expect(page.getByText('New Task', { exact: true })).toHaveCount(0);
});

test('Escape clears typed text first, then closes the panel', async ({ page }) => {
  await openBoard(page, []);
  const composer = page.getByRole('textbox', { name: 'New task' });
  await composer.fill('Half a thought');
  await composer.press('Escape');
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  await expect(composer).toHaveValue('');
  await composer.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a focused card moves, completes, renames and deletes from the keyboard, and delete can be undone', async ({ page }) => {
  await openBoard(page);
  const survey = card(page, 'Send the survey');
  await survey.focus();
  await page.keyboard.press('ArrowRight');
  await expect(column(page, 'Doing')).toContainText('Send the survey');
  await expect(survey).toBeFocused();
  await page.keyboard.press('Space');
  await expect(column(page, 'Done')).toContainText('Send the survey');
  await expect(page.getByText('1 of 3 done')).toBeVisible();
  await expect(survey).toBeFocused();

  await page.keyboard.press('Enter');
  const rename = page.getByRole('textbox', { name: 'Task name' });
  await expect(rename).toBeFocused();
  await rename.fill('Survey sent');
  await rename.press('Enter');
  const renamed = card(page, 'Survey sent');
  await expect(renamed).toBeFocused();

  await page.keyboard.press('Delete');
  await expect(renamed).toHaveCount(0);
  await expect.poll(async () => (await saved(page)).some((item) => item.id === 'a')).toBe(false);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(column(page, 'Done')).toContainText('Survey sent');
  await expect.poll(async () => (await saved(page)).find((item) => item.id === 'a')?.column).toBe('done');
});

test('renaming with Escape keeps the old name and the panel open', async ({ page }) => {
  await openBoard(page);
  await card(page, 'Send the survey').focus();
  await page.keyboard.press('Enter');
  const rename = page.getByRole('textbox', { name: 'Task name' });
  await rename.fill('Something else');
  await rename.press('Escape');
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  await expect(card(page, 'Send the survey')).toBeFocused();
});

test('dragging moves a task between columns and reorders within one', async ({ page }) => {
  await openBoard(page);
  const drag = async (from: { x: number; y: number; width: number; height: number }, x: number, y: number) => {
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 });
    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.up();
  };
  const doing = (await column(page, 'Done').boundingBox())!;
  await drag((await card(page, 'Send the survey').boundingBox())!, doing.x + doing.width / 2, doing.y + 200);
  await expect(column(page, 'Done')).toContainText('Send the survey');
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  await expect.poll(async () => (await saved(page))?.find((item) => item.id === 'a')?.column).toBe('done');

  await openBoardReorder(page, drag);
});

async function openBoardReorder(page: Page, drag: (from: { x: number; y: number; width: number; height: number }, x: number, y: number) => Promise<void>) {
  await page.getByRole('button', { name: 'Add task to Todo' }).click();
  const composer = page.getByRole('textbox', { name: 'New task' });
  await composer.fill('Later task');
  await composer.press('Enter');
  const target = (await card(page, 'Book two calls').boundingBox())!;
  await drag((await card(page, 'Later task').boundingBox())!, target.x + target.width / 2, target.y + target.height / 2);
  await expect.poll(async () => {
    const todo = (await saved(page)).filter((item) => item.column === 'todo').map((item) => item.name);
    return todo;
  }).toEqual(['Later task', 'Book two calls']);
}

test('a board that failed to load offers a retry and never saves over the real tasks', async ({ page }) => {
  await openBoard(page, [task('a', 'Send the survey', 'todo')], true);
  await expect(page.getByRole('alert')).toContainText("couldn't be loaded");
  await expect(page.getByRole('textbox', { name: 'New task' })).toHaveCount(0);
  await page.evaluate(() => { (window as any).__failLoad = false; });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(card(page, 'Send the survey')).toBeVisible();
  expect(await saved(page)).toBeUndefined();
});

test('a failed save says so and can be retried', async ({ page }) => {
  await openBoard(page);
  await page.evaluate(() => { (window as any).__failSave = true; });
  await card(page, 'Send the survey').focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('alert')).toContainText("wasn't saved");
  await page.evaluate(() => { (window as any).__failSave = false; });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(async () => (await saved(page))?.find((item) => item.id === 'a')?.column).toBe('done');
});

test('the panel opens and stays open while the sidebar is hidden, and stacks in a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await openBoard(page);
  await expect(card(page, 'Send the survey')).toBeVisible();
  const todo = (await column(page, 'Todo').boundingBox())!;
  const doing = (await column(page, 'Doing').boundingBox())!;
  expect(doing.y).toBeGreaterThan(todo.y);
  await page.mouse.move(590, 790);
  await page.waitForTimeout(500);
  await expect(card(page, 'Send the survey')).toBeVisible();
});
