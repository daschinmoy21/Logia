import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useNotesStore } from '../src/store/notesStore.ts';

test('notes save and navigation preserve new edits, failures, and daily-note identity', async () => {
  const storage = new Map<string, string>();
  let quotaFailure = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (quotaFailure) throw new Error('Quota exceeded');
      storage.set(key, value);
    },
  } });
  const store = useNotesStore;
  const original = await store.getState().createNote('text', undefined, { title: 'Original' });
  store.getState().updateCurrentNoteContent('first edit');
  const saving = store.getState().saveCurrentNote();
  store.getState().updateCurrentNoteContent('second edit');
  await saving;
  assert.ok(store.getState().saveTimeout, 'an older response must not clear a newer debounce');
  const second = await store.getState().createNote('text', undefined, { title: 'Second' });
  assert.equal(store.getState().notes.find((n) => n.id === original.id)?.content, 'second edit');
  const disk = JSON.parse(storage.values().next().value!);
  assert.equal(disk.notes.find((n: { id: string }) => n.id === original.id)?.content, 'second edit');
  store.getState().updateCurrentNoteContent('not saved yet');
  quotaFailure = true;
  await assert.rejects(store.getState().selectNote(original), /Quota/);
  assert.equal(store.getState().currentNote?.id, second.id, 'a failed flush must keep the edited note open');
  assert.match(store.getState().saveError || '', /Quota/);
  assert.equal(store.getState().isSaving, false);
  quotaFailure = false;
  await store.getState().saveCurrentNote();
  assert.equal(store.getState().saveError, null);
  await store.getState().selectNote(original);
  assert.equal(store.getState().currentNote?.content, 'second edit');
  const renaming = store.getState().updateNote(original.id, { title: 'Renamed' });
  store.getState().updateCurrentNoteContent('typed during a rename');
  await renaming;
  assert.equal(store.getState().currentNote?.content, 'typed during a rename');
  await store.getState().saveCurrentNote();
  const starring = store.getState().toggleStar(original.id);
  store.getState().updateCurrentNoteContent('typed while starring');
  const concurrentSave = store.getState().saveCurrentNote();
  await Promise.all([starring, concurrentSave]);
  assert.equal(store.getState().currentNote?.content, 'typed while starring');
  const afterStar = JSON.parse(storage.values().next().value!);
  assert.equal(afterStar.notes.find((n: { id: string }) => n.id === original.id)?.starred, true);
  assert.equal(afterStar.notes.find((n: { id: string }) => n.id === original.id)?.content, 'typed while starring');
  await Promise.all([store.getState().toggleStar(original.id), store.getState().toggleStar(original.id)]);
  assert.equal(store.getState().currentNote?.starred, true, 'two rapid clicks must preserve the original star state');
  const [daily1, daily2] = await Promise.all([store.getState().openDailyNote(), store.getState().openDailyNote()]);
  assert.equal(daily1.id, daily2.id, 'concurrent daily-note actions must create just one note');
  assert.match(daily1.title, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(daily1.content, /#daily/);
  assert.equal((await store.getState().openDailyNote()).id, daily1.id);
  // Browser operations must not turn desktop trash into irreversible deletion.
  await assert.rejects(store.getState().deleteNote(original.id), /desktop/);
  assert.ok(store.getState().notes.some((n) => n.id === original.id));
});
