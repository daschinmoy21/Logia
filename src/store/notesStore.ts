import { create } from 'zustand';
import { notesInvoke as invoke } from '../lib/notes-repository.ts';
import { dailyNoteTitle } from '../lib/workspace.ts';
import type { Note, Folder } from '../types/Note.ts';
import { openCreatedNote } from '../lib/note-utils.ts';

interface NotesState {
  notes: Note[];
  folders: Folder[];
  currentNote: Note | null;
  isLoading: boolean;
  loadError: string | null;
  folderLoadError: string | null;
  saveTimeout: NodeJS.Timeout | null;
  isSaving: boolean;
  saveError: string | null;
  externalSaveErrors: Record<string, string>;
  loadNotes: () => Promise<void>;
  loadFolders: () => Promise<void>;
  selectNote: (note: Note | null) => Promise<void>;
  createNote: (noteType?: 'text' | 'canvas', folderId?: string, initial?: { title?: string; content?: string; open?: boolean }) => Promise<Note>;
  openDailyNote: () => Promise<Note>;
  createFolder: (name: string, parentId?: string) => Promise<Folder>;
  updateNote: (id: string, updates: Partial<Note>) => Promise<void>;
  applyExternalNote: (id: string, updates: { content?: string; title?: string }) => Promise<void>;
  updateFolder: (id: string, updates: Partial<Folder>) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  toggleStar: (id: string) => Promise<void>;
  updateCurrentNoteContent: (content: string) => void;
  updateCurrentNoteTitle: (title: string) => void;
  saveCurrentNote: () => Promise<void>;
  /** The root folder daily notes are created in, made on first use. */
  ensureDailyFolder: () => Promise<Folder>;
}

// Serialize writes so older saves cannot land after newer ones.
let saveQueue: Promise<unknown> = Promise.resolve();
let activeSaves = 0;
let openingDaily: Promise<Note> | null = null;
let creatingDailyFolder: Promise<Folder> | null = null;
const DAILY_FOLDER = 'Daily';
const starQueues = new Map<string, Promise<void>>();
function writeNote(note: Note, preferLatest = false): Promise<void> {
  const next = saveQueue.catch(() => {}).then(() => {
    const latest = preferLatest ? useNotesStore.getState().notes.find((n) => n.id === note.id) : note;
    return latest ? invoke<void>('save_note', { note: latest }) : undefined;
  });
  saveQueue = next;
  return next;
}

// Auto-save on window blur to ensure changes are saved
if (typeof window !== 'undefined') {
  window.addEventListener('blur', () => {
    // Get the current state and save if there's a pending timeout
    const timeout = useNotesStore.getState().saveTimeout;
    if (timeout) {
      clearTimeout(timeout);
      void useNotesStore.getState().saveCurrentNote().catch(() => {});
    }
  });
}

