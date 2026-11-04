import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { Check, ChevronDown, Loader2, Plus, RefreshCw, Search, Star } from 'lucide-react';
import { AGENT_TOOLS, type AgentTool } from '../lib/ai/agent-terminal';
import { getProvider, PROVIDERS, resolveModel, type ProviderDef } from '../lib/ai/providers';
import { loadProviderModels, type CatalogModel } from '../lib/ai/model-catalog';
import { useSettingsStore } from '../store/settingsStore';
import useUiStore from '../store/UiStore';
import { ProviderIcon } from './ProviderIcon';
import { Tip } from './ui/kit';

/** How many models a provider lists before "Show more". */
const SHORT_LIST = 6;

interface ModelPickerProps {
  providerId: string;
  disabled?: boolean;
  /** 'agents' adds a rail for switching between agent CLIs. */
  scope?: 'provider' | 'agents';
  /** Agents scope: a model from another agent was picked, so switch to that agent. */
  onSwitchAgent?: (agent: AgentTool) => void;
  placement?: 'above' | 'below';
  defaultModelLabel?: string;
}

/** A small anchored menu; selecting a model applies it and closes the menu. */
export function ModelPicker({ providerId, disabled = false, scope = 'provider', placement = 'above', defaultModelLabel, onSwitchAgent }: ModelPickerProps) {
  const settings = useSettingsStore();
  const active = getProvider(providerId) ?? PROVIDERS[0];
  const model = resolveModel(active, settings.models);
  const [query, setQuery] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [view, setView] = useState(providerId);
  const [refresh, setRefresh] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const [custom, setCustom] = useState(false);
  const [customProvider, setCustomProvider] = useState(providerId);
  const [customId, setCustomId] = useState('');
  const providers = useMemo(() => scope === 'provider' ? [active] : PROVIDERS.filter((p) =>
    AGENT_TOOLS.some((tool) => tool.id === p.id) && (p.id === providerId || settings.cliStatus[p.id]?.available)),
  [scope, active, providerId, settings.cliStatus]);

  const select = (id: string, modelId: string) => {
    settings.setModel(id, modelId);
    if (scope === 'agents' && id !== providerId) onSwitchAgent?.(id as AgentTool);
  };
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (event.target instanceof HTMLInputElement && ['Home', 'End'].includes(event.key)) return;
    // Other providers stay mounted but hidden, so switching between them is instant.
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].filter((item) => item.offsetParent);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : current === -1 ? (event.key === 'ArrowUp' ? items.length - 1 : 0)
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    event.preventDefault(); event.stopPropagation(); items[index].focus();
  };

  const hasRail = scope === 'agents';
  const shownView = providers.some((provider) => provider.id === view) ? view : providers[0]?.id;
  // Searching and favorites look across every provider; otherwise one provider at a time.
  const acrossProviders = !hasRail || !!query.trim() || favoritesOnly;

  const railButton = (selected: boolean) => `relative flex size-8 items-center justify-center rounded-md hover:bg-white/[0.07] ${
    selected ? 'bg-white/[0.09] after:absolute after:-left-1.5 after:inset-y-1.5 after:w-0.5 after:rounded-full after:bg-blue-500' : ''
  }`;

  return <Popover className="min-w-0">{({ close }) => <>
    <PopoverButton type="button" disabled={disabled} onClick={() => { setQuery(''); setCustom(false); setCustomProvider(providerId); setView(providerId); setFavoritesOnly(false); }}
      aria-label={`Choose model for ${active.label}. Current: ${model || 'Provider default'}`}
      className="flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md px-1.5 text-xs text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-100 data-[open]:bg-white/[0.07] disabled:opacity-50">
      <ProviderIcon providerId={active.id} size={14} /><span className="truncate">{model || defaultModelLabel || 'Provider default'}</span><ChevronDown size={12} className="shrink-0 text-zinc-500" />
    </PopoverButton>
    <PopoverPanel focus portal anchor={{ to: placement === 'above' ? 'top start' : 'bottom start', gap: 8, padding: 8 }}
      data-agent-menu data-testid="model-dropdown" aria-label="Model picker" onKeyDown={navigate}
      className={`z-[1200] flex w-[22rem] max-w-[calc(100vw-16px)] overflow-hidden menu-surface rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl shadow-black/50 focus:outline-none ${
        hasRail ? 'h-[min(22rem,var(--available-height,22rem))]' : 'max-h-[min(24rem,var(--available-height,24rem))]'
      }`}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Search size={14} className="shrink-0 text-zinc-500" />
        <input ref={searchRef} autoFocus aria-label="Find a model" placeholder="Search models…" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent py-1 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus-visible:outline-none" />
        {!hasRail && <button type="button" aria-label="Show favorite models" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly((value) => !value)} className={`rounded p-1 hover:bg-zinc-800 ${favoritesOnly ? 'text-amber-300' : 'text-zinc-500'}`}><Star size={13} className={favoritesOnly ? 'fill-current' : ''} /></button>}
        <button type="button" aria-label="Refresh models" onClick={() => setRefresh((value) => value + 1)} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><RefreshCw size={13} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5" role="menu" aria-label="Models">
        {providers.map((provider) => <ModelGroup key={provider.id} provider={provider} activeProvider={providerId} query={query} favoritesOnly={favoritesOnly} refresh={refresh}
          hidden={!acrossProviders && provider.id !== shownView} showHeader={hasRail && acrossProviders}
          onSelect={(id, modelId) => { select(id, modelId); close(); }} />)}
      </div>
      <div className="shrink-0 border-t border-zinc-800 p-2">
        <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
          <button type="button" onClick={() => setCustom((value) => !value)} aria-expanded={custom} className="rounded px-1 py-1 hover:text-zinc-200">Use a custom model ID</button>
          {hasRail && <button type="button" onClick={() => { close(); useUiStore.getState().setIsSettingsOpen(true, 'ai'); }} className="inline-flex items-center gap-1 px-1 py-1 hover:text-zinc-200"><Plus size={12} /> Providers</button>}
        </div>
        {custom && <form className="mt-2 flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); if (customId.trim()) { select(customProvider, customId.trim()); close(); } }}>
          {hasRail && <select aria-label="Custom model provider" value={customProvider} onChange={(event) => setCustomProvider(event.target.value)} className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200">{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select>}
          <div className="flex gap-2"><input aria-label="Custom model ID" value={customId} onChange={(event) => setCustomId(event.target.value)} placeholder="Exact model ID" className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100" /><button type="submit" disabled={!customId.trim()} className="rounded-md bg-zinc-200 px-2 text-xs text-zinc-950 disabled:opacity-40">Use model</button></div>
        </form>}
      </div>
      </div>
      {/* Last in the DOM so the panel's opening focus lands on the search field. */}
      {hasRail && <div role="group" aria-label="Providers" className="order-first flex w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-zinc-800 py-1.5">
        <Tip label="Favorites" side="right">
          <button type="button" aria-label="Show favorite models" aria-pressed={favoritesOnly} onClick={() => { setFavoritesOnly((value) => !value); setQuery(''); searchRef.current?.focus(); }} className={`${railButton(favoritesOnly)} ${favoritesOnly ? 'text-amber-300' : 'text-zinc-400'}`}><Star size={15} className={favoritesOnly ? 'fill-current' : ''} /></button>
        </Tip>
        <div className="h-px w-5 shrink-0 bg-zinc-800" />
        {providers.map((provider) => <Tip key={provider.id} label={provider.label} side="right">
          <button type="button" aria-label={`Show ${provider.label} models`} aria-pressed={!acrossProviders && shownView === provider.id} onClick={() => { setView(provider.id); setFavoritesOnly(false); setQuery(''); searchRef.current?.focus(); }} className={railButton(!acrossProviders && shownView === provider.id)}><ProviderIcon providerId={provider.id} size={17} /></button>
        </Tip>)}
      </div>}
    </PopoverPanel>
  </>}</Popover>;
}

