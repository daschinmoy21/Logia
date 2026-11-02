import { test, expect, type Page } from '@playwright/test';
import { createServer, type Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { chmod, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { openAgentWorkspace } from './agent-fixture';

const script = path.resolve('scripts/logia-cli.mjs');
async function broker(page: Page) {
  const endpoint = `/tmp/logia-cli-gui-${process.pid}-${randomUUID().slice(0,8)}.sock`;
  const sockets = new Set<Socket>();
  const server = createServer({ allowHalfOpen: true }, socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let buffer = '', sent = false;
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      buffer += chunk;
      if (sent || !buffer.includes('\n')) return;
      sent = true;
      const request = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
      void page.evaluate(async request => {
        const { executeGuiCommand } = await import('/src/lib/cli/gui.ts');
        return executeGuiCommand({ ...request, deadline: Date.now() + 5000 });
      }, request).then(reply => socket.end(JSON.stringify(reply) + '\n'), error => socket.end(JSON.stringify({ schemaVersion: 1, error: { code: 'TEST_BROKER', message: String(error) } }) + '\n'));
    });
  });
  await new Promise<void>(resolve => server.listen(endpoint, resolve));
  await chmod(endpoint, 0o600);
  return {
    run: (args: string[], input = '') => new Promise<{ code: number | null; data: any; stdout: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [script, '--socket', endpoint, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
      child.on('error', reject); child.on('close', code => {
        try { resolve({ code, data: JSON.parse(stdout), stdout }); }
        catch { reject(new Error(`Invalid CLI output: ${stdout} ${stderr}`)); }
      });
      child.stdin.end(input);
    }),
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(endpoint, { force: true }); },
  };
}

test('live CLI reads unsaved GUI state, appends visibly, and persists rich blocks', async ({ page }) => {
  await openAgentWorkspace(page);
  const bridge = await broker(page);
  try {
    const editor = page.locator('[data-note-editor="agent-note"] .bn-editor');
    await editor.locator('.bn-block-content').last().click();
    await page.keyboard.press('End'); await page.keyboard.type(' Human draft.');
    const read = await bridge.run(['read']);
    expect(read.code).toBe(0);
    expect(read.data.data.markdown).toContain('Human draft.');
    expect(read.data.data.revision).toMatch(/^sha256-[a-f0-9]{64}$/);
    const result = await bridge.run(['append', 'id=agent-note', '--stdin'], '## Agent addition\n\n- [ ] Review this note');
    expect(result.code).toBe(0);
    await expect(editor).toContainText('Agent addition');
    await expect(editor).toContainText('Human draft.');
    await expect(editor.locator('[data-content-type="checkListItem"]')).toBeVisible();
    await page.screenshot({ path: 'artifacts/screenshots/live-cli-note.png', fullPage: true });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('logia.browser-workspace.v1')!).notes[0]);
    expect(JSON.parse(stored.content).map((block: any) => block.id)).toEqual(expect.arrayContaining(['agent-title', 'agent-body']));
    await page.reload();
    await page.getByRole('list', { name: 'Notes', exact: true }).getByRole('button', { name: /^Agent collaboration / }).click();
    await expect(page.locator('.bn-editor')).toContainText('Agent addition');
    await expect(page.locator('.bn-editor')).toContainText('Human draft.');
  } finally { await bridge.close(); }
});

test('CLI creates silently, resolves paths, opens notes, and rejects stale replacement', async ({ page }) => {
  await openAgentWorkspace(page);
  const bridge = await broker(page);
  try {
    const made = await bridge.run(['create', 'path=Projects/CLI plan.md', '--stdin'], '# CLI plan\n\nOriginal body');
    expect(made.code).toBe(0);
    const id = made.data.data.id;
    await expect(page.locator('[data-note-editor="agent-note"]')).toBeVisible();
    expect((await bridge.run(['read', 'path=Projects/CLI plan.md'])).data.data.id).toBe(id);
    const opened = await bridge.run(['open', `id=${id}`]);
    expect(opened.code).toBe(0);
    await expect(page.locator(`[data-note-editor="${id}"]`)).toBeVisible();
    const original = await bridge.run(['read']);
    const append = await bridge.run(['append', 'content=Human-safe addition']);
    expect(append.code).toBe(0);
    const conflict = await bridge.run(['write', `ifRevision=${original.data.data.revision}`, '--stdin'], '# CLI plan\n\nStale body');
    expect(conflict.code).toBe(1); expect(conflict.data.error.code).toBe('REVISION_CONFLICT');
    await expect(page.locator('.bn-editor')).toContainText('Human-safe addition');
    const latest = await bridge.run(['read']);
    const written = await bridge.run(['write', `ifRevision=${latest.data.data.revision}`, '--stdin'], '# CLI plan\n\nReplacement approved by revision');
    expect(written.code).toBe(0);
    await expect(page.locator('.bn-editor')).toContainText('Replacement approved by revision');
    const duplicate = await bridge.run(['create', 'path=Projects/CLI plan.md']);
    expect(duplicate.data.error.code).toBe('ALREADY_EXISTS');
    const invalid = await bridge.run(['create', 'path=../Escape.md']);
    expect(invalid.data.error.code).toBe('INVALID_REQUEST');
  } finally { await bridge.close(); }
});