export const useNotesStore = create<NotesState>()(
  (set, get) => ({
    notes: [],
    folders: [],
    currentNote: null,
    isLoading: false,
    loadError: null,
    folderLoadError: null,
    saveTimeout: null,
    isSaving: false,
    saveError: null,
    externalSaveErrors: {},

    loadNotes: async () => {
      set({ isLoading: true, loadError: null });
      try {
        // Get notes from Tauri backend
        const notes: Note[] = await invoke('get_all_notes');
        set({ notes, isLoading: false });
      } catch (error) {
        console.error('Failed to load notes:', error);
        set({ isLoading: false, loadError: String(error) });
      }
    },

    loadFolders: async () => {
      set({ folderLoadError: null });
      try {
        const folders: Folder[] = await invoke('get_all_folders');
        set({ folders });
      } catch (error) {
        console.error('Failed to load folders:', error);
        set({ folderLoadError: String(error) });
      }
    },

    selectNote: async (note) => {
      // Save current note before switching
      const currentState = get();
      if (currentState.saveTimeout || currentState.saveError || currentState.isSaving) {
        if (currentState.saveTimeout) clearTimeout(currentState.saveTimeout);
        await get().saveCurrentNote();
      }
      set({ currentNote: note ? get().notes.find((n) => n.id === note.id) || note : null, saveError: note ? get().externalSaveErrors[note.id] ?? null : null });
    },

    createNote: async (noteType = 'text', folderId, initial = {}) => {
      try {
        // Flush pending autosave before switching to the new note
        const pending = get().saveTimeout;
        if (pending || get().saveError || get().isSaving) {
          if (pending) clearTimeout(pending);
          await get().saveCurrentNote();
        }

        // Create initial content with a Heading 1 "Untitled" in a single backend call
        // (avoids a race between create_note + save_note)
        const title = initial.title || 'Untitled';
        const initialContent = initial.content ?? JSON.stringify([
          {
            id: crypto.randomUUID(),
            type: "heading",
            props: { level: 1 },
            content: title,
            children: []
          }
        ]);

        const newNote: Note = await invoke('create_note', {
          title,
          noteType,
          folderId,
          content: initialContent,
        });

        // Open the new note immediately so EmptyState / AI capture / sidebar create work
        set((state) => initial.open === false ? { notes: [newNote, ...state.notes] } : openCreatedNote(state.notes, newNote));

        return newNote;
      } catch (error) {
        console.error('Failed to create note:', error);
        throw error;
      }
    },

    createFolder: async (name, parentId) => {
      try {
        const newFolder: Folder = await invoke('create_folder', { name, parentId });

        set((state) => ({
          folders: [...state.folders, newFolder],
        }));

        return newFolder;
      } catch (error) {
        console.error('Failed to create folder:', error);
        throw error;
      }
    },

    updateNote: async (id, updates) => {
      try {
        // Find the note to update
        const state = get();
        const noteToUpdate = state.notes.find(note => note.id === id);
        if (!noteToUpdate) throw new Error('Note not found');

        // Create updated note
        const updatedNote = { ...noteToUpdate, ...updates, updated_at: new Date().toISOString() };

        // Save via Tauri backend
        await writeNote(updatedNote);

        // Only merge the requested fields: text typed while this write was in
        // flight must not be replaced by the older persistence snapshot.
        set((state) => ({
          notes: state.notes.map((note) =>
            note.id === id ? { ...note, ...updates, updated_at: updatedNote.updated_at } : note
          ),
          currentNote: state.currentNote?.id === id
            ? { ...state.currentNote, ...updates, updated_at: updatedNote.updated_at }
            : state.currentNote,
        }));
      } catch (error) {
        console.error('Failed to update note:', error);
        throw error;
      }
    },

    // Live CLI/editor integrations publish before awaiting IO. Human edits made
    // while persistence is in flight stay in the store and cannot be overwritten.
    applyExternalNote: async (id, updates) => {
      const note = get().notes.find(note => note.id === id);
      if (!note) throw new Error('Note not found');
      const updated = { ...note, ...updates, updated_at: new Date().toISOString() };
      set(state => ({
        notes: state.notes.map(note => note.id === id ? updated : note),
        currentNote: state.currentNote?.id === id ? updated : state.currentNote,
      }));
      try {
        if (get().currentNote?.id === id) await get().saveCurrentNote();
        else await writeNote(updated, true);
        set(state => { const errors = { ...state.externalSaveErrors }; delete errors[id]; return { externalSaveErrors: errors }; });
      } catch (error) {
        set(state => ({ externalSaveErrors: { ...state.externalSaveErrors, [id]: String(error) } }));
        throw error;
      }
    },

    updateFolder: async (id, updates) => {
      try {
        const state = get();
        const folderToUpdate = state.folders.find(folder => folder.id === id);
        if (!folderToUpdate) throw new Error('Folder not found');

        const updatedFolder = { ...folderToUpdate, ...updates, updated_at: new Date().toISOString() };

        await invoke('update_folder', { folder: updatedFolder });

        set((state) => ({
          folders: state.folders.map((folder) =>
            folder.id === id ? updatedFolder : folder
          ),
        }));
      } catch (error) {
        console.error('Failed to update folder:', error);
        throw error;
      }
    },

    deleteNote: async (id) => {
      try {
        // Delete via Tauri backend
        await invoke('delete_note', { noteId: id });

        // Update state
        set((state) => ({
          notes: state.notes.filter((note) => note.id !== id),
          currentNote: state.currentNote?.id === id ? null : state.currentNote,
        }));
      } catch (error) {
        console.error('Failed to delete note:', error);
        throw error;
      }
    },

    deleteFolder: async (id) => {
      try {
        await invoke('delete_folder', { folderId: id });

        // Collect all descendant folder IDs via BFS on parent_id chain
        const collectDescendants = (rootId: string, folders: Folder[]): string[] => {
          const descendants: string[] = [];
          const queue = folders.filter(f => f.parent_id === rootId).map(f => f.id);
          while (queue.length > 0) {
            const current = queue.shift()!;
            descendants.push(current);
            const children = folders.filter(f => f.parent_id === current).map(f => f.id);
            queue.push(...children);
          }
          return descendants;
        };

        set((state) => {
          const descendantIds = collectDescendants(id, state.folders);
          const allAffectedIds = [id, ...descendantIds];

          return {
            // Remove the folder and all nested descendants
            folders: state.folders.filter((folder) => !allAffectedIds.includes(folder.id)),
            // Remove notes in the folder and all descendant folders
            notes: state.notes.filter((note) => !note.folder_id || !allAffectedIds.includes(note.folder_id)),
            // Clear currentNote if it was in any affected folder
            currentNote: state.currentNote?.folder_id && allAffectedIds.includes(state.currentNote.folder_id)
              ? null
              : state.currentNote,
          };
        });
      } catch (error) {
        console.error('Failed to delete folder:', error);
        throw error;
      }
    },

    toggleStar: async (id) => {
      // Each click toggles the result of the previous click, even during slow IO.
      const action = (starQueues.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
        const note = get().notes.find((n) => n.id === id);
        if (!note) throw new Error('Note not found');
        // Metadata writes share the save queue with content writes.
        await get().updateNote(id, { starred: !note.starred });
      });
      starQueues.set(id, action);
      try {
        await action;
      } finally {
        if (starQueues.get(id) === action) starQueues.delete(id);
      }
    },

    updateCurrentNoteContent: (content: string) => {
      const state = get();

      if (state.currentNote) {
        // Clear any existing save timeout
        if (state.saveTimeout) {
          clearTimeout(state.saveTimeout);
        }

        // Update the current note content locally
        const updatedNote = { ...state.currentNote, content, updated_at: new Date().toISOString() };

        // Longer debounce for canvas notes (1500ms) vs text notes (600ms)
        const debounceMs = state.currentNote.note_type === 'canvas' ? 1500 : 600;
        const newTimeout = setTimeout(() => {
          void get().saveCurrentNote().catch(() => {});
        }, debounceMs);

        set((state) => ({
          currentNote: updatedNote,
          notes: state.notes.map((note) =>
            note.id === updatedNote.id ? updatedNote : note
          ),
          saveTimeout: newTimeout,
        }));
      }
    },

    updateCurrentNoteTitle: (title: string) => {
      const state = get();
      if (!state.currentNote || state.currentNote.title === title) return;
      const updatedNote = { ...state.currentNote, title, updated_at: new Date().toISOString() };
      if (state.saveTimeout) clearTimeout(state.saveTimeout);
      const saveTimeout = setTimeout(() => { void get().saveCurrentNote().catch(() => {}); }, 600);
      set((state) => ({
        currentNote: updatedNote,
        notes: state.notes.map((note) => note.id === updatedNote.id ? updatedNote : note),
        saveTimeout,
      }));
    },

    openDailyNote: () => {
      if (openingDaily) return openingDaily;
      openingDaily = (async () => {
        const title = dailyNoteTitle();
        const existing = get().notes.find((note) => note.note_type !== 'canvas' && note.title === title);
        if (existing) {
          await get().selectNote(existing);
          return existing;
        }
        const block = (type: string, content: string, level?: number) => ({
          id: crypto.randomUUID(), type, content, props: level ? { level } : {}, children: [],
        });
        const folder = await get().ensureDailyFolder();
        return get().createNote('text', folder.id, {
          title,
          content: JSON.stringify([
            block('heading', title, 1), block('paragraph', '#daily'),
            block('heading', 'Intentions', 2), block('bulletListItem', ''),
            block('heading', 'Notes', 2), block('paragraph', ''),
          ]),
        });
      })().finally(() => { openingDaily = null; });
      return openingDaily;
    },

    ensureDailyFolder: () => {
      if (creatingDailyFolder) return creatingDailyFolder;
      creatingDailyFolder = (async () => {
        // An unread folder list can't prove the folder is missing, and guessing would duplicate it.
        if (get().folderLoadError) await get().loadFolders();
        const loadError = get().folderLoadError;
        if (loadError) throw new Error(loadError);
        return get().folders.find((folder) => folder.name === DAILY_FOLDER && folder.parent_id == null)
          ?? await get().createFolder(DAILY_FOLDER);
      })().finally(() => { creatingDailyFolder = null; });
      return creatingDailyFolder;
    },

    saveCurrentNote: async () => {
      const state = get();
      const snapshot = state.currentNote;
      if (!snapshot) return;
      if (state.saveTimeout) clearTimeout(state.saveTimeout);
      activeSaves += 1;
      set({ saveTimeout: null, isSaving: true });
      try {
        await writeNote(snapshot, true);
        set(state => { const errors = { ...state.externalSaveErrors }; delete errors[snapshot.id]; return { saveError: null, externalSaveErrors: errors }; });
      } catch (error) {
        set({ saveError: String(error) });
        throw error;
      } finally {
        activeSaves -= 1;
        set({ isSaving: activeSaves > 0 });
      }
    },
  })
);
