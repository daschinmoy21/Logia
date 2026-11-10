import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface GitFileChange {
  path: string;
  /** M, A, D, R, C, T, or U for untracked. */
  status: string;
}

export interface GitPanelStatus {
  git_available: boolean;
  repo: boolean;
  root: string;
  branch: string;
  remote: boolean;
  ahead: number;
  behind: number;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
}

interface GitState {
  status: GitPanelStatus | null;
  error: string | null;
  /** The action running right now, so the panel can disable buttons and show a spinner. */
  busy: string | null;
  refresh: () => Promise<void>;
  /** Run one git action, then refresh. Errors are rethrown for the caller to report. */
  run: <T>(label: string, action: () => Promise<T>) => Promise<T>;
}

let inflight: Promise<void> | null = null;

export const useGitStore = create<GitState>()((set, get) => ({
  status: null,
  error: null,
  busy: null,
  refresh: () => {
    // Coalesce overlapping polls and post-action refreshes into one git call.
    inflight ??= invoke<GitPanelStatus>('git_panel_status')
      .then((status) => set({ status, error: null }))
      .catch((error) => set({ error: String(error) }))
      .finally(() => { inflight = null; });
    return inflight;
  },
  run: async (label, action) => {
    set({ busy: label });
    try {
      return await action();
    } finally {
      set({ busy: null });
      await get().refresh();
    }
  },
}));

export const changeCount = (status: GitPanelStatus | null) =>
  status ? new Set([...status.staged, ...status.unstaged].map((change) => change.path)).size : 0;
