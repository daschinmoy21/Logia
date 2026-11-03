import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, RefreshCw, Settings2, Sparkles } from 'lucide-react';
import { AGENT_TOOLS, isDesktopAgentHost, type AgentTool } from '../../lib/ai/agent-terminal';
import { ProviderIcon } from '../ProviderIcon';
import { useSettingsStore } from '../../store/settingsStore';
import useUiStore from '../../store/UiStore';
import {
  AVAILABILITY_LABELS,
  agentAvailability,
  isLiveSession,
  refreshAgentDetection,
  useAgentSessions,
} from './agentSessions';

export type AgentSelection = 'logia' | AgentTool;

const AVAILABILITY_TONE = {
  'desktop-only': 'text-zinc-500',
  checking: 'text-zinc-500',
  installed: 'text-emerald-400',
  missing: 'text-amber-400',
  unknown: 'text-zinc-500',
} as const;

interface AgentChooserProps {
  selected: AgentSelection;
  title: string;
  onSelect: (agent: AgentSelection) => void;
}

/** The panel's top chooser: Logia's own chat, or a terminal session with an external CLI. */
export function AgentChooser({ selected, title, onSelect }: AgentChooserProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const cliStatus = useSettingsStore((s) => s.cliStatus);
  const sessions = useAgentSessions((s) => s.sessions);
  const detecting = useAgentSessions((s) => s.detecting);

  useEffect(() => {
    if (!open) return;
    void refreshAgentDetection();
    menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const choose = (agent: AgentSelection) => {
    setOpen(false);
    onSelect(agent);
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focus = (i: number) => items[(i + items.length) % items.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
      case 'j':
        focus(index + 1);
        break;
      case 'ArrowUp':
      case 'k':
        focus(index - 1);
        break;
      case 'Home':
        focus(0);
        break;
      case 'End':
        focus(items.length - 1);
        break;
      case 'Escape':
        close();
        break;
      case 'Tab':
        setOpen(false);
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const itemClass = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors focus:outline-none';
  const itemTone = (active: boolean) =>
    active
      ? 'bg-zinc-800/70 text-zinc-100 focus:bg-zinc-700/70'
      : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100 focus:bg-zinc-800/60 focus:text-zinc-100';
  const selectedTool = AGENT_TOOLS.find((tool) => tool.id === selected);

  return (
    <div ref={rootRef} data-agent-menu className="relative min-w-0 flex-1" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Choose agent. Current: ${selectedTool?.label ?? 'Logia'}, ${title}`}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-900"
      >
        {selectedTool ? (
          <ProviderIcon providerId={selectedTool.id} size={16} />
        ) : (
          <Sparkles size={14} className="flex-shrink-0 text-blue-400" />
        )}
        <span className="truncate">{title}</span>
        <ChevronDown size={13} className={`flex-shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Agents"
          onKeyDown={onMenuKeyDown}
          className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-zinc-800 bg-zinc-900/95 py-1 shadow-2xl backdrop-blur-xl"
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={selected === 'logia'}
            onClick={() => choose('logia')}
            className={`${itemClass} ${itemTone(selected === 'logia')}`}
          >
            <Sparkles size={14} className="flex-shrink-0 text-blue-400" />
            <span className="flex-1 truncate">Logia</span>
            {selected === 'logia' && <Check size={13} className="text-blue-400" />}
          </button>

          <div className="my-1 h-px bg-zinc-800" />
          <p className="px-3 pt-1 pb-1 text-[11px] font-medium text-zinc-500">External agents</p>
          {AGENT_TOOLS.map((tool) => {
            const live = isLiveSession(sessions[tool.id]);
            const availability = agentAvailability(cliStatus[tool.id], detecting);
            return (
              <button
                key={tool.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected === tool.id}
                onClick={() => choose(tool.id)}
                className={`${itemClass} ${itemTone(selected === tool.id)}`}
              >
                <ProviderIcon providerId={tool.id} size={16} />
                <span className="flex-1 truncate">{tool.label}</span>
                <span className={`flex-shrink-0 text-[11px] ${live ? 'text-blue-300' : AVAILABILITY_TONE[availability]}`}>
                  {live ? 'Running' : AVAILABILITY_LABELS[availability]}
                </span>
                {selected === tool.id && <Check size={13} className="flex-shrink-0 text-blue-400" />}
              </button>
            );
          })}

          <div className="my-1 h-px bg-zinc-800" />
          <button
            type="button"
            role="menuitem"
            disabled={!isDesktopAgentHost()}
            onClick={() => void refreshAgentDetection()}
            className={`${itemClass} ${itemTone(false)} disabled:text-zinc-600`}
          >
            <RefreshCw size={13} className={`flex-shrink-0 ${detecting ? 'animate-spin' : ''}`} />
            Refresh detection
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              useUiStore.getState().setIsSettingsOpen(true, 'ai');
            }}
            className={`${itemClass} ${itemTone(false)}`}
          >
            <Settings2 size={13} className="flex-shrink-0" />
            Agent settings…
          </button>
        </div>
      )}
    </div>
  );
}
