import { useEffect, useId, useMemo, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { ChevronDown, ChevronUp, Filter, Loader2, Plus, RefreshCw, Search, Star, X } from 'lucide-react';
import { getProvider, PROVIDERS, resolveModel, type ProviderDef } from '../lib/ai/providers';
import { loadProviderModels, type CatalogModel } from '../lib/ai/model-catalog';
import { useSettingsStore } from '../store/settingsStore';
import useUiStore from '../store/UiStore';
import { ProviderIcon } from './ProviderIcon';

interface ModelPickerProps {
  providerId: string;
  disabled?: boolean;
  scope?: 'provider' | 'chat';
  placement?: 'above' | 'below';
}

/** One provider/model selection surface, with live catalogs and remembered favorites. */
export function ModelPicker({ providerId, disabled = false, scope = 'provider' }: ModelPickerProps) {
  const settings = useSettingsStore();
  const active = getProvider(providerId) ?? PROVIDERS[0];
  const model = resolveModel(active, settings.models);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [custom, setCustom] = useState(false);
  const [customProvider, setCustomProvider] = useState(providerId);
  const [customId, setCustomId] = useState('');
  const radioName = useId();
  const providers = useMemo(() => scope === 'provider' ? [active] : PROVIDERS.filter((p) =>
    p.id === settings.activeProvider || settings.addedProviders.includes(p.id) || settings.keyStatus[p.id] ||
    settings.cliStatus[p.id]?.available || settings.models[p.id] || settings.baseUrls[p.id] || settings.cliBinaries[p.id]),
  [scope, active, settings.activeProvider, settings.addedProviders, settings.keyStatus, settings.cliStatus, settings.models, settings.baseUrls, settings.cliBinaries]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const select = (id: string, modelId: string) => {
    if (scope === 'chat') settings.setActiveProvider(id);
    settings.setModel(id, modelId);
  };
  const close = () => setOpen(false);

  return <>
    <button type="button" disabled={disabled} onClick={() => { setQuery(''); setCustom(false); setCustomProvider(providerId); setOpen(true); }}
      aria-label={scope === 'chat' ? `Choose chat model. Current: ${active.label}${model ? `, ${model}` : ''}` : `Choose model for ${active.label}. Current: ${model || 'Provider default'}`}
      aria-haspopup="dialog" aria-expanded={open}
      className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-50">
      <ProviderIcon providerId={active.id} size={14} />
      <span className="truncate">{model || (scope === 'chat' ? 'Choose model' : 'Provider default')}</span>
      <ChevronDown size={12} className="shrink-0 text-zinc-500" />
    </button>
    {open && <Dialog open onClose={close} data-agent-menu className="relative z-[1200]">
      <div className="fixed inset-0 bg-black/65 backdrop-blur-sm" aria-hidden="true" />
      <div className="fixed inset-0 flex items-end justify-center sm:items-center sm:p-6">
        <DialogPanel className="flex h-full w-full flex-col overflow-hidden bg-zinc-950 shadow-2xl sm:h-auto sm:max-h-[85dvh] sm:max-w-xl sm:rounded-2xl sm:border sm:border-zinc-800">
          <div className="flex items-center gap-3 border-b border-zinc-900 bg-zinc-900/50 px-5 py-4">
            <button type="button" onClick={close} aria-label="Close model settings" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"><X size={20} /></button>
            <DialogTitle className="flex-1 text-base font-medium text-zinc-100">{scope === 'chat' ? 'Chat settings' : 'Model settings'}</DialogTitle>
            <button type="button" aria-label="Refresh models" onClick={() => setRefresh((v) => v + 1)} className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"><RefreshCw size={16} /></button>
            <button type="button" aria-label="Show favorite models" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly((v) => !v)}
              className={`rounded-md p-2 hover:bg-zinc-800 ${favoritesOnly ? 'text-blue-400' : 'text-zinc-400'}`}><Filter size={18} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
            <div className="sticky top-0 z-10 bg-zinc-950 pb-4 pt-5">
              <label className="flex items-center gap-3 rounded-full bg-zinc-900 px-4 py-3 text-zinc-500">
                <Search size={19} className="shrink-0" />
                <input autoFocus aria-label="Find a model" placeholder="Find a model" value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none" />
                {query && <button type="button" aria-label="Clear model search" onClick={() => setQuery('')}><X size={15} /></button>}
              </label>
              {favoritesOnly && <p role="status" className="mt-3 px-1 text-xs text-zinc-500">Showing favorites. Star models to keep them here.</p>}
            </div>
            <div className="space-y-5">
              {providers.map((provider) => <ModelGroup key={provider.id} provider={provider} activeProvider={providerId} query={query} favoritesOnly={favoritesOnly} refresh={refresh} radioName={radioName} onSelect={select} />)}
            </div>
            <div className="mt-6 border-t border-zinc-900 pt-4">
              <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
                <button type="button" onClick={() => setCustom((v) => !v)} aria-expanded={custom} className="py-1 hover:text-zinc-200">Use a custom model ID</button>
                {scope === 'chat' && <button type="button" onClick={() => { close(); useUiStore.getState().setIsSettingsOpen(true, 'ai'); }} className="inline-flex items-center gap-1 py-1 hover:text-zinc-200"><Plus size={13} /> Providers</button>}
              </div>
              {custom && <form className="mt-3 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (customId.trim()) { select(customProvider, customId.trim()); close(); } }}>
                {scope === 'chat' && <select aria-label="Custom model provider" value={customProvider} onChange={(e) => setCustomProvider(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200">
                  {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>}
                <div className="flex gap-2"><input aria-label="Custom model ID" value={customId} onChange={(e) => setCustomId(e.target.value)} placeholder="Exact model ID" className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100" />
                  <button type="submit" disabled={!customId.trim()} className="rounded-lg bg-zinc-200 px-3 text-xs font-medium text-zinc-950 disabled:opacity-40">Use model</button></div>
              </form>}
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>}
  </>;
}

function ModelGroup({ provider, activeProvider, query, favoritesOnly, refresh, radioName, onSelect }: {
  provider: ProviderDef; activeProvider: string; query: string; favoritesOnly: boolean; refresh: number; radioName: string;
  onSelect: (providerId: string, modelId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const model = useSettingsStore((s) => s.models[provider.id]?.trim() ?? '');
  const favorites = useSettingsStore((s) => s.favoriteModels[provider.id]);
  const toggleFavorite = useSettingsStore((s) => s.toggleFavoriteModel);
  const binary = useSettingsStore((s) => s.cliBinaries[provider.id]);
  const baseUrl = useSettingsStore((s) => s.baseUrls[provider.id]);

  useEffect(() => {
    let disposed = false;
    setCatalog([]); setLoading(true); setError('');
    void loadProviderModels(provider.id).then((models) => { if (!disposed) setCatalog(models); })
      .catch((e) => { if (!disposed) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [provider.id, binary, baseUrl, refresh]);

  const needle = query.trim().toLowerCase();
  const filtered = catalog.filter((m) => (!favoritesOnly || favorites?.includes(m.id)) &&
    (!needle || `${provider.label} ${m.label} ${m.id}`.toLowerCase().includes(needle)));
  const defaultId = catalog.find((m) => m.isDefault)?.id;
  const selectedId = model || defaultId || (provider.kind === 'api' ? catalog[0]?.id : '');
  const showDefault = provider.kind === 'cli' && !defaultId && !needle && !favoritesOnly && catalog.length > 0;
  const compact = !expanded && !needle && !favoritesOnly;
  const shown = compact ? filtered.slice(0, 4) : filtered;
  const current = filtered.find((item) => item.id === selectedId);
  if (compact && provider.id === activeProvider && current && !shown.includes(current)) shown.push(current);

  return <section aria-label={`${provider.label} models`}>
    <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed((v) => !v)} className="mb-2 flex w-full items-center gap-2.5 px-1 py-1 text-sm text-zinc-400 hover:text-zinc-100">
      <ProviderIcon providerId={provider.id} size={19} /><span className="flex-1 text-left">{provider.id === 'codex' ? 'Codex' : provider.id === 'claude-code' ? 'Claude' : provider.label}</span>
      {loading && <Loader2 size={13} className="animate-spin" />}
      {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
    </button>
    {!collapsed && <>
      {loading ? <p role="status" className="px-2 py-4 text-xs text-zinc-500">Fetching available models…</p>
        : error ? <p role="status" className="rounded-xl bg-zinc-900/70 px-4 py-4 text-xs leading-5 text-zinc-500">{error}</p>
          : !filtered.length && !showDefault ? <p className="px-2 py-3 text-xs text-zinc-600">{favoritesOnly ? 'No favorite models in this provider.' : 'No models match your search.'}</p>
            : <div className="overflow-hidden rounded-2xl bg-zinc-900">
              {showDefault && <label className="flex cursor-pointer items-center gap-3 px-4 py-4 text-sm text-zinc-200 hover:bg-zinc-800/60">
                <input type="radio" name={radioName} aria-label={`${provider.label}: CLI default`} checked={provider.id === activeProvider && !model} onChange={() => onSelect(provider.id, '')} className="size-5 shrink-0 accent-blue-500" />
                <span>CLI default</span>
              </label>}
              {shown.map((item) => {
                const selected = provider.id === activeProvider && selectedId === item.id;
                const favorite = !!favorites?.includes(item.id);
                return <div key={item.id} className={`flex items-center ${selected ? 'bg-zinc-950/40' : ''}`}>
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-4 pl-4 pr-2 hover:bg-zinc-800/40">
                    <input type="radio" name={radioName} aria-label={`${provider.label}: ${item.label}`} checked={selected} onChange={() => onSelect(provider.id, item.id)} className="size-5 shrink-0 accent-blue-500" />
                    <span className="min-w-0 truncate text-sm text-zinc-100" title={item.id}>{item.label}</span>
                    {item.isDefault && <span className="shrink-0 rounded bg-black/35 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">Default</span>}
                  </label>
                  <button type="button" aria-label={`Favorite ${provider.label}: ${item.label}`} aria-pressed={favorite} onClick={() => toggleFavorite(provider.id, item.id)} className={`shrink-0 px-4 py-4 hover:text-amber-300 ${favorite ? 'text-amber-400' : 'text-zinc-600'}`}>
                    <Star size={19} className={favorite ? 'fill-current' : ''} />
                  </button>
                </div>;
              })}
              {filtered.length > shown.length && <button type="button" onClick={() => setExpanded(true)} className="w-full border-t border-zinc-800 px-4 py-3 text-left text-xs text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-200">Show {filtered.length - shown.length} more models</button>}
            </div>}
    </>}
  </section>;
}