test('prepend preserves frontmatter; GUI save failures remain visible and retryable', async ({ page }) => {
  await openAgentWorkspace(page);
  const bridge = await broker(page);
  try {
    const made = await bridge.run(['create', 'name=Metadata', '--stdin'], '---\ntags: [agent]\naliases: [Meta]\n---\n# Metadata\n\nBody');
    expect(made.code).toBe(0);
    const id = made.data.data.id;
    const prepended = await bridge.run(['prepend', `id=${id}`, 'content=Inserted before body']);
    expect(prepended.code).toBe(0);
    expect(prepended.data.data.markdown).toMatch(/^---\ntags: \[agent\]/);
    expect(prepended.data.data.markdown.indexOf('Inserted before body')).toBeLessThan(prepended.data.data.markdown.indexOf('Body'));
    await bridge.run(['open', `id=${id}`]);
    await expect(page.locator(`[data-note-editor="${id}"]`)).toBeVisible();
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      (window as any).__restoreStorage = () => { Storage.prototype.setItem = original; };
      Storage.prototype.setItem = function(key, value) { if (key === 'logia.browser-workspace.v1') throw new Error('Fixture disk full'); return original.call(this, key, value); };
    });
    const failed = await bridge.run(['append', 'content=Keep this unsaved edit']);
    expect(failed.data.error.code).toBe('SAVE_FAILED');
    await expect(page.locator('.bn-editor')).toContainText('Keep this unsaved edit');
    await expect(page.getByTestId('footer-save-status')).toContainText('Not saved');
    await page.evaluate(() => (window as any).__restoreStorage());
    expect((await bridge.run(['save'])).code).toBe(0);
    await expect(page.getByTestId('footer-save-status')).toContainText('Saved');
    const stored = await bridge.run(['read']);
    expect(stored.data.data.markdown.match(/Keep this unsaved edit/g)).toHaveLength(1);
  } finally { await bridge.close(); }
});

test('daily commands and background raw-block edits keep the active note and surface save errors', async ({ page }) => {
  await openAgentWorkspace(page);
  const bridge = await broker(page);
  try {
    const invalid = await bridge.run(['daily:append']);
    expect(invalid.data.error.code).toBe('INVALID_REQUEST');
    expect((await bridge.run(['files'])).data.data).toHaveLength(1);
    const daily = await bridge.run(['daily:append', 'content=- [ ] Added through the GUI']);
    expect(daily.code).toBe(0);
    await expect(page.locator('[data-note-editor="agent-note"]')).toBeVisible();
    expect((await bridge.run(['daily:read'])).data.data.markdown).toContain('Added through the GUI');
    expect((await bridge.run(['search', 'query=#daily'])).data.data.map((note: any) => note.id)).toContain(daily.data.data.id);
    expect((await bridge.run(['tags'])).data.data).toEqual(expect.arrayContaining([{ tag: 'daily', count: 1 }]));
    const raw = [{ id: 'rich-title', type: 'heading', props: { level: 1 }, content: 'Rich' }, { id: 'rich-body', type: 'paragraph', content: [{ type: 'text', text: 'Retain bold formatting', styles: { bold: true } }] }];
    const created = await bridge.run(['create', 'name=Rich', '--blocks-json'], JSON.stringify(raw));
    expect(created.code).toBe(0);
    const id = created.data.data.id;
    expect((await bridge.run(['append', `id=${id}`, 'content=Background addition'])).code).toBe(0);
    const rich = await bridge.run(['read', `id=${id}`]);
    expect(rich.data.data.markdown).toContain('**Retain bold formatting**');
    expect(JSON.parse(rich.data.data.content).some((block: any) => block.id === 'rich-body')).toBe(true);
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      (window as any).__restoreStorage = () => { Storage.prototype.setItem = original; };
      Storage.prototype.setItem = function(key, value) { if (key === 'logia.browser-workspace.v1') throw new Error('Fixture background save failure'); return original.call(this, key, value); };
    });
    expect((await bridge.run(['append', `id=${id}`, 'content=Pending background edit'])).data.error.code).toBe('SAVE_FAILED');
    expect((await bridge.run(['read', `id=${id}`])).data.data.dirty).toBe(true);
    expect((await bridge.run(['open', `id=${id}`])).code).toBe(0);
    await expect(page.getByTestId('footer-save-status')).toContainText('Not saved');
    await page.evaluate(() => (window as any).__restoreStorage());
    expect((await bridge.run(['save'])).code).toBe(0);
    expect((await bridge.run(['read'])).data.data.dirty).toBe(false);
  } finally { await bridge.close(); }
});
