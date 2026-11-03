#!/usr/bin/env node
// The live CLI is deliberately standalone: only Node built-ins, no GUI dependencies.
import net from 'node:net';
import process from 'node:process';
import { spawn } from 'node:child_process';

export const COMMANDS = ['status', 'active', 'files', 'list', 'folders', 'search', 'read', 'links', 'backlinks', 'tags', 'open', 'create', 'append', 'prepend', 'write', 'rename', 'save', 'daily', 'daily:read', 'daily:append'];
const envelopeError = (code, message) => ({ schemaVersion: 1, error: { code, message } });
const help = {
  model: 'Commands operate on the running Logia GUI. No direct writes to note files.',
  commands: COMMANDS,
  targeting: 'id=<id>, file=<title or wikilink>, or path=<exact folder/note.md>. Omit to use the active note.',
  parameters: 'name, path, file, id, query, content, blocks, ifRevision, folderId, limit; flags: open, silent, stdin, raw, help',
  examples: [
    'logia-cli read', 'logia-cli search query="meeting notes"',
    'logia-cli create path="Projects/Plan.md" content="# Plan\\n\\nNext steps" open',
    'logia-cli append file="Plan" content="- [ ] Review"',
    'logia-cli write id=NOTE_ID ifRevision=REVISION --stdin',
    'logia-cli open file="Plan"', 'logia-cli daily:append content="- [ ] Follow up"',
  ],
  options: { '--socket': 'Override local IPC endpoint; also LOGIA_CLI_SOCKET.', '--format': 'json (default) or markdown (read commands only).', '--stdin': 'Read literal content from stdin; --blocks-json reads BlockNote JSON instead.', '--if-revision': 'Revision from read; required by write, optional on other edits.', '--launch': 'Launch installed logia (or LOGIA_APP_BINARY) if it is not running.', '--timeout': 'Request deadline in milliseconds, 100–120000; default 30000.' },
  offline: 'Use logia-agent for read-only access and export while the GUI is closed.',
};

function endpoint() {
  if (process.env.LOGIA_CLI_SOCKET) return process.env.LOGIA_CLI_SOCKET;
  if (process.platform === 'win32') return `\\\\.\\pipe\\logia-cli-${(process.env.USERNAME || 'user').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  return `/tmp/logia-cli-${process.geteuid()}/cli.sock`;
}

function parse(args) {
  let command;
  const params = {};
  const options = { socket: endpoint(), format: 'json', timeout: 30000, launch: false };
  const flags = new Set(['open', 'silent', 'stdin', 'raw', 'help']);
  const valued = new Set(['socket', 'format', 'timeout', 'id', 'file', 'path', 'name', 'query', 'content', 'blocks', 'ifRevision', 'folderId', 'limit']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--launch') { options.launch = true; continue; }
    if (arg === '--blocks-json') { params.stdin = true; params.raw = true; continue; }
    let key, value;
    const equal = arg.indexOf('=');
    if (equal > 0) { key = arg.slice(0, equal).replace(/^--/, ''); value = arg.slice(equal + 1); }
    else if (arg.startsWith('--')) {
      key = arg.slice(2);
      if (flags.has(key)) value = true;
      else { value = args[++i]; if (value === undefined) throw new Error(`${arg} requires a value`); }
    } else if (!command) { command = arg; continue; }
    else if (flags.has(arg)) { key = arg; value = true; }
    else throw new Error(`Unexpected argument: ${arg}. Use key=value parameters.`);
    key = ({ 'if-revision': 'ifRevision', 'folder-id': 'folderId' })[key] || key;
    if (!valued.has(key) && !flags.has(key)) throw new Error(`Unknown parameter: ${key}`);
    if (['socket', 'format', 'timeout'].includes(key)) options[key] = value;
    else params[key] = value;
  }
  options.timeout = Number(options.timeout);
  if (!Number.isInteger(options.timeout) || options.timeout < 100 || options.timeout > 120000) throw new Error('Timeout must be 100–120000 ms');
  if (!['json', 'markdown'].includes(options.format)) throw new Error('Format must be json or markdown');
  if (options.format === 'markdown' && !['read', 'daily:read'].includes(command)) throw new Error('Markdown format is supported by read and daily:read');
  if (params.content !== undefined) params.content = String(params.content).replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  return { command, params, options };
}

function request(socket, payload, timeout) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socket);
    let connected = false, size = 0, buffer = '';
    const finish = (error, value) => { client.destroy(); error ? reject(error) : resolve(value); };
    client.setTimeout(timeout, () => finish(Object.assign(new Error('GUI request timed out. A dispatched edit may already have applied; read the note before retrying.'), { code: 'TIMEOUT' })));
    client.setEncoding('utf8');
    client.on('connect', () => { connected = true; client.end(JSON.stringify(payload) + '\n'); });
    client.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > 32 * 1024 * 1024) return finish(Object.assign(new Error('GUI response exceeds 32 MiB'), { code: 'RESPONSE_TOO_LARGE' }));
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      try {
        const response = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
        if (response.schemaVersion !== 1 || (!('data' in response) && !response.error)) throw new Error('Invalid GUI response');
        finish(null, response);
      } catch (error) { finish(Object.assign(error, { code: 'INVALID_RESPONSE' })); }
    });
    client.on('error', error => {
      const missing = ['ENOENT', 'ECONNREFUSED'].includes(error.code);
      const denied = ['EACCES', 'EPERM'].includes(error.code);
      const message = connected ? `Connection lost: ${error.message}. Read before retrying an edit.`
        : denied ? `Access to the Logia CLI endpoint ${socket} was denied (${error.code}). The app may be running; check the agent's sandbox permissions.`
          : `Could not connect to the Logia CLI endpoint ${socket} (${error.code || error.message}). ${missing ? 'The app may be closed or the CLI endpoint may be different.' : 'Check the local CLI connection.'}`;
      finish(Object.assign(new Error(message), { code: connected ? 'CONNECTION_LOST' : denied ? 'ACCESS_DENIED' : missing ? 'GUI_NOT_RUNNING' : 'CLI_CONNECTION_FAILED' }));
    });
    client.on('end', () => { if (!buffer.includes('\n')) finish(Object.assign(new Error('GUI closed before replying; an edit may have applied. Read before retrying.'), { code: 'CONNECTION_LOST' })); });
  });
}

