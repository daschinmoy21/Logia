import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { Check, ChevronDown, LockKeyhole, Pencil } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useSettingsStore, type EditApprovalMode } from '../../store/settingsStore';

const modes = [
  { id: 'supervised', label: 'Supervised', description: 'Ask before applying note changes.', icon: LockKeyhole },
  { id: 'auto-edits', label: 'Auto-accept edits', description: 'Apply Logia’s note changes without approval prompts.', icon: Pencil },
] satisfies { id: EditApprovalMode; label: string; description: string; icon: typeof Pencil }[];

export function EditApprovalPicker() {
  const mode = useSettingsStore((s) => s.editApprovalMode);
  const setMode = useSettingsStore((s) => s.setEditApprovalMode);
  const selected = modes.find((item) => item.id === mode) ?? modes[0];
  const Icon = selected.icon;
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    event.preventDefault(); event.stopPropagation(); items[next]?.focus();
  };
  return <Popover>{({ close }) => <>
    <PopoverButton type="button" aria-label={`Edit approval mode: ${selected.label}`}
      className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-100">
      <Icon size={13} /><span>{selected.label}</span><ChevronDown size={12} className="text-zinc-500" />
    </PopoverButton>
    <PopoverPanel focus portal anchor={{ to: 'top start', gap: 8, padding: 8 }} data-agent-menu
      role="menu" aria-label="Edit approval mode" onKeyDown={navigate}
      className="z-[1200] w-72 max-w-[calc(100vw-16px)] menu-surface rounded-lg border border-zinc-800 bg-zinc-900 p-1 shadow-xl shadow-black/50 focus:outline-none">
      {modes.map(({ id, label, description, icon: ModeIcon }) =>
        <button key={id} type="button" role="menuitemradio" aria-checked={mode === id} onClick={() => { setMode(id); close(); }}
          className="w-full rounded-[5px] px-2 py-1.5 text-left text-zinc-200 hover:bg-white/[0.07] focus:bg-white/[0.07] focus:outline-none">
          <span className="flex items-center gap-2 text-[13px]"><ModeIcon size={15} /><span className="flex-1">{label}</span>{mode === id && <Check size={14} className="text-blue-400" />}</span>
          <span className="mt-0.5 block text-xs leading-5 text-zinc-500">{description}</span>
        </button>)}
    </PopoverPanel>
  </>}</Popover>;
}
