import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { PROVIDERS, getProvider } from '../lib/ai/providers';
import { normalizeUiScale } from '../lib/ui-scale';
import type { AgentTool } from '../lib/ai/agent-terminal';


export interface CliToolInfo {
  id: string;
  binary: string;
  available: boolean;
  path: string | null;
}

interface SettingsState {
  // --- persisted (non-secret) preferences ---
  activeProvider: string;
  addedProviders: string[];
  favoriteModels: Record<string, string[]>;
  models: Record<string, string>;
  baseUrls: Record<string, string>;
  cliBinaries: Record<string, string>;
  vimEnabled: boolean;
  /** Vim in the agent composer; null follows vimEnabled. */
  composerVim: boolean | null;
  sidebarFloating: boolean;
  uiScale: number;
  /** null until one is chosen: the panel then uses the first detected agent. */
  activeAgent: AgentTool | null;

  // --- runtime status (not persisted) ---
  keyStatus: Record<string, boolean>;
  cliStatus: Record<string, CliToolInfo>;

  setActiveProvider: (id: string) => void;
  addProvider: (id: string) => void;
  toggleFavoriteModel: (providerId: string, modelId: string) => void;
  setModel: (providerId: string, model: string) => void;
  setBaseUrl: (providerId: string, url: string) => void;
  setCliBinary: (providerId: string, binary: string) => void;
  setVimEnabled: (enabled: boolean) => void;
  setComposerVim: (enabled: boolean | null) => void;
  setSidebarFloating: (floating: boolean) => void;
  setUiScale: (scale: number) => void;
  setActiveAgent: (agent: AgentTool) => void;

  refreshKeyStatus: () => Promise<void>;
  refreshCliStatus: () => Promise<void>;
  saveKey: (providerId: string, key: string) => Promise<void>;
  removeKey: (providerId: string) => Promise<void>;
}

const keyProviders = PROVIDERS.filter((p) => p.needsKey || p.id === 'custom').map((p) => p.id);

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      activeProvider: 'google',
      addedProviders: [],
      favoriteModels: {},
      models: {},
      baseUrls: {},
      cliBinaries: {},
      vimEnabled: false,
      composerVim: null,
      sidebarFloating: false,
      uiScale: 1,
      activeAgent: null,

      keyStatus: {},
      cliStatus: {},

      setActiveProvider: (id) => {
        if (getProvider(id)) set({ activeProvider: id });
      },
      addProvider: (id) => {
        if (getProvider(id)) set((s) => ({ addedProviders: [...new Set([...s.addedProviders, id])] }));
      },
      toggleFavoriteModel: (providerId, modelId) => set((s) => {
        const current = s.favoriteModels[providerId] ?? [];
        return { favoriteModels: { ...s.favoriteModels, [providerId]: current.includes(modelId) ? current.filter((id) => id !== modelId) : [...current, modelId] } };
      }),
      setModel: (providerId, model) =>
        set((s) => ({ models: { ...s.models, [providerId]: model } })),
      setBaseUrl: (providerId, url) =>
        set((s) => ({ baseUrls: { ...s.baseUrls, [providerId]: url } })),
      setCliBinary: (providerId, binary) =>
        set((s) => ({ cliBinaries: { ...s.cliBinaries, [providerId]: binary } })),
      setVimEnabled: (vimEnabled) => set({ vimEnabled }),
      setComposerVim: (composerVim) => set({ composerVim }),
      setSidebarFloating: (sidebarFloating) => set({ sidebarFloating }),
      setUiScale: (scale) => set({ uiScale: normalizeUiScale(scale) }),
      setActiveAgent: (activeAgent) => set({ activeAgent }),

      refreshKeyStatus: async () => {
        try {
          const status = await invoke<Record<string, boolean>>('ai_keys_status', {
            providers: keyProviders,
          });
          set({ keyStatus: status });
        } catch (error) {
          console.error('Failed to load AI key status:', error);
        }
      },

      refreshCliStatus: async () => {
        try {
          const tools = await invoke<CliToolInfo[]>('ai_cli_detect', {
            overrides: get().cliBinaries,
          });
          set({ cliStatus: Object.fromEntries(tools.map((t) => [t.id, t])) });
        } catch (error) {
          console.error('Failed to detect AI CLIs:', error);
        }
      },

      saveKey: async (providerId, key) => {
        await invoke('save_ai_key', { provider: providerId, key });
        forgetCachedKey(providerId);
        set((s) => ({ keyStatus: { ...s.keyStatus, [providerId]: true } }));
      },

      removeKey: async (providerId) => {
        await invoke('remove_ai_key', { provider: providerId });
        forgetCachedKey(providerId);
        set((s) => ({ keyStatus: { ...s.keyStatus, [providerId]: false } }));
      },
    }),
    {
      name: 'logia-settings',
      version: 1,
      partialize: (s) => ({
        activeProvider: s.activeProvider,
        addedProviders: s.addedProviders,
        favoriteModels: s.favoriteModels,
        models: s.models,
        baseUrls: s.baseUrls,
        cliBinaries: s.cliBinaries,
        vimEnabled: s.vimEnabled,
        composerVim: s.composerVim,
        sidebarFloating: s.sidebarFloating,
        uiScale: s.uiScale,
        activeAgent: s.activeAgent,
      }),
    },
  ),
);

// In-memory cache of decrypted keys so we don't hit the keyring per request.
const keyCache = new Map<string, string>();

function forgetCachedKey(providerId: string) {
  keyCache.delete(providerId);
}

export async function getApiKey(providerId: string): Promise<string> {
  const cached = keyCache.get(providerId);
  if (cached) return cached;
  try {
    const key = await invoke<string>('get_ai_key', { provider: providerId });
    if (key) keyCache.set(providerId, key);
    return key;
  } catch {
    return '';
  }
}

/** Whether the provider has everything it needs to be used right now. */
export function isProviderReady(providerId: string, state = useSettingsStore.getState()): boolean {
  const provider = getProvider(providerId);
  if (!provider) return false;
  if (provider.kind === 'cli') return state.cliStatus[provider.id]?.available ?? false;
  if (provider.needsKey) return !!state.keyStatus[provider.id];
  if (provider.id === 'custom') return !!(state.baseUrls.custom?.trim() || provider.defaultBaseUrl);
  return true;
}
