import { useNotesStore } from '../../store/notesStore';
import { getNoteText } from '../../lib/workspace';
import type { Note } from '../../types/Note';

/** What note lists show. Typing changes neither, so lists can ignore each keystroke. */
export type NoteMeta = Pick<Note, 'id' | 'title' | 'folder_id' | 'note_type' | 'starred'>;

const sameMeta = (a: NoteMeta, b: NoteMeta) =>
  a.id === b.id && a.title === b.title && a.folder_id === b.folder_id && a.note_type === b.note_type && a.starred === b.starred;

let metaCache: { source: Note[]; value: NoteMeta[] } = { source: [], value: [] };

function noteMeta(notes: Note[]): NoteMeta[] {
  if (metaCache.source === notes) return metaCache.value;
  const previous = metaCache.value;
  const unchanged = previous.length === notes.length && notes.every((note, i) => sameMeta(note, previous[i]));
  if (unchanged) {
    metaCache = { source: notes, value: previous };
    return previous;
  }
  // Unchanged notes keep their object, so memoized rows skip them on a rename.
  const previousById = new Map(previous.map((meta) => [meta.id, meta]));
  const value = notes.map(({ id, title, folder_id, note_type, starred }) => {
    const meta: NoteMeta = { id, title, folder_id, note_type, starred };
    const known = previousById.get(id);
    return known && sameMeta(known, meta) ? known : meta;
  });
  metaCache = { source: notes, value };
  return value;
}

/** Stable until a list-visible field changes, unlike `state.notes`, which changes per keystroke. */
export const useNoteMeta = () => useNotesStore((state) => noteMeta(state.notes));

/** Lists hold metadata only; get the full, current note when something acts on it. */
export const findNote = (id: string) => useNotesStore.getState().notes.find((note) => note.id === id);

/** Every aliases block in the note. May include look-alikes in the body, which only costs a refresh. */
const aliasText = (content: string) =>
  content.includes('aliases:') ? getNoteText(content).match(/^aliases:[^\n]*(?:\n[ \t]+-\s[^\n]*)*/gm)?.join('\n') ?? '' : '';

const sameLinkTarget = (a: Note, b: Note) =>
  a.id === b.id && a.title === b.title && a.folder_id === b.folder_id && aliasText(a.content) === aliasText(b.content);

let linkCache: { source: Note[]; activeId: string | undefined; value: Note[] } = { source: [], activeId: undefined, value: [] };

function linkNotes(notes: Note[], activeId: string | undefined): Note[] {
  if (linkCache.source === notes && linkCache.activeId === activeId) return linkCache.value;
  const previous = linkCache.value;
  const unchanged = previous.length === notes.length && notes.every((note, i) =>
    note === previous[i] || (note.id === activeId && sameLinkTarget(note, previous[i])));
  linkCache = { source: notes, activeId, value: unchanged ? previous : notes };
  return linkCache.value;
}

/**
 * The workspace for resolving links and backlinks. Backlinks never read the active note's
 * text and links only use its name, path and aliases, so its body can lag behind while
 * typing. Other notes are always current. Use `findNote` or the store to read a note's text.
 */
export const useLinkNotes = (activeId: string | undefined) =>
  useNotesStore((state) => linkNotes(state.notes, activeId));
