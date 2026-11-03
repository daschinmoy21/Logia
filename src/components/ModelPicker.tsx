import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { Check, ChevronDown, Filter, Loader2, Plus, RefreshCw, Search, Star } from 'lucide-react';
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
  defaultModelLabel?: string;
}

/** A small anchored menu; selecting a model applies it and closes the menu. */
export function ModelPicker({ providerId, disabled = false, scope = 'provider', placement = 'above', defaultModelLabel }: ModelPickerProps) {
  const settings = useSettingsStore();
  const active = getProvider(providerId) ?? PROVIDERS[0];
  const model = resolveModel(active, settings.models);
  const [query, setQuery] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [custom, setCustom] = useState(false);
  const [customProvider, setCustomProvider] = useState(providerId);
  const [customId, setCustomId] = useState('');
  const providers = useMemo(() => scope === 'provider' ? [active] : PROVIDERS.filter((p) =>
    p.id === settings.activeProvider || settings.addedProviders.includes(p.id) || settings.keyStatus[p.id] ||
    settings.cliStatus[p.id]?.available || settings.models[p.id] || settings.baseUrls[p.id] || settings.cliBinaries[p.id]),
  [scope, active, settings.activeProvider, settings.addedProviders, settings.keyStatus, settings.cliStatus, settings.models, settings.baseUrls, settings.cliBinaries]);

  const select = (id: string, modelId: string) => {
    if (scope === 'chat') settings.setActiveProvider(id);
    settings.setModel(id, modelId);
  };
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (event.target instanceof HTMLInputElement && ['Home', 'End'].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : current === -1 ? (event.key === 'ArrowUp' ? items.length - 1 : 0)
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    event.preventDefault(); event.stopPropagation(); items[index].focus();
  };

  return <Popover className="min-w-0">{({ close }) => <>
    <PopoverButton type="button" disabled={disabled} onClick={() => { setQuery(''); setCustom(false); setCustomProvider(providerId); }}
      aria-label={scope === 'chat' ? `Choose chat model. Current: ${active.label}${model ? `, ${model}` : ''}` : `Choose model for ${active.label}. Current: ${model || 'Provider default'}`}
      className="flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md px-1.5 text-xs text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-100 data-[open]:bg-white/[0.07] disabled:opacity-50">
      <ProviderIcon providerId={active.id} size={14} /><span className="truncate">{model || defaultModelLabel || (scope === 'chat' ? 'Choose model' : 'Provider default')}</span><ChevronDown size={12} className="shrink-0 text-zinc-500" />
    </PopoverButton>
    <PopoverPanel focus portal anchor={{ to: placement === 'above' ? 'top start' : 'bottom start', gap: 8, padding: 8 }}
      data-agent-menu data-testid="model-dropdown" aria-label="Model picker" onKeyDown={navigate}
      className="z-[1200] flex max-h-[min(28rem,var(--available-height,28rem))] w-80 max-w-[calc(100vw-16px)] flex-col overflow-hidden menu-surface rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl shadow-black/50 focus:outline-none">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Search size={14} className="shrink-0 text-zinc-500" />
        <input autoFocus aria-label="Find a model" placeholder="Search models…" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent py-1 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus-visible:outline-none" />
        <button type="button" aria-label="Show favorite models" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly((value) => !value)} className={`rounded p-1 hover:bg-zinc-800 ${favoritesOnly ? 'text-amber-300' : 'text-zinc-500'}`}><Filter size={13} /></button>
        <button type="button" aria-label="Refresh models" onClick={() => setRefresh((value) => value + 1)} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><RefreshCw size={13} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5" role="menu" aria-label="Models">
        {providers.map((provider) => <ModelGroup key={provider.id} provider={provider} activeProvider={providerId} query={query} favoritesOnly={favoritesOnly} refresh={refresh}
          onSelect={(id, modelId) => { select(id, modelId); close(); }} />)}
      </div>
      <div className="shrink-0 border-t border-zinc-800 p-2">
        <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
          <button type="button" onClick={() => setCustom((value) => !value)} aria-expanded={custom} className="rounded px-1 py-1 hover:text-zinc-200">Use a custom model ID</button>
          {scope === 'chat' && <button type="button" onClick={() => { close(); useUiStore.getState().setIsSettingsOpen(true, 'ai'); }} className="inline-flex items-center gap-1 px-1 py-1 hover:text-zinc-200"><Plus size={12} /> Providers</button>}
        </div>
        {custom && <form className="mt-2 flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); if (customId.trim()) { select(customProvider, customId.trim()); close(); } }}>
          {scope === 'chat' && <select aria-label="Custom model provider" value={customProvider} onChange={(event) => setCustomProvider(event.target.value)} className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200">{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select>}
          <div className="flex gap-2"><input aria-label="Custom model ID" value={customId} onChange={(event) => setCustomId(event.target.value)} placeholder="Exact model ID" className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100" /><button type="submit" disabled={!customId.trim()} className="rounded-md bg-zinc-200 px-2 text-xs text-zinc-950 disabled:opacity-40">Use model</button></div>
        </form>}
      </div>
    </PopoverPanel>
  </>}</Popover>;
}

