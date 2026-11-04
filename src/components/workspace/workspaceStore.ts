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
  /** Open note tabs, left to right. */
  tabs: string[];
  /** The one tab a new note may replace, until it's edited or pinned. */
  previewTab: string | null;
  /** Where the sidebar's new-item buttons create things; null is the workspace root. */
  treeFolderId: string | null;
  sidebarWidth: number;
  aiPanelWidth: number;
  favoritesOpen: boolean;

  setReady: (ready: boolean) => void;
  setHome: (home: Partial<HomeState>) => void;
  resetHomeFilters: () => void;
  setContextCompact: (compact: boolean) => void;
  setContextVisible: (visible: boolean) => void;
  toggleContextPanel: () => void;
  openTab: (id: string) => void;
  pinTab: (id: string) => void;
  removeTabs: (ids: string[]) => void;
  pruneTabs: (existing: Set<string>) => void;
  moveTab: (id: string, over: string) => void;
  setTreeFolderId: (id: string | null) => void;
  setSidebarWidth: (width: number) => void;
  setAiPanelWidth: (width: number) => void;
  setFavoritesOpen: (open: boolean) => void;
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
      tabs: [],
      previewTab: null,
      treeFolderId: null,
      sidebarWidth: 264,
      aiPanelWidth: 380,
      favoritesOpen: true,

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
      openTab: (id) => set((s) => {
        if (s.tabs.includes(id)) return s;
        const preview = s.previewTab && s.tabs.includes(s.previewTab) ? s.previewTab : null;
        return {
          tabs: preview ? s.tabs.map((tab) => (tab === preview ? id : tab)) : [...s.tabs, id],
          previewTab: id,
        };
      }),
      pinTab: (id) => set((s) => (s.previewTab === id ? { previewTab: null } : s)),
      removeTabs: (ids) => set((s) => ({
        tabs: s.tabs.filter((tab) => !ids.includes(tab)),
        previewTab: s.previewTab && ids.includes(s.previewTab) ? null : s.previewTab,
      })),
      pruneTabs: (existing) => set((s) => {
        if (s.tabs.every((tab) => existing.has(tab))) return s;
        return {
          tabs: s.tabs.filter((tab) => existing.has(tab)),
          previewTab: s.previewTab && existing.has(s.previewTab) ? s.previewTab : null,
        };
      }),
      moveTab: (id, over) => set((s) => {
        const from = s.tabs.indexOf(id);
        const to = s.tabs.indexOf(over);
        if (from < 0 || to < 0) return s;
        const tabs = [...s.tabs];
        tabs.splice(to, 0, tabs.splice(from, 1)[0]);
        return { tabs };
      }),
      setTreeFolderId: (treeFolderId) => set({ treeFolderId }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setAiPanelWidth: (aiPanelWidth) => set({ aiPanelWidth }),
      setFavoritesOpen: (favoritesOpen) => set({ favoritesOpen }),
    }),
    {
      name: 'logia-workspace-ui',
      version: 1,
      partialize: (s) => ({
        contextPanelOpen: s.contextPanelOpen,
        tabs: s.tabs,
        previewTab: s.previewTab,
        sidebarWidth: s.sidebarWidth,
        aiPanelWidth: s.aiPanelWidth,
        favoritesOpen: s.favoritesOpen,
      }),
    },
  ),
);
