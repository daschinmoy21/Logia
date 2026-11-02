import test from 'node:test';
import assert from 'node:assert/strict';
import { initialComposerVim, composerVimEscape, composerVimKey, composerCursorPosition, type ComposerVimState } from './vim/composerVim.ts';

function normal(text: string, cursor = 0): ComposerVimState {
  return { ...initialComposerVim('normal'), text, cursor };
}
const keys = (state: ComposerVimState, input: string) => [...input].reduce(composerVimKey, state);

test('composer Vim deletes words, undoes, and changes a word without consuming its separator', () => {
  const deleted = keys(normal('alpha beta gamma'), 'dw');
  assert.equal(deleted.text, 'beta gamma');
  assert.equal(keys(deleted, 'u').text, 'alpha beta gamma');
  const changed = keys(normal('alpha beta'), 'cw');
  assert.equal(changed.text, ' beta');
  assert.equal(changed.mode, 'insert');
});

test('composer Vim line operations retain the other lines and paste from its own register', () => {
  const deleted = keys(normal('one\ntwo\nthree', 4), 'dd');
  assert.equal(deleted.text, 'one\nthree');
  assert.equal(keys(deleted, 'P').text, 'one\ntwo\nthree');
  assert.equal(keys(normal('one\ntwo\nthree'), '2dd').text, 'three');
});

test('composer Vim insert and append positions, Escape, and cursor row/column', () => {
  const appended = keys(normal('alpha\nbeta'), 'A');
  assert.equal(appended.mode, 'insert');
  assert.equal(appended.cursor, 5);
  assert.equal(composerVimEscape(appended).cursor, 4);
  const below = keys(normal('alpha\nbeta'), 'o');
  assert.equal(below.text, 'alpha\n\nbeta');
  assert.equal(below.cursor, 6);
  assert.deepEqual(composerCursorPosition(below.text, below.cursor), { row: 2, col: 1 });
});

test('composer Vim deletes complete Unicode code points', () => {
  const deleted = keys(normal('😀x'), 'x');
  assert.equal(deleted.text, 'x');
  assert.equal(deleted.cursor, 0);
  assert.equal(keys(normal('😀x'), 'l').cursor, 2);
});

test('composer Vim bounds long numeric prefixes and paste expansion', () => {
  const prefixed = keys(normal('a\nb'), '9'.repeat(200));
  assert.ok(prefixed.count.length <= 6, 'numeric prefixes must stay bounded');
  const moved = composerVimKey(prefixed, 'l');
  assert.ok(moved.cursor < moved.text.length);
  const paste = { ...normal('x'), register: { text: 'a'.repeat(2048), linewise: false } };
  const result = keys(paste, '999999p');
  assert.ok(result.text.length <= 1024 * 1024 + 1, 'paste must have a bounded expansion');
});
