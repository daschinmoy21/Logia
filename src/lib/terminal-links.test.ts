import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpsLinkProvider, safeHttpsUrl } from './ai/terminal-links.ts';
import type { ILink } from '@xterm/xterm';

function fixture(rows: Array<{ text: string; wrapped?: boolean }>) {
  const lines = rows.map(row => ({
    isWrapped: !!row.wrapped,
    length: row.text.length,
    getCell: (i: number) => ({ getWidth: () => 1, getChars: () => row.text[i] }),
  }));
  return { buffer: { active: { length: lines.length, getLine: (i: number) => lines[i] } } } as unknown as Parameters<typeof createHttpsLinkProvider>[0];
}

test('terminal links allow HTTPS and reject script, file, insecure and credential URLs', () => {
  assert.equal(safeHttpsUrl('https://example.com/device'), 'https://example.com/device');
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'http://localhost/secret', 'https://name:password@example.com']) assert.equal(safeHttpsUrl(url), null);
});

test('wrapped terminal login links have a spanning range and only open after a click', () => {
  const opened: string[] = [];
  const provider = createHttpsLinkProvider(fixture([{ text: 'Open https://example.' }, { text: 'com/device', wrapped: true }]), uri => opened.push(uri));
  let links: ILink[] = [];
  provider.provideLinks(2, result => { links = result ?? []; });
  assert.equal(links.length, 1);
  assert.deepEqual(links[0].range, { start: { x: 6, y: 1 }, end: { x: 10, y: 2 } });
  assert.deepEqual(opened, []);
  links[0].activate({} as MouseEvent, links[0].text);
  assert.deepEqual(opened, ['https://example.com/device']);
});
