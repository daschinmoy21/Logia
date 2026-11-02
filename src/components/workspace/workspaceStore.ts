import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type HomeFilter = 'all' | 'starred' | 'canvas';
export type HomeSort = 'relevance' | 'updated' | 'created' | 'title';

interface HomeState {
  query: string;
  filter: HomeFilter;
  tag: string | null;
  /** null means "the sensible default": best match while searching, else recent. */
  sort: HomeSort | null;
}

interface WorkspaceUiState {
  /** Notes and folders finished their first load; "empty" before this would be a lie. */
  ready: boolean;
  home: HomeState;
  /** The docked panel preference, kept between sessions. */
  contextPanelOpen: boolean;
  /** The overlay used when the note pane is narrow; always starts closed. */
  contextOverlayOpen: boolean;
  contextCompact: boolean;

  setReady: (ready: boolean) => void;
  setHome: (home: Partial<HomeState>) => void;
  resetHomeFilters: () => void;
  setContextCompact: (compact: boolean) => void;
  setContextVisible: (visible: boolean) => void;
  toggleContextPanel: () => void;
}

const defaultHome: HomeState = { query: '', filter: 'all', tag: null, sort: null };

export const useWorkspaceStore = create<WorkspaceUiState>()(
  persist(
    (set, get) => ({
      ready: false,
      home: defaultHome,
      contextPanelOpen: typeof window === 'undefined' || window.innerWidth >= 1280,
      contextOverlayOpen: false,
      contextCompact: false,

      setReady: (ready) => set({ ready }),
      setHome: (home) => set((s) => ({ home: { ...s.home, ...home } })),
      resetHomeFilters: () => set((s) => ({ home: { ...defaultHome, sort: s.home.sort === 'relevance' ? null : s.home.sort } })),
      setContextCompact: (contextCompact) => set({ contextCompact }),
      setContextVisible: (visible) =>
        set(get().contextCompact ? { contextOverlayOpen: visible } : { contextPanelOpen: visible }),
      toggleContextPanel: () => {
        const s = get();
        s.setContextVisible(!(s.contextCompact ? s.contextOverlayOpen : s.contextPanelOpen));
      },
    }),
    {
      name: 'logia-workspace-ui',
      version: 1,
      partialize: (s) => ({ contextPanelOpen: s.contextPanelOpen }),
    },
  ),
);
