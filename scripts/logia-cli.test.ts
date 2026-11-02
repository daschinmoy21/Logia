import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
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