function ModelGroup({ provider, activeProvider, query, favoritesOnly, refresh, onSelect }: {
  provider: ProviderDef; activeProvider: string; query: string; favoritesOnly: boolean; refresh: number;
  onSelect: (providerId: string, modelId: string) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const model = useSettingsStore((s) => s.models[provider.id]);
  const favorites = useSettingsStore((s) => s.favoriteModels[provider.id]);
  const toggleFavorite = useSettingsStore((s) => s.toggleFavoriteModel);
  const binary = useSettingsStore((s) => s.cliBinaries[provider.id]);
  const baseUrl = useSettingsStore((s) => s.baseUrls[provider.id]);
  useEffect(() => {
    let disposed = false;
    setCatalog([]); setLoading(true); setError('');
    void loadProviderModels(provider.id).then((models) => { if (!disposed) setCatalog(models); })
      .catch((error) => { if (!disposed) setError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [provider.id, binary, baseUrl, refresh]);
  const needle = query.trim().toLowerCase();
  const filtered = catalog.filter((item) => (!favoritesOnly || favorites?.includes(item.id)) && `${provider.label} ${item.label} ${item.id}`.toLowerCase().includes(needle));
  const defaultId = catalog.find((item) => item.isDefault)?.id;
  const selectedId = model || defaultId || (provider.kind === 'api' ? catalog[0]?.id : '');
  const showDefault = provider.kind === 'cli' && !defaultId && !needle && !favoritesOnly && catalog.length > 0;
  if (!loading && !error && !filtered.length && needle) return null;
  return <section aria-label={`${provider.label} models`} className="mb-1 last:mb-0">
    <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-medium text-zinc-500"><ProviderIcon providerId={provider.id} size={12} /><span className="flex-1">{provider.label}</span>{loading && <Loader2 size={12} className="animate-spin" />}</div>
    {loading ? <p role="status" className="px-2 py-2 text-xs text-zinc-500">Loading models…</p> : error ? <p role="status" className="px-2 py-2 text-xs leading-5 text-zinc-400">{error}</p>
      : !filtered.length && !showDefault ? <p className="px-2 py-2 text-xs text-zinc-500">{favoritesOnly ? 'No favorite models.' : 'No models available.'}</p> : <>
        {showDefault && <button type="button" role="menuitemradio" aria-checked={provider.id === activeProvider && !model} onClick={() => onSelect(provider.id, '')} className="flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-[13px] text-zinc-200 hover:bg-white/[0.07] focus:bg-white/[0.07] focus:outline-none"><span className="flex-1">CLI default</span>{provider.id === activeProvider && !model && <Check size={13} />}</button>}
        {filtered.map((item) => {
          const selected = provider.id === activeProvider && selectedId === item.id;
          const favorite = !!favorites?.includes(item.id);
          return <div key={item.id} className={`flex items-center rounded-md ${selected ? 'bg-white/[0.05]' : ''}`}>
            <button type="button" role="menuitemradio" aria-label={`${provider.label}: ${item.label}`} aria-checked={selected} onClick={() => onSelect(provider.id, item.id)} className="flex min-w-0 flex-1 items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-[13px] text-zinc-200 hover:bg-white/[0.07] focus:bg-white/[0.07] focus:outline-none"><span className="min-w-0 flex-1 truncate" title={item.id}>{item.label}</span>{selected && <Check size={13} className="shrink-0 text-blue-400" />}</button>
            <button type="button" aria-label={`Favorite ${provider.label}: ${item.label}`} aria-pressed={favorite} onClick={() => toggleFavorite(provider.id, item.id)} className={`shrink-0 rounded-md p-2 hover:text-amber-300 ${favorite ? 'text-amber-400' : 'text-zinc-500'}`}><Star size={13} className={favorite ? 'fill-current' : ''} /></button>
          </div>;
        })}
      </>}
  </section>;
}
