import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./logia-agent.ts', import.meta.url));

test('agent CLI reads/searches/links, exports safely, and never changes source records', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'logia-agent-test-'));
  try {
    const dataDir = path.join(root, 'workspace');
    await mkdir(path.join(dataDir, 'notes'), { recursive: true });
    const original = { id: 'one', title: '../../Garden', content: JSON.stringify([{ type: 'heading', content: 'Garden' }, { type: 'paragraph', content: '#plants [[Seeds]]' }]), created_at: '2026-01-01', updated_at: '2026-01-01' };
    const source = JSON.stringify(original);
    await writeFile(path.join(dataDir, 'notes', 'one.json'), source);
    await writeFile(path.join(dataDir, 'notes', 'two.json'), JSON.stringify({ ...original, id: 'two', title: 'Seeds', content: 'Plant in spring' }));
    await writeFile(path.join(dataDir, 'notes', 'broken.json'), 'not json');
    const run = (...args: string[]) => spawnSync(process.execPath, ['--experimental-strip-types', script, '--data-dir', dataDir, ...args], { encoding: 'utf8' });
    const listed = run('list');
    assert.equal(listed.status, 0, listed.stderr);
    assert.equal(JSON.parse(listed.stdout).schemaVersion, 1);
    assert.equal(JSON.parse(listed.stdout).data.length, 2);
    assert.equal(JSON.parse(listed.stdout).warnings[0].file, 'broken.json');
    assert.deepEqual(JSON.parse(run('search', '#plants').stdout).data.map((n: { id: string }) => n.id), ['one']);
    assert.equal(JSON.parse(run('links', 'one').stdout).data.outgoing[0].resolvedId, 'two');
    assert.equal(JSON.parse(run('links', 'two').stdout).data.backlinks[0].id, 'one');
    assert.match(run('read', 'one', '--format', 'markdown').stdout, /# Garden/);
    assert.equal(run('read', '../secrets').status, 1);
    assert.equal(run('search').status, 1);
    assert.equal(run('export').status, 1);
    const output = path.join(root, 'snapshot');
    const exported = run('export', '--output', output);
    assert.equal(exported.status, 0, exported.stdout);
    const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
    assert.equal(manifest.data.notes.length, 2);
    for (const record of manifest.data.notes) {
      assert.equal(path.dirname(path.resolve(output, record.markdownFile)), output);
      assert.ok(await readFile(path.join(output, record.sourceFile), 'utf8'));
    }
    assert.equal(run('export', '--output', output).status, 1, 'existing destinations must be refused');
    assert.equal(await readFile(path.join(dataDir, 'notes', 'one.json'), 'utf8'), source);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
