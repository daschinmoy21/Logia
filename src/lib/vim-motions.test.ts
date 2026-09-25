import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  nextWordStart,
  prevWordStart,
  wordEnd,
  firstNonBlank,
  findInLine,
  textObject,
  searchText,
} from './vim/motions.ts';

test('w moves to the next word start, across punctuation and lines', () => {
  const s = 'hello world, foo\nbar';
  assert.equal(nextWordStart(s, 0), 6);
  assert.equal(nextWordStart(s, 6), 11); // ","
  assert.equal(nextWordStart(s, 11), 13); // "foo"
  assert.equal(nextWordStart(s, 13), 17); // next line "bar"
  assert.equal(nextWordStart(s, 17), 19); // clamps at end
});

test('W treats punctuation as part of the WORD', () => {
  assert.equal(nextWordStart('foo.bar baz', 0, true), 8);
});

test('w stops on empty lines', () => {
  assert.equal(nextWordStart('a\n\nb', 0), 2);
  assert.equal(nextWordStart('a\n\nb', 2), 3);
});

test('e and b', () => {
  const s = 'hello world';
  assert.equal(wordEnd(s, 0), 4);
  assert.equal(wordEnd(s, 4), 10);
  assert.equal(prevWordStart(s, 10), 6);
  assert.equal(prevWordStart(s, 6), 0);
  assert.equal(prevWordStart(s, 0), 0);
});

test('^ finds the first non-blank', () => {
  assert.equal(firstNonBlank('   x'), 3);
  assert.equal(firstNonBlank(''), 0);
});

test('f/t/F/T', () => {
  const line = 'a,b,c,d';
  assert.equal(findInLine(line, 0, ',', 'f'), 1);
  assert.equal(findInLine(line, 0, ',', 'f', 2), 3);
  assert.equal(findInLine(line, 0, ',', 't'), 0);
  assert.equal(findInLine(line, 0, ',', 't', 2), 2);
  assert.equal(findInLine(line, 6, ',', 'F'), 5);
  assert.equal(findInLine(line, 6, ',', 'T'), 6);
  assert.equal(findInLine(line, 6, ',', 'T', 2), 4);
  assert.equal(findInLine(line, 0, 'z', 'f'), -1);
});

test('text objects', () => {
  assert.deepEqual(textObject('foo bar baz', 5, 'w', false), [4, 7]);
  assert.deepEqual(textObject('foo bar baz', 5, 'w', true), [4, 8]);
  assert.deepEqual(textObject('say "hi there" ok', 7, '"', false), [5, 13]);
  assert.deepEqual(textObject('say "hi there" ok', 7, '"', true), [4, 14]);
  assert.deepEqual(textObject('f(a, (b), c)', 3, '(', false), [2, 11]);
  assert.deepEqual(textObject('f(a, (b), c)', 6, 'b', true), [5, 8]);
  assert.equal(textObject('no parens', 2, '(', false), null);
});

test('search with smart-case and wrap', () => {
  const s = 'Foo bar foo';
  assert.deepEqual(searchText(s, 'foo', 0), [8, false]);
  assert.deepEqual(searchText(s, 'foo', 8), [0, true]);
  assert.deepEqual(searchText(s, 'Foo', 0), [0, true]);
  assert.deepEqual(searchText(s, 'foo', 8, true), [0, false]);
  assert.equal(searchText(s, 'zzz', 0), null);
});
