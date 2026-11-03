import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdtemp, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const script = fileURLToPath(new URL('./logia-cli.mjs', import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 5000 });

test('live CLI documents itself without a GUI and reports disconnected or invalid requests', () => {
  const help = run('help');
  assert.equal(help.status, 0, help.stderr);
  assert.ok(JSON.parse(help.stdout).data.commands.includes('append'));
  assert.ok(JSON.parse(help.stdout).data.commands.includes('open'));
  const missing = run('read', '--socket', `/tmp/logia-not-running-${randomUUID()}.sock`, '--timeout', '100');
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).error.code, 'GUI_NOT_RUNNING');
  for (const args of [['eval', 'code=1'], ['read', '--timeout', 'no'], ['read', '--unknown', 'x'], ['append', '--format', 'markdown']]) {
    const result = run(...args);
    assert.equal(result.status, 1, result.stdout);
    assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_REQUEST');
  }
});

test('a denied CLI socket is reported as a permission failure, not a closed app', { skip: process.platform === 'win32' || process.geteuid?.() === 0 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'logia-cli-denied-'));
  try {
    await chmod(dir, 0o000);
    const result = run('status', '--socket', path.join(dir, 'gui.sock'));
    assert.equal(result.status, 1);
    const reply = JSON.parse(result.stdout);
    assert.equal(reply.error.code, 'ACCESS_DENIED');
    assert.match(reply.error.message, /denied.*EACCES/);
    assert.ok(reply.error.message.includes(path.join(dir, 'gui.sock')));
  } finally {
    await chmod(dir, 0o700);
    await rm(dir, { recursive: true, force: true });
  }
});
