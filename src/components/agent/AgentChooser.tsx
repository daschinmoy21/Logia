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

  const itemClass = 'flex h-7 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[13px] focus:outline-none';
  const itemTone = (active: boolean) =>
    active
      ? 'text-zinc-100 hover:bg-white/[0.07] focus:bg-white/[0.07]'
      : 'text-zinc-200 hover:bg-white/[0.07] focus:bg-white/[0.07]';
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
        className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-xs font-medium text-zinc-200 hover:bg-white/[0.07]"
      >
        {selectedTool ? (
          <ProviderIcon providerId={selectedTool.id} size={16} />
        ) : (
          <Sparkles size={14} className="flex-shrink-0 text-zinc-400" />
        )}
        <span className="truncate">{title}</span>
        <ChevronDown size={12} className="flex-shrink-0 text-zinc-500" />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Agents"
          onKeyDown={onMenuKeyDown}
          className="menu-surface absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-zinc-800 bg-zinc-900 p-1 shadow-xl shadow-black/50"
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={selected === 'logia'}
            onClick={() => choose('logia')}
            className={`${itemClass} ${itemTone(selected === 'logia')}`}
          >
            <Sparkles size={14} className="flex-shrink-0 text-zinc-400" />
            <span className="flex-1 truncate">Logia</span>
            {selected === 'logia' && <Check size={13} className="text-zinc-300" />}
          </button>

          <div className="-mx-1 my-1 h-px bg-zinc-800" />
          <p className="px-2 pb-1 pt-1 text-[11px] font-medium text-zinc-500">External agents</p>
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
                <span className={`flex-shrink-0 text-[11px] ${live ? 'text-zinc-200' : AVAILABILITY_TONE[availability]}`}>
                  {live ? 'Running' : AVAILABILITY_LABELS[availability]}
                </span>
                {selected === tool.id && <Check size={13} className="flex-shrink-0 text-zinc-300" />}
              </button>
            );
          })}

          <div className="-mx-1 my-1 h-px bg-zinc-800" />
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
