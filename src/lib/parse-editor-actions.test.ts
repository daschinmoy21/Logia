import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEditorActions } from './parse-editor-actions.ts';

const action = (text: string) => ({ type: 'editor_action', action: 'insertText', description: 'Add text', data: { text } });

test('extracts action arrays and adjacent objects without confusing quoted braces or escapes', () => {
  const first = action('Code: { "x": "a\\b" } and ]');
  const second = action('Next paragraph');
  const result = parseEditorActions(`Applying these:\n\`\`\`json\n${JSON.stringify([first])}\n\`\`\`\n${JSON.stringify(second)}`);
  assert.deepEqual(result.actions, [first, second]);
  assert.equal(result.text, 'Applying these:');
});

test('keeps ordinary JSON and incomplete actions visible', () => {
  const content = 'Example: [1, 2] {"test": true}. {"type":"editor_action","action":"insertText"';
  assert.deepEqual(parseEditorActions(content), { actions: [], text: content });
});

test('finds actions after prose brackets and rejects unknown action names', () => {
  const known = action('Valid');
  const unknown = JSON.stringify({ ...known, action: 'runCommand' });
  const result = parseEditorActions(`[unfinished prose ${unknown}\n${JSON.stringify(known)}`);
  assert.deepEqual(result.actions, [known]);
  assert.ok(result.text.includes(unknown));
});
