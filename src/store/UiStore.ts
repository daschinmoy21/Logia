import { create } from 'zustand';
import Fuse from 'fuse.js';
import { Note } from '../types/Note';

interface UiState {
  isSearchActive: boolean;
  searchQuery: string;
  searchResults: Note[];
  isCommandPaletteOpen: boolean;
  toggleSearch: () => void;
  setSearchQuery: (query: string, notes: Note[]) => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
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
}));

export default useUiStore;
