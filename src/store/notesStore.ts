import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { Note, Folder } from '../types/Note';

interface NotesState {
  notes: Note[];
  folders: Folder[];
  currentNote: Note | null;
  isLoading: boolean;
  saveTimeout: NodeJS.Timeout | null;
  loadNotes: () => Promise<void>;
  loadFolders: () => Promise<void>;
  selectNote: (note: Note) => void;
  createNote: (noteType?: 'text' | 'canvas', folderId?: string) => Promise<Note>;
  createFolder: (name: string, parentId?: string) => Promise<Folder>;
  updateNote: (id: string, updates: Partial<Note>) => Promise<void>;
  updateFolder: (id: string, updates: Partial<Folder>) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  updateCurrentNoteContent: (content: string) => void;
  updateCurrentNoteTitle: (title: string) => void;
  saveCurrentNote: () => Promise<void>;
}

// Auto-save on window blur to ensure changes are saved
if (typeof window !== 'undefined') {
  window.addEventListener('blur', () => {
    // Get the current state and save if there's a pending timeout
    const timeout = useNotesStore.getState().saveTimeout;
    if (timeout) {
      clearTimeout(timeout);
      useNotesStore.getState().saveCurrentNote();
    }
  });
}

export const useNotesStore = create<NotesState>()(
  (set, get) => ({
    notes: [],
    folders: [],
    currentNote: null,
    isLoading: false,
    saveTimeout: null,

    loadNotes: async () => {
      set({ isLoading: true });
      try {
        // Get notes from Tauri backend
        const notes: Note[] = await invoke('get_all_notes');
        set({ notes, isLoading: false });
      } catch (error) {
        console.error('Failed to load notes:', error);
        set({ isLoading: false });
      }
    },

    loadFolders: async () => {
      try {
        const folders: Folder[] = await invoke('get_all_folders');
        set({ folders });
      } catch (error) {
        console.error('Failed to load folders:', error);
      }
    },

    selectNote: async (note) => {
      // Save current note before switching
      const currentState = get();
      if (currentState.saveTimeout) {
        clearTimeout(currentState.saveTimeout);
        await get().saveCurrentNote();
      }
      set({ currentNote: note });
    },

    createNote: async (noteType = 'text', folderId) => {
      try {
        // Create note via Tauri backend
        const newNote: Note = await invoke('create_note', { title: 'Untitled', noteType, folderId });

        set((state) => ({
          notes: [newNote, ...state.notes],
        }));

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
        await invoke('save_note', { note: updatedNote });

        // Update state
        set((state) => ({
          notes: state.notes.map((note) =>
            note.id === id ? updatedNote : note
          ),
          currentNote: state.currentNote?.id === id ? updatedNote : state.currentNote,
        }));
      } catch (error) {
        console.error('Failed to update note:', error);
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

        set((state) => ({
          folders: state.folders.filter((folder) => folder.id !== id),
          // Also remove notes in this folder
          notes: state.notes.filter((note) => note.folder_id !== id),
          currentNote: state.currentNote?.folder_id === id ? null : state.currentNote,
        }));
      } catch (error) {
        console.error('Failed to delete folder:', error);
        throw error;
      }
    },

    updateCurrentNoteContent: (content: string) => {
      const state = get();
      if (!state.currentNote) return;

      // Clear existing timeout
      if (state.saveTimeout) {
        clearTimeout(state.saveTimeout);
      }

      // Update the current note content locally
      const updatedNote = { ...state.currentNote, content };

      // Schedule auto-save with shorter debounce for real-time feel
      const newTimeout = setTimeout(() => {
        get().saveCurrentNote();
      }, 500); // Reduced from 2000ms to 500ms

      set({
        currentNote: updatedNote,
        saveTimeout: newTimeout,
      });
    },

    updateCurrentNoteTitle: (title: string) => {
      const state = get();
      if (!state.currentNote) return;

      // Update the current note title locally
      const updatedNote = { ...state.currentNote, title };

      // Clear existing timeout
      if (state.saveTimeout) {
        clearTimeout(state.saveTimeout);
      }

      // Save title changes immediately for instant feedback
      set({
        currentNote: updatedNote,
      });

      // Save immediately without debounce
      get().saveCurrentNote();
    },

    saveCurrentNote: async () => {
      const state = get();
      if (!state.currentNote) return;

      try {
        // Save via Tauri backend
        await invoke('save_note', { note: state.currentNote });

        // Update the note in the notes list
        set((state) => ({
          notes: state.notes.map((note) =>
            note.id === state.currentNote?.id ? state.currentNote : note
          ),
        }));

        console.log('Note saved:', state.currentNote);
      } catch (error) {
        console.error('Failed to save note:', error);
        throw error;
      }
    },
  })
);
