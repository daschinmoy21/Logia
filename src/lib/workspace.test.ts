import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNoteText, getNoteTags, getNoteHeadings, getWikiLinks, resolveWikiLink, getBacklinks, searchWorkspaceNotes, dailyNoteTitle, notePath } from './workspace.ts';
import { noteToMarkdown } from './note-markdown.ts';
import type { Note, Folder } from '../types/Note.ts';

const note = (id: string, title: string, content: string, extra: Partial<Note> = {}): Note => ({ id, title, content, created_at: '2026-01-01', updated_at: '2026-01-01', ...extra });
const blocks = JSON.stringify([
  { id: 'h1', type: 'heading', props: { level: 1 }, content: 'Garden' },
  { id: 'p1', type: 'paragraph', props: { backgroundColor: 'metadata-not-content' }, content: [
    { type: 'text', text: '#Ideas [[Seeds#Care|growing]] ', styles: {} },
    { type: 'text', text: '#ignore [[Ignore]]', styles: { code: true } },
  ], children: [{ id: 'h2', type: 'heading', props: { level: 2 }, content: 'Care' }] },
  { type: 'codeBlock', content: '#code [[Fake]]' },
  { type: 'image', props: { url: 'data:image/png;base64,secrethugeimage' } },
  { type: 'table', content: { type: 'tableContent', rows: [{ cells: [[{ text: 'Water' }], { content: [{ text: 'Daily' }] }] }] } },
]);

test('human search reads nested text and tables, excludes IDs, props, and image data', () => {
  const text = getNoteText(blocks);
  assert.match(text, /Garden/);
  assert.match(text, /Care/);
  assert.match(text, /Water \| Daily/);
  assert.doesNotMatch(text, /secrethugeimage|metadata-not-content|h1/);
  assert.equal(getNoteText('plain markdown'), 'plain markdown');
});

test('knowledge index excludes inline code, fenced code and embeds', () => {
  assert.deepEqual(getNoteTags(blocks), ['ideas']);
  assert.deepEqual(getWikiLinks(blocks), [{ target: 'Seeds', heading: 'Care', alias: 'growing' }]);
  assert.deepEqual(getWikiLinks('![[picture.png]] `[[Code]]`\n```md\n[[Fenced]]\n```\n[[Real]]'), [{ target: 'Real', heading: undefined, alias: undefined }]);
  assert.deepEqual(getNoteHeadings(blocks), [{ id: 'h1', text: 'Garden', level: 1 }, { id: 'h2', text: 'Care', level: 2 }]);
});

test('frontmatter tags and aliases survive import representation', () => {
  const content = JSON.stringify([{ type: 'heading', content: 'Seeds' }, { type: 'codeBlock', props: { language: 'yaml' }, content: 'tags:\n  - garden\n  - "plants/growing"\naliases: [Seedlings, Sprouts]' }]);
  assert.deepEqual(getNoteTags(content), ['garden', 'plants/growing']);
  assert.equal(resolveWikiLink('Sprouts', [note('s', 'Seeds', content)])?.id, 's');
  assert.deepEqual(getNoteTags('---\ntags: [one, two]\n---\n#three'), ['one', 'three', 'two']);
  assert.match(noteToMarkdown(content), /^---\ntags:/);
});

test('ambiguous links stay unresolved, folder paths resolve, cycles terminate', () => {
  const folders: Folder[] = [{ id: 'f', name: 'Garden', parent_id: 'f', created_at: '', updated_at: '' }];
  const a = note('a', 'Seeds', '[]');
  const b = note('b', 'Seeds', '[]', { folder_id: 'f' });
  assert.equal(resolveWikiLink('Seeds', [a, b], folders), undefined);
  assert.equal(resolveWikiLink('Garden/Seeds.md', [a, b], folders)?.id, 'b');
  assert.equal(notePath(b, folders), 'Garden/Seeds');
  const source = note('c', 'Plan', '[[Garden/Seeds|seeds]]');
  assert.deepEqual(getBacklinks(b, [a, b, source], folders).map((n) => n.id), ['c']);
});

test('search combines text, quoted phrases, tags, and type filters', () => {
  const notes = [note('a', 'Garden', blocks, { starred: true }), note('b', 'Board', '{"camera":"metadata"}', { note_type: 'canvas' })];
  assert.deepEqual(searchWorkspaceNotes('#ideas is:starred water', notes).map((n) => n.id), ['a']);
  assert.deepEqual(searchWorkspaceNotes('metadata-not-content', notes), []);
  assert.deepEqual(searchWorkspaceNotes('camera', notes), []);
  assert.deepEqual(searchWorkspaceNotes('is:canvas', notes).map((n) => n.id), ['b']);
  assert.deepEqual(searchWorkspaceNotes('"no matching phrase"', notes), []);
});

test('daily note uses local calendar components', () => {
  assert.equal(dailyNoteTitle(new Date(2026, 0, 2, 0, 1)), '2026-01-02');
});

test('Markdown exporter supports checked tasks, tables, nesting, and safe code fences', () => {
  const content = JSON.stringify([
    { type: 'checkListItem', props: { checked: true }, content: 'Done', children: [{ type: 'bulletListItem', content: 'Nested' }] },
    { type: 'codeBlock', props: { language: 'js' }, content: 'const fence = "```";' },
    { type: 'table', content: { rows: [{ cells: ['A', 'B'] }, { cells: ['one|two', 'three'] }] } },
  ]);
  const md = noteToMarkdown(content);
  assert.match(md, /- \[x\] Done\n\n  - Nested/);
  assert.match(md, /````js\n/);
  assert.match(md, /one\\\|two/);
});
