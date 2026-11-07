import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn as require_spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdtemp, chmod, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
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

test('--content-file sends the file literally, with no escape processing, and rejects mixed payloads', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'logia-cli-file-'));
  const socket = path.join(dir, 'gui.sock');
  const body = '```artifact\n<script>console.log("a\\nb")</script>\n```\n' + '<li>row</li>\n'.repeat(5000);
  await writeFile(path.join(dir, 'big.md'), body);
  let received: any;
  const server = net.createServer((conn) => {
    let buffer = '';
    conn.on('data', (chunk) => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      received = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
      conn.end(JSON.stringify({ schemaVersion: 1, data: { ok: true } }) + '\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  try {
    const result = await new Promise<{ status: number | null; stdout: string }>((resolve) => {
      const child = require_spawn(process.execPath, [script, 'append', 'id=n1', '--content-file', path.join(dir, 'big.md'), '--socket', socket]);
      let stdout = '';
      child.stdout.on('data', (c: Buffer) => { stdout += c; });
      child.on('close', (status: number | null) => resolve({ status, stdout }));
    });
    assert.equal(result.status, 0, result.stdout);
    assert.equal(received.command, 'append');
    assert.equal(received.params.content, body);
    assert.equal(received.params.contentFile, undefined);
    const mixed = run('append', `contentFile=${path.join(dir, 'big.md')}`, 'content=x', '--socket', socket);
    assert.equal(JSON.parse(mixed.stdout).error.code, 'INVALID_REQUEST');
    const missing = run('append', '--content-file', path.join(dir, 'nope.md'), '--socket', socket);
    assert.match(JSON.parse(missing.stdout).error.message, /Cannot read content file/);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
