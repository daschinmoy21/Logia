import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { Note } from '../types/Note';

interface NotesState {
  notes: Note[];
  currentNote: Note | null;
  isLoading: boolean;
  saveTimeout: NodeJS.Timeout | null;
  loadNotes: () => Promise<void>;
  selectNote: (note: Note) => void;
  createNote: (noteType?: 'text' | 'canvas') => Promise<Note>;
  updateNote: (id: string, updates: Partial<Note>) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
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

    selectNote: async (note) => {
      // Save current note before switching
      const currentState = get();
      if (currentState.saveTimeout) {
        clearTimeout(currentState.saveTimeout);
        await get().saveCurrentNote();
      }
      set({ currentNote: note });
    },

    createNote: async (noteType = 'text') => {
      try {
        // Create note via Tauri backend
        const newNote: Note = await invoke('create_note', { title: 'Untitled', noteType });

        set((state) => ({
          notes: [newNote, ...state.notes],
        }));

        return newNote;
      } catch (error) {
        console.error('Failed to create note:', error);
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
