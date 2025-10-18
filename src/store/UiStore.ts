import { create } from 'zustand';
import Fuse from 'fuse.js';
import { Note, Folder } from '../types/Note';

interface UiState {
  isSearchActive: boolean;
  searchQuery: string;
  searchResults: Note[];
  isCommandPaletteOpen: boolean;
  toggleSearch: () => void;
  setSearchQuery: (query: string, notes: Note[]) => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;

  // States moved from Sidebar
  deleteConfirmId: string | null;
  renamingNoteId: string | null;
  renameValue: string;
  contextMenu: { x: number; y: number; note?: Note; folder?: Folder } | null;
  isSettingsOpen: boolean;
  isKanbanOpen: boolean;
  isSupportOpen: boolean;
  isRecording: boolean;

  // Actions for new states
  setDeleteConfirmId: (id: string | null) => void;
  startRenaming: (noteId: string, currentTitle: string) => void;
  finishRenaming: () => void;
  setRenameValue: (value: string) => void;
  setContextMenu: (contextMenu: { x: number; y: number; note?: Note; folder?: Folder } | null) => void;
  setIsSettingsOpen: (isOpen: boolean) => void;
  setIsKanbanOpen: (isOpen: boolean) => void;
  setIsSupportOpen: (isOpen: boolean) => void;
  setIsRecording: (isRecording: boolean) => void;
}

const useUiStore = create<UiState>((set) => ({
  isSearchActive: false,
  searchQuery: '',
  searchResults: [],
  isCommandPaletteOpen: false,
  toggleSearch: () => set((state) => ({ isSearchActive: !state.isSearchActive })),
  setSearchQuery: (query, notes) => {
    set({ searchQuery: query });
    if (query) {
      const fuse = new Fuse(notes, {
        keys: ['title', 'content'],
        includeScore: true,
      });
      const results = fuse.search(query);
      set({ searchResults: results.map((result) => result.item) });
    } else {
      set({ searchResults: [] });
    }
  },
  openCommandPalette: () => set({ isCommandPaletteOpen: true }),
  closeCommandPalette: () => set({ isCommandPaletteOpen: false, searchQuery: '', searchResults: [] }),

  // States moved from Sidebar
  deleteConfirmId: null,
  renamingNoteId: null,
  renameValue: '',
  contextMenu: null,
  isSettingsOpen: false,
  isKanbanOpen: false,
  isSupportOpen: false,
  isRecording: false,

  // Actions for new states
  setDeleteConfirmId: (id) => set({ deleteConfirmId: id }),
  startRenaming: (noteId, currentTitle) => set({ renamingNoteId: noteId, renameValue: currentTitle }),
  finishRenaming: () => set({ renamingNoteId: null, renameValue: '' }),
  setRenameValue: (value) => set({ renameValue: value }),
  setContextMenu: (contextMenu) => set({ contextMenu }),
  setIsSettingsOpen: (isOpen) => set({ isSettingsOpen: isOpen }),
  setIsKanbanOpen: (isOpen) => set({ isKanbanOpen: isOpen }),
  setIsSupportOpen: (isOpen) => set({ isSupportOpen: isOpen }),
  setIsRecording: (isRecording) => set({ isRecording }),
}));

export default useUiStore;
