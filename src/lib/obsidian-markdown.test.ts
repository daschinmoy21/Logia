import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  finishObsidianBlocks,
  prepareObsidianMarkdown,
  resolveAttachment,
  splitFrontmatter,
  withFilenameTitle,
  type ImportBlock,
} from './obsidian-markdown.ts';

let n = 0;
const id = () => `id${n++}`;
const text = (value: string, styles: Record<string, unknown> = {}) => ({ type: 'text', text: value, styles });
const para = (...content: unknown[]): ImportBlock => ({ type: 'paragraph', content, children: [] });

test('frontmatter is split off and CRLF normalized', () => {
  assert.deepEqual(splitFrontmatter('﻿---\r\ntags: [a]\r\n---\r\nBody'), { yaml: 'tags: [a]', body: 'Body' });
  assert.deepEqual(splitFrontmatter('No yaml'), { yaml: null, body: 'No yaml' });
});

test('wikilinks are tokenized so the Markdown parser cannot read underscores as emphasis', () => {
  const out = prepareObsidianMarkdown('See [[my_note_name|alias]] and [[Other#Head]].');
  assert.equal(out.markdown, 'See LOGIAWL0Z and LOGIAWL1Z.');
  assert.deepEqual(out.links, ['my_note_name|alias', 'Other#Head']);
});

test('code is never rewritten', () => {
  const source = 'Use `[[x]]` and `==y==`\n```md\n[[Fenced]] %%keep%% ![[a.png]]\n```\nafter %%gone%% [[Real]]';
  const out = prepareObsidianMarkdown(source);
  assert.equal(out.markdown, 'Use `[[x]]` and `==y==`\n```md\n[[Fenced]] %%keep%% ![[a.png]]\n```\nafter  LOGIAWL0Z');
  assert.deepEqual(out.links, ['Real']);
});

test('comments, block ids and callouts', () => {
  const out = prepareObsidianMarkdown('a %%one\ntwo%% b\nline ^abc-1\n^solo\n> [!warning]- Careful now\n> body\n> [!tip]\n> x');
  assert.equal(out.markdown, 'a  b\nline\n\n> **Careful now**\n> body\n> **Tip**\n> x');
});

test('image embeds become image refs; note embeds become links', () => {
  const out = prepareObsidianMarkdown('![[pic.png|300]]\n![[Some Note#Part]]\n![alt|120](sub/My%20Pic.jpg)\n![web](https://x.test/a.png)');
  assert.equal(out.markdown, 'LOGIAIMG0Z\nLOGIAWL0Z\nLOGIAIMG1Z\n![web](https://x.test/a.png)');
  assert.deepEqual(out.links, ['Some Note#Part']);
  assert.deepEqual(out.images.map(({ target, width }) => ({ target, width })), [
    { target: 'pic.png', width: 300 },
    { target: 'sub/My Pic.jpg', width: 120 },
  ]);
});

test('finishing restores links, highlights, and swaps image-only paragraphs for image blocks', () => {
  const refs = [{ target: 'a/pic.png', original: '![[pic.png]]' }, { target: 'gone.png', original: '![[gone.png]]' }];
  const blocks = finishObsidianBlocks(
    [
      para(text('LOGIAIMG0Z')),
      para(text('Go to LOGIAWL0Z, it is ==very== good LOGIAIMG1Z')),
      { type: 'bulletListItem', content: [text('x LOGIAIMG0Z')], children: [para(text('LOGIAWL0Z'))] },
    ],
    ['Target_note'],
    refs,
    ['data:image/png;base64,AA', null],
    id,
  );
  assert.equal(blocks[0].type, 'image');
  assert.deepEqual(blocks[0].props, { url: 'data:image/png;base64,AA', name: 'pic.png', caption: '' });
  assert.deepEqual(blocks[1].content, [
    text('Go to [[Target_note]], it is '),
    text('very', { backgroundColor: 'yellow' }),
    text(' good ![[gone.png]]'),
  ]);
  assert.equal(blocks[2].type, 'bulletListItem');
  assert.deepEqual(blocks[2].children?.[0].content, [text('[[Target_note]]')]);
  assert.equal(blocks[3].type, 'image', 'an inline image lands right after its block');
});

test('title follows the filename, keeping a matching H1', () => {
  const h1 = { type: 'heading', props: { level: 1 }, content: [text('Daily Log')], children: [] };
  assert.equal(withFilenameTitle([h1], 'daily log', id).length, 1);
  const added = withFilenameTitle([h1], '2026-01-01', id);
  assert.equal(added.length, 2);
  assert.deepEqual(added[0].content, [text('2026-01-01')]);
});

test('attachments resolve relative, then from root, then by shortest matching name', () => {
  const files = ['assets/pic.png', 'deep/x/assets/pic.png', 'notes/img/local.png', 'Pic Two.PNG'];
  assert.equal(resolveAttachment('img/local.png', 'notes/a.md', files), 'notes/img/local.png');
  assert.equal(resolveAttachment('../notes/img/local.png', 'other/b.md', files), 'notes/img/local.png');
  assert.equal(resolveAttachment('pic.png', 'notes/a.md', files), 'assets/pic.png');
  assert.equal(resolveAttachment('pic two.png', 'a.md', files), 'Pic Two.PNG');
  assert.equal(resolveAttachment('missing.png', 'a.md', files), null);
});
