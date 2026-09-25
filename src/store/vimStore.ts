import { create } from 'zustand';

export type VimMode = 'normal' | 'insert' | 'visual' | 'visual-line' | 'explorer';

/** Where focus goes back to when the command line closes. */
export type VimReturnTo = 'editor' | 'explorer' | 'none';

interface VimState {
  mode: VimMode;
  /** Keys typed so far for a pending command, e.g. "2d". */
  pending: string;
  leaderOpen: boolean;
  commandLine: { prefix: ':' | '/' | '?'; returnTo: VimReturnTo } | null;
  explorerCursor: string | null;
  message: { text: string; error?: boolean } | null;

  setMode: (mode: VimMode) => void;
  setPending: (pending: string) => void;
  setLeaderOpen: (open: boolean) => void;
  openCommandLine: (prefix: ':' | '/' | '?', returnTo: VimReturnTo) => void;
  closeCommandLine: () => void;
  setExplorerCursor: (id: string | null) => void;
  flash: (text: string, error?: boolean) => void;
}

let flashTimer: ReturnType<typeof setTimeout> | null = null;

export const useVimStore = create<VimState>((set) => ({
  mode: 'normal',
  pending: '',
  leaderOpen: false,
  commandLine: null,
  explorerCursor: null,
  message: null,

  setMode: (mode) => set({ mode }),
  setPending: (pending) => set({ pending }),
  setLeaderOpen: (leaderOpen) => set({ leaderOpen }),
  openCommandLine: (prefix, returnTo) => set({ commandLine: { prefix, returnTo }, leaderOpen: false }),
  closeCommandLine: () => set({ commandLine: null }),
  setExplorerCursor: (explorerCursor) => set({ explorerCursor }),
  flash: (text, error) => {
    if (flashTimer) clearTimeout(flashTimer);
    set({ message: { text, error } });
    flashTimer = setTimeout(() => set({ message: null }), 3000);
  },
}));
