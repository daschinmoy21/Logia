import { create } from 'zustand';
import { useNotesStore } from '../store/notesStore';
import type { Note } from '../types/Note';
import { useSnackbar, showSnackbar } from './snackbar';

/** Notes deleted from the phone stay hidden for a few seconds before they're really removed, so undo is instant. */
export const usePendingDeletes = create<{ ids: string[] }>()(() => ({ ids: [] }));

const unhide = (id: string) => usePendingDeletes.setState((s) => ({ ids: s.ids.filter((other) => other !== id) }));
const commits = new Map<string, () => void>();

const describe = (error: unknown) => {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
};

export async function deleteWithUndo(note: Note) {
  const notes = useNotesStore.getState();
  if (notes.currentNote?.id === note.id) await notes.selectNote(null);
  usePendingDeletes.setState((s) => ({ ids: [...s.ids, note.id] }));

  const commit = () => {
    commits.delete(note.id);
    useNotesStore.getState().deleteNote(note.id).then(
      () => unhide(note.id),
      (error) => {
        unhide(note.id);
        showSnackbar(`Couldn't delete “${note.title || 'Untitled'}”: ${describe(error)}`);
      },
    );
  };
  commits.set(note.id, commit);

  useSnackbar.getState().show({
    message: 'Note deleted',
    actionLabel: 'Undo',
    duration: 5000,
    onClose: (reason) => {
      if (!commits.has(note.id)) return;
      if (reason === 'action') {
        commits.delete(note.id);
        unhide(note.id);
      } else {
        commit();
      }
    },
  });
}

/** Leaving the app (or the page) settles pending deletes instead of dropping them. */
export function flushPendingDeletes() {
  for (const commit of [...commits.values()]) commit();
  if (useSnackbar.getState().snack) useSnackbar.setState({ snack: null });
}

export async function toggleFavorite(note: Pick<Note, 'id' | 'starred'>) {
  try {
    await useNotesStore.getState().toggleStar(note.id);
  } catch (error) {
    showSnackbar(`Couldn't update favorites: ${describe(error)}`);
  }
}

/** A fresh note opens with an empty title line, ready to type into. */
export async function createMobileNote() {
  const block = (type: string, props: Record<string, unknown> = {}) => ({ id: crypto.randomUUID(), type, props, content: '', children: [] });
  try {
    return await useNotesStore.getState().createNote('text', undefined, {
      title: 'Untitled',
      content: JSON.stringify([block('heading', { level: 1 }), block('paragraph')]),
    });
  } catch (error) {
    showSnackbar(`Couldn't create a note: ${describe(error)}`);
    return null;
  }
}

export { describe as describeError };
