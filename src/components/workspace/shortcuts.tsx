import useUiStore from '../../store/UiStore';

export type Shortcut = string[];

export const SHORTCUTS = {
  quickSwitch: ['Mod', 'P'],
  commands: ['Mod', 'Shift', 'P'],
  newNote: ['Mod', 'N'],
  dailyNote: ['Mod', 'Shift', 'D'],
  toggleAi: ['Mod', 'Shift', 'L'],
  contextPanel: ['Mod', '.'],
  sidebar: ['Mod', '\\'],
  closeTab: ['Mod', 'W'],
} satisfies Record<string, Shortcut>;

export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    || navigator.platform
    || '';
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

/** The platform's command modifier. Ctrl on a Mac stays free for text-field motions. */
export function hasMod(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac() ? e.metaKey : e.ctrlKey;
}

const keyLabel = (key: string) => {
  if (key === 'Mod') return isMac() ? '⌘' : 'Ctrl';
  if (key === 'Shift') return isMac() ? '⇧' : 'Shift';
  return key;
};

/** Plain-text form, for tooltips: "Ctrl+Shift+D". */
export function shortcutText(keys: Shortcut): string {
  return keys.map(keyLabel).join(isMac() ? '' : '+');
}

/** Value for the aria-keyshortcuts attribute: "Control+Shift+D". */
export function shortcutAria(keys: Shortcut): string {
  return keys.map((key) => (key === 'Mod' ? (isMac() ? 'Meta' : 'Control') : key)).join('+');
}

export function Kbd({ keys, className = '' }: { keys: Shortcut; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} aria-hidden="true">
      {keys.map((key) => (
        <kbd
          key={key}
          className="min-w-4 rounded-[4px] bg-white/[0.07] px-1 text-center font-mono text-[10px] leading-4 text-zinc-400"
        >
          {keyLabel(key)}
        </kbd>
      ))}
    </span>
  );
}

/** Any modal other than the palette itself: app shortcuts stay out of its way. */
export function isBlockingModalOpen(): boolean {
  const ui = useUiStore.getState();
  if (ui.isKanbanOpen || ui.isSupportOpen) return true;
  return !!document.querySelector('[role="dialog"]:not([data-command-palette]), [role="alertdialog"]');
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