async function main() {
  const { command, params, options } = parse(process.argv.slice(2));
  if (!command || command === 'help' || params.help) { console.log(JSON.stringify({ schemaVersion: 1, data: help }, null, 2)); return; }
  if (!COMMANDS.includes(command)) throw new Error(`Unknown command: ${command}`);
  if (params.stdin) {
    if (params.content !== undefined || params.blocks !== undefined) throw new Error('Use stdin or an inline payload, not both');
    const chunks = []; let size = 0;
    for await (const chunk of process.stdin) { size += chunk.length; if (size > 1024 * 1024) throw new Error('Input exceeds 1 MiB'); chunks.push(chunk); }
    params[params.raw ? 'blocks' : 'content'] = Buffer.concat(chunks).toString('utf8');
  }
  delete params.stdin; delete params.raw; delete params.help;
  const payload = { version: 1, command, params };
  if (Buffer.byteLength(JSON.stringify(payload)) > 2 * 1024 * 1024 - 1) throw new Error('Request exceeds 2 MiB');
  let response;
  try { response = await request(options.socket, payload, options.timeout); }
  catch (error) {
    if (!options.launch || error.code !== 'GUI_NOT_RUNNING') throw error;
    const app = spawn(process.env.LOGIA_APP_BINARY || 'logia', [], { detached: true, stdio: 'ignore', shell: false });
    const started = new Promise((resolve, reject) => { app.once('spawn', resolve); app.once('error', reject); });
    await started; app.unref();
    const deadline = Date.now() + Math.min(options.timeout, 10000);
    while (true) {
      try { response = await request(options.socket, payload, options.timeout); }
      catch (retry) { if (retry.code !== 'GUI_NOT_RUNNING' || Date.now() >= deadline) throw retry; }
      if (response && response.error?.code !== 'GUI_NOT_READY') break;
      // Not-ready replies guarantee dispatch has not happened. Never retry a sent edit otherwise.
      if (Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  if (response.error) { console.log(JSON.stringify(response, null, 2)); process.exitCode = 1; return; }
  if (options.format === 'markdown') {
    if (typeof response.data?.markdown !== 'string') throw new Error('This note has no Markdown representation');
    process.stdout.write(response.data.markdown);
  } else console.log(JSON.stringify(response, null, 2));
}

main().catch(error => { console.log(JSON.stringify(envelopeError(error.code || 'INVALID_REQUEST', error.message), null, 2)); process.exitCode = 1; });
