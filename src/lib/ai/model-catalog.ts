import { invoke } from '@tauri-apps/api/core';
import { getApiKey, useSettingsStore } from '../../store/settingsStore';
import { getProvider, resolveBaseUrl } from './providers';
import { isDesktopAgentHost } from './agent-terminal';
import { aiFetch } from './http';
import { fetchApiCatalog, type CatalogModel } from './catalog-api';

export type { CatalogModel } from './catalog-api';

// Share active requests across pickers; reopening always requests a fresh catalog.
const pending = new Map<string, Promise<CatalogModel[]>>();

export function loadProviderModels(providerId: string): Promise<CatalogModel[]> {
  const provider = getProvider(providerId);
  if (!provider) return Promise.reject(new Error('Unknown provider.'));
  const state = useSettingsStore.getState();
  const binary = state.cliBinaries[providerId]?.trim() || null;
  const endpoint = resolveBaseUrl(provider, state.baseUrls) || (provider.flavor === 'google'
    ? 'https://generativelanguage.googleapis.com/v1beta' : provider.flavor === 'anthropic'
      ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1');
  const key = `${providerId}:${binary}:${endpoint}`;
  const current = pending.get(key);
  if (current) return current;
  const request = (async () => {
    if (provider.kind === 'cli') {
      if (!isDesktopAgentHost()) throw new Error('Open the desktop app to load models from this CLI.');
      return invoke<CatalogModel[]>('ai_cli_models', { tool: providerId, binary });
    }
    const apiKey = provider.needsKey || provider.id === 'custom' ? await getApiKey(providerId) : '';
    if (provider.needsKey && !apiKey) throw new Error('Add an API key in provider settings to fetch available models.');
    return fetchApiCatalog({ baseUrl: endpoint, apiKey, flavor: provider.flavor === 'google' ? 'google' : provider.flavor === 'anthropic' ? 'anthropic' : 'openai-compatible' }, aiFetch);
  })();
  pending.set(key, request);
  const clear = () => { pending.delete(key); };
  void request.then(clear, clear);
  return request;
}
