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

/** Artifacts from outside the editor wait for one click on Run. */
async function runArtifact(page: Page) {
  await page.locator('.logia-live-preview[data-language="artifact"]').getByRole('button', { name: 'Run', exact: true }).click();
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

test('clicking a mermaid diagram opens a pan and zoom viewer', async ({ page }) => {
  await openNote(page);
  const preview = page.locator('.logia-live-preview[data-language="mermaid"]');
  await expect(preview.locator('svg')).toBeVisible({ timeout: 15_000 });
  await preview.locator('svg').click();
  const viewer = page.getByRole('dialog', { name: 'Mermaid diagram' });
  await expect(viewer.locator('svg')).toContainText('Client');
  const level = viewer.locator('.logia-diagram-viewer-level');
  const before = await level.textContent();
  await viewer.getByRole('button', { name: 'Zoom in' }).click();
  await expect(level).not.toHaveText(before!);
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  // Source stays hidden: viewing isn't editing.
  await expect(page.locator('.bn-block-content[data-content-type="codeBlock"]').first()).toBeHidden();
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
  await runArtifact(page);
  const frame = page.locator('.logia-live-preview[data-language="artifact"] iframe');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(page.frameLocator('.logia-live-preview[data-language="artifact"] iframe').locator('#out')).toHaveText('ran 42');
});

test('live blocks can be dragged by their block handle', async ({ page }) => {
  await openNote(page);
  await runArtifact(page);
  await expect(page.frameLocator('.logia-live-preview[data-language="artifact"] iframe').locator('#out')).toHaveText('ran 42');
  await page.mouse.move(0, 0);
  const artifact = page.locator('.logia-live-preview[data-language="artifact"]');
  const mermaid = page.locator('.logia-live-preview[data-language="mermaid"]');
  await expect(mermaid.locator('svg')).toBeVisible({ timeout: 15_000 });
  await artifact.locator('.logia-live-preview-bar').hover();
  const handle = page.locator('.bn-side-menu [draggable="true"]').first();
  await expect(handle).toBeVisible();
  const handleBox = (await handle.boundingBox({ timeout: 2_000 }))!;
  const barBox = (await artifact.locator('.logia-live-preview-bar').boundingBox())!;
  // The handle sits beside the block, not at the top of the window.
  expect(Math.abs(handleBox.y - barBox.y)).toBeLessThan(barBox.height);
  // Playwright's native drag stalls on BlockNote's handle, so dispatch the
  // HTML5 drag events the handle and editor listen for.
  const target = (await mermaid.locator('.logia-live-preview-bar').boundingBox())!;
  await handle.evaluate((el, { x, y, hx, hy }) => {
    const data = new DataTransfer();
    const fire = (node: Element, type: string, cx: number, cy: number) =>
      node.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: data, clientX: cx, clientY: cy }));
    fire(el, 'dragstart', hx, hy);
    const over = document.elementFromPoint(x, y)!;
    fire(over, 'dragenter', x, y);
    fire(over, 'dragover', x, y);
    fire(over, 'drop', x, y);
    fire(el, 'dragend', x, y);
  }, { x: target.x + 40, y: target.y + 4, hx: handleBox.x + 4, hy: handleBox.y + 4 });
  const order = await page.locator('.logia-live-preview').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.language));
  expect(order).toEqual(['artifact', 'mermaid']);
  // The moved frame re-renders, and nothing left over from the drag blocks the page.
  await expect(page.frameLocator('.logia-live-preview[data-language="artifact"] iframe').locator('#out')).toHaveText('ran 42');
  await expect(page.locator('html')).not.toHaveClass(/logia-dragging/);
  await expect(page.locator('.bn-block-content[data-content-type="codeBlock"]').first()).toBeHidden();
  // BlockNote's drag image is an invisible clone at the top-left of <body>. When a
  // drag never reports its end (WebKitGTK), it stays there, so it must not take clicks.
  const passThrough = await page.evaluate(() => {
    const clone = document.createElement('div');
    clone.className = 'bn-drag-preview';
    document.body.append(clone);
    const value = getComputedStyle(clone).pointerEvents;
    clone.remove();
    return value;
  });
  expect(passThrough).toBe('none');
});

test('artifact frames ignore the pointer while a drag is in progress', async ({ page }) => {
  await openNote(page);
  await runArtifact(page);
  const frame = page.locator('.logia-live-preview[data-language="artifact"] iframe');
  await expect(frame).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new DragEvent('dragstart', { bubbles: true })));
  await expect(frame).toHaveCSS('pointer-events', 'none');
  await page.evaluate(() => window.dispatchEvent(new DragEvent('dragend', { bubbles: true })));
  await expect(frame).toHaveCSS('pointer-events', 'auto');
  // A drag that never reports its end is cleared by the next pointer input.
  await page.evaluate(() => window.dispatchEvent(new DragEvent('dragstart', { bubbles: true })));
  await page.mouse.move(10, 10);
  await expect(frame).toHaveCSS('pointer-events', 'auto');
});

test('artifacts not written here wait for Run, and stay trusted after a reload', async ({ page }) => {
  await openNote(page);
  const preview = page.locator('.logia-live-preview[data-language="artifact"]');
  await expect(preview.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
  await expect(preview.locator('iframe')).toHaveCount(0);
  await runArtifact(page);
  await expect(page.frameLocator('.logia-live-preview[data-language="artifact"] iframe').locator('#out')).toHaveText('ran 42');

  await page.reload();
  await page.getByRole('list', { name: 'Notes', exact: true }).locator('[data-note-row]').filter({ hasText: 'Diagrams' }).click();
  await expect(page.frameLocator('.logia-live-preview[data-language="artifact"] iframe').locator('#out')).toHaveText('ran 42');
  await expect(preview.getByRole('button', { name: 'Run', exact: true })).toHaveCount(0);
});

test('editing an artifact\'s source counts as writing it, so the edit runs without asking', async ({ page }) => {
  await openNote(page);
  await runArtifact(page);
  const preview = page.locator('.logia-live-preview[data-language="artifact"]');
  await preview.getByRole('button', { name: 'Edit source' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type('<b id="more">typed</b>');
  await expect(page.frameLocator('.logia-live-preview[data-language="artifact"] iframe').locator('#more')).toHaveText('typed', { timeout: 5_000 });
  await expect(preview.getByRole('button', { name: 'Run', exact: true })).toHaveCount(0);
});

test('artifact frames unload when scrolled far off screen and return when scrolled back', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 500 });
  await openNote(page);
  await runArtifact(page);
  const frame = page.locator('.logia-live-preview[data-language="artifact"] iframe');
  await expect(frame).toHaveCount(1);
  // Push the artifact well below the fold with a tall block after the title.
  await page.locator('.bn-block-outer[data-id="title"] .bn-block-content').click();
  await page.keyboard.press('End');
  for (let i = 0; i < 40; i++) await page.keyboard.press('Enter');
  await page.locator('.bn-block-outer[data-id="title"]').scrollIntoViewIfNeeded();
  await expect(frame).toHaveCount(0);
  await expect(page.locator('.logia-artifact-placeholder')).toHaveCount(1);
  await page.locator('.logia-live-preview[data-language="artifact"]').scrollIntoViewIfNeeded();
  await expect(page.frameLocator('.logia-live-preview[data-language="artifact"] iframe').locator('#out')).toHaveText('ran 42');
});
