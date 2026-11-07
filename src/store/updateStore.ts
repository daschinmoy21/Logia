import { create } from 'zustand';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Update } from '@tauri-apps/plugin-updater';
import { useSettingsStore } from './settingsStore';
import { useNotesStore } from './notesStore';

export const RELEASES_URL = 'https://github.com/daschinmoy21/Logia/releases/latest';

/** "auto" installs in place; "nix" and "manual" builds are updated outside the app. */
export type InstallMode = 'auto' | 'nix' | 'manual';

type Status = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'installing' | 'error';

interface UpdateState {
  status: Status;
  update: Update | null;
  installMode: InstallMode;
  /** Bytes downloaded so far and the total, when the server sends a length. */
  downloaded: number;
  total: number | null;
  error: string | null;
  promptOpen: boolean;

  /**
   * Looks for a newer release. A background check stays quiet unless it finds one the
   * user hasn't skipped; a manual check always opens the prompt when one exists.
   */
  check: (opts?: { manual?: boolean }) => Promise<void>;
  install: () => Promise<void>;
  skip: () => void;
  dismiss: () => void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const useUpdateStore = create<UpdateState>()((set, get) => ({
  status: 'idle',
  update: null,
  installMode: 'auto',
  downloaded: 0,
  total: null,
  error: null,
  promptOpen: false,

  check: async ({ manual = false } = {}) => {
    if (!isTauri()) return;
    const { status } = get();
    if (status === 'checking' || status === 'downloading' || status === 'installing') return;
    set({ status: 'checking', error: null });
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const [update, installMode] = await Promise.all([
        check(),
        invoke<InstallMode>('update_install_mode').catch(() => 'manual' as const),
      ]);
      if (!update) {
        set({ status: 'up-to-date', update: null, installMode });
        return;
      }
      const skipped = useSettingsStore.getState().skippedUpdateVersion === update.version;
      // Release the previous handle's resource before keeping a new one.
      await get().update?.close().catch(() => {});
      set({ status: 'available', update, installMode, promptOpen: manual || !skipped });
    } catch (error) {
      // Offline or GitHub is down: only worth mentioning when someone asked.
      console.warn('Update check failed:', error);
      set({ status: manual ? 'error' : 'idle', error: message(error) });
    }
  },

  install: async () => {
    const { update, installMode } = get();
    if (!update || installMode !== 'auto') return;
    set({ status: 'downloading', downloaded: 0, total: null, error: null });
    try {
      await update.download((event) => {
        if (event.event === 'Started') set({ total: event.data.contentLength ?? null });
        else if (event.event === 'Progress') set((s) => ({ downloaded: s.downloaded + event.data.chunkLength }));
      });
      set({ status: 'installing' });
      // Write the open note before the installer can quit the app; a failed save stops here.
      const notes = useNotesStore.getState();
      if (notes.saveTimeout || notes.saveError || notes.isSaving) {
        if (notes.saveTimeout) clearTimeout(notes.saveTimeout);
        await notes.saveCurrentNote();
      }
      await update.install();
      // Windows exits during install and never gets here; elsewhere start the new version.
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (error) {
      console.error('Update failed:', error);
      set({ status: 'error', error: message(error) });
    }
  },

  skip: () => {
    const version = get().update?.version;
    if (version) useSettingsStore.getState().setSkippedUpdateVersion(version);
    set({ promptOpen: false });
  },

  dismiss: () => {
    const { status } = get();
    if (status === 'downloading' || status === 'installing') return;
    set({ promptOpen: false, status: status === 'error' && get().update ? 'available' : status });
  },
}));
