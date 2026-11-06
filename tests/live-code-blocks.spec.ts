import { test, expect, type Page } from '@playwright/test';

const storageKey = 'logia.browser-workspace.v1';
const now = '2026-11-02T12:00:00.000Z';
const text = (value: string) => [{ type: 'text', text: value, styles: {} }];
const blocks = [
  { id: 'title', type: 'heading', props: { level: 1 }, content: text('Diagrams'), children: [] },
  { id: 'flow', type: 'codeBlock', props: { language: 'mermaid' }, content: text('flowchart TD\n  Client --> API\n  API --> DB'), children: [] },
  { id: 'viz', type: 'codeBlock', props: { language: 'artifact' }, content: text('<p id="out">waiting</p><script>document.getElementById("out").textContent = "ran " + (6 * 7)</script>'), children: [] },
  { id: 'after', type: 'paragraph', content: text('After'), children: [] },
];
const notes = [{ id: 'diagrams', title: 'Diagrams', note_type: 'text', starred: false, created_at: now, updated_at: now, content: JSON.stringify(blocks) }];

async function openNote(page: Page) {
  await page.addInitScript(({ key, notes }) => {
    // Init scripts also run inside the sandboxed artifact frame, which has no storage.
    try { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ notes, folders: [] })); } catch {}
  }, { key: storageKey, notes });
  await page.goto('/');
  await page.getByRole('list', { name: 'Notes', exact: true }).locator('[data-note-row]').filter({ hasText: 'Diagrams' }).click();
}

test('mermaid blocks render a diagram and show source only while editing', async ({ page }) => {
  await openNote(page);
  const preview = page.locator('.logia-live-preview[data-language="mermaid"]');
  await expect(preview.locator('svg')).toBeVisible({ timeout: 15_000 });
  await expect(preview.locator('svg')).toContainText('Client');
  const source = page.locator('.bn-block-content[data-content-type="codeBlock"]').first();
  await expect(source).toBeHidden();

  await preview.getByRole('button', { name: 'Edit source' }).click();
  await expect(source).toBeVisible();
  await page.keyboard.type('\n  DB --> Cache');
  await expect(preview.locator('svg')).toContainText('Cache', { timeout: 5_000 });

  await preview.getByRole('button', { name: 'Done' }).click();
  await expect(source).toBeHidden();
});

test('mermaid syntax errors keep the block usable', async ({ page }) => {
  await openNote(page);
  const preview = page.locator('.logia-live-preview[data-language="mermaid"]');
  await expect(preview.locator('svg')).toBeVisible({ timeout: 15_000 });
  await preview.getByRole('button', { name: 'Edit source' }).click();
  await page.keyboard.type('\n  -->-->');
  await expect(preview).toHaveClass(/has-error/, { timeout: 5_000 });
  await expect(preview.locator('svg')).toContainText('Client');
});

test('artifact blocks run their scripts in a sandboxed frame', async ({ page }) => {
  await openNote(page);
  const frame = page.locator('.logia-live-preview[data-language="artifact"] iframe');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(page.frameLocator('.logia-live-preview[data-language="artifact"] iframe').locator('#out')).toHaveText('ran 42');
});
