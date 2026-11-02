import test from 'node:test';
import assert from 'node:assert/strict';
import { executeGuiCommand } from './cli/gui.ts';
import { noteRevision } from './cli/protocol.ts';
import { useNotesStore } from '../store/notesStore.ts';
import type { Note } from '../types/Note.ts';

const note = (id: string, title: string, extra: Partial<Note> = {}): Note => ({ id, title, content: JSON.stringify([{ id: `${id}-title`, type: 'heading', props: { level: 1 }, content: title }, { id: `${id}-body`, type: 'paragraph', content: '#agents [[Other]]' }]), created_at: '2026-01-01', updated_at: '2026-01-01', note_type: 'text', ...extra });

test('live CLI revisions track content and metadata while ignoring persistence timestamps', async () => {
  const original = note('one', 'Plan');
  assert.equal(await noteRevision(original), await noteRevision({ ...original, updated_at: 'tomorrow' }));
  assert.notEqual(await noteRevision(original), await noteRevision({ ...original, content: 'changed' }));
  assert.notEqual(await noteRevision(original), await noteRevision({ ...original, title: 'Renamed' }));
});

test('live CLI uses current GUI state, resolves ambiguity, and rejects expired or unsafe operations', async () => {
  const first = note('one', 'Plan');
  const second = note('two', 'Plan', { folder_id: 'folder' });
  useNotesStore.setState({ notes: [first, second], folders: [{ id: 'folder', name: 'Projects', created_at: '', updated_at: '' }], currentNote: first, isLoading: false, loadError: null, folderLoadError: null });
  const run = (command: string, params: Record<string, string | boolean> = {}) => executeGuiCommand({ command, params });
  const read = await run('read');
  assert.ok('data' in read); assert.equal((read.data as Note).id, 'one');
  const ambiguous = await run('read', { file: 'Plan' });
  assert.ok('error' in ambiguous); assert.equal(ambiguous.error.code, 'AMBIGUOUS_TARGET');
  const path = await run('read', { path: 'Projects/Plan.md' });
  assert.ok('data' in path); assert.equal((path.data as Note).id, 'two');
  const traversal = await run('read', { path: '../Plan.md' });
  assert.ok('error' in traversal); assert.equal(traversal.error.code, 'INVALID_REQUEST');
  const required = await run('write', { content: 'Changed' });
  assert.ok('error' in required); assert.equal(required.error.code, 'REVISION_REQUIRED');
  const expired = await executeGuiCommand({ command: 'rename', params: { name: 'Too late' }, deadline: Date.now() - 1 });
  assert.ok('error' in expired); assert.equal(expired.error.code, 'TIMEOUT');
  assert.equal(useNotesStore.getState().currentNote?.title, 'Plan');
});
