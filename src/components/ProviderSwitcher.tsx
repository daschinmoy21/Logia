import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Settings2, Sparkles, Terminal } from 'lucide-react';
import { GROUP_LABELS, PROVIDERS, type ProviderGroup, resolveModel } from '../lib/ai/providers';
import { isProviderReady, useSettingsStore } from '../store/settingsStore';
import useUiStore from '../store/UiStore';
import { prefersReducedMotion } from '../lib/utils';

/** Compact dropdown to switch the active AI provider from the chat panel. */
export function ProviderSwitcher() {
  const settings = useSettingsStore();
  const setIsSettingsOpen = useUiStore((s) => s.setIsSettingsOpen);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const reduceMotion = prefersReducedMotion();

  const active = PROVIDERS.find((p) => p.id === settings.activeProvider) ?? PROVIDERS[0];
  const activeModel = resolveModel(active, settings.models);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const groups: ProviderGroup[] = ['cloud', 'local', 'cli'];

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 max-w-full rounded-md px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {active.kind === 'cli' ? <Terminal size={12} /> : <Sparkles size={12} className="text-blue-400" />}
        <span className="truncate">
          {active.label}
          {activeModel && <span className="text-zinc-600"> · {activeModel}</span>}
        </span>
        {!isProviderReady(active.id, settings) && (
          <span className="size-1.5 rounded-full bg-amber-400 flex-shrink-0" title="Not set up" />
        )}
        <ChevronDown size={12} className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className="absolute bottom-full left-0 mb-2 w-64 max-h-80 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/95 backdrop-blur-xl shadow-2xl py-1 z-50"
            role="listbox"
          >
            {groups.map((group) => (
              <div key={group}>
                <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                  {GROUP_LABELS[group]}
                </p>
                {PROVIDERS.filter((p) => p.group === group).map((p) => {
                  const ready = isProviderReady(p.id, settings);
                  const selected = p.id === active.id;
                  return (
                    <button
                      type="button"
                      key={p.id}
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        settings.setActiveProvider(p.id);
                        setOpen(false);
                        if (!ready) setIsSettingsOpen(true, 'ai');
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                        selected ? 'text-zinc-100 bg-zinc-800/70' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100'
                      }`}
                    >
                      <span className={`size-1.5 rounded-full flex-shrink-0 ${ready ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
                      <span className="truncate flex-1">{p.label}</span>
                      {!ready && <span className="text-[10px] text-zinc-600">set up</span>}
                      {selected && <Check size={12} className="text-blue-400" />}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="h-px bg-zinc-800 my-1" />
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setIsSettingsOpen(true, 'ai');
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
            >
              <Settings2 size={12} /> Manage providers…
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