function ModelGroup({ provider, activeProvider, query, favoritesOnly, refresh, hidden, showHeader, onSelect }: {
  provider: ProviderDef; activeProvider: string; query: string; favoritesOnly: boolean; refresh: number; hidden: boolean; showHeader: boolean;
  onSelect: (providerId: string, modelId: string) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
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
  // Favorites with nothing to show would only add empty headings across providers.
  if (!loading && !error && !filtered.length && (needle || (favoritesOnly && showHeader))) return null;
  const shortened = !expanded && !needle && !favoritesOnly && filtered.length > SHORT_LIST;
  // The current model stays in the short list even when it sorts further down.
  const shown = shortened
    ? filtered.filter((item, index) => index < SHORT_LIST || (provider.id === activeProvider && item.id === selectedId))
    : filtered;
  return <section hidden={hidden} aria-label={`${provider.label} models`} className="mb-1 last:mb-0">
    {showHeader && <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-medium text-zinc-500"><ProviderIcon providerId={provider.id} size={12} /><span className="flex-1">{provider.label}</span>{loading && <Loader2 size={12} className="animate-spin" />}</div>}
    {loading ? <p role="status" className="px-2 py-2 text-xs text-zinc-500">Loading models…</p> : error ? <p role="status" className="px-2 py-2 text-xs leading-5 text-zinc-400">{error}</p>
      : !filtered.length && !showDefault ? <p className="px-2 py-2 text-xs text-zinc-500">{favoritesOnly ? 'No favorite models.' : 'No models available.'}</p> : <>
        {showDefault && <button type="button" role="menuitemradio" aria-checked={provider.id === activeProvider && !model} onClick={() => onSelect(provider.id, '')} className="flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-[13px] text-zinc-200 hover:bg-white/[0.07] focus:bg-white/[0.07] focus:outline-none"><span className="flex-1">CLI default</span>{provider.id === activeProvider && !model && <Check size={13} />}</button>}
        {shown.map((item) => {
          const selected = provider.id === activeProvider && selectedId === item.id;
          const favorite = !!favorites?.includes(item.id);
          return <div key={item.id} className={`flex items-center rounded-md ${selected ? 'bg-white/[0.05]' : ''}`}>
            <button type="button" role="menuitemradio" aria-label={`${provider.label}: ${item.label}`} aria-checked={selected} onClick={() => onSelect(provider.id, item.id)} className="flex min-w-0 flex-1 items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-[13px] text-zinc-200 hover:bg-white/[0.07] focus:bg-white/[0.07] focus:outline-none"><span className="min-w-0 flex-1 truncate" title={item.id}>{item.label}</span>{selected && <Check size={13} className="shrink-0 text-blue-400" />}</button>
            <button type="button" aria-label={`Favorite ${provider.label}: ${item.label}`} aria-pressed={favorite} onClick={() => toggleFavorite(provider.id, item.id)} className={`shrink-0 rounded-md p-2 hover:text-amber-300 ${favorite ? 'text-amber-400' : 'text-zinc-500'}`}><Star size={13} className={favorite ? 'fill-current' : ''} /></button>
          </div>;
        })}
        {shortened && <button type="button" onClick={() => setExpanded(true)} className="w-full rounded-[5px] px-2 py-1.5 text-left text-xs text-zinc-500 hover:bg-white/[0.07] hover:text-zinc-200">Show {filtered.length - shown.length} more</button>}
      </>}
  </section>;
}
