import type { ComponentProps, ReactNode } from 'react';
import { DropdownMenu } from 'radix-ui';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { Kbd, type Shortcut } from '../workspace/shortcuts';

const SURFACE =
  'menu-surface z-[1200] max-h-[min(26rem,var(--radix-dropdown-menu-content-available-height))] min-w-48 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 p-1 text-[13px] text-zinc-200 shadow-xl shadow-black/50 outline-none';
const ITEM =
  'flex h-7 cursor-default select-none items-center gap-2 rounded-[5px] px-2 outline-none data-[disabled]:pointer-events-none data-[disabled]:text-zinc-600 data-[highlighted]:bg-white/[0.07] data-[state=open]:bg-white/[0.07]';

/** Non-modal, so the page behind keeps scrolling and a click elsewhere just closes it. */
export function Menu(props: ComponentProps<typeof DropdownMenu.Root>) {
  return <DropdownMenu.Root modal={false} {...props} />;
}

export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({ align = 'start', sideOffset = 4, collisionPadding = 8, className = '', ...props }: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      {/* data-agent-menu keeps Vim from claiming j/k/Escape while a menu is open. */}
      <DropdownMenu.Content
        data-agent-menu
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={`${SURFACE} ${className}`}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

export function MenuItem({
  icon,
  shortcut,
  danger,
  className = '',
  children,
  ...props
}: ComponentProps<typeof DropdownMenu.Item> & { icon?: ReactNode; shortcut?: Shortcut; danger?: boolean }) {
  return (
    <DropdownMenu.Item
      className={`${ITEM} ${danger ? 'text-red-300 data-[highlighted]:bg-red-500/10' : ''} ${className}`}
      {...props}
    >
      {icon && <span className={`flex size-4 flex-shrink-0 items-center justify-center ${danger ? '' : 'text-zinc-400'}`} aria-hidden="true">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && <Kbd keys={shortcut} className="ml-4" />}
    </DropdownMenu.Item>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-zinc-800" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="px-2 pb-1 pt-1.5 font-mono text-[11px] text-zinc-500">{children}</DropdownMenu.Label>;
}

export function MenuSub({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={ITEM}>
        {icon && <span className="flex size-4 flex-shrink-0 items-center justify-center text-zinc-400" aria-hidden="true">{icon}</span>}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight size={13} className="flex-shrink-0 text-zinc-500" aria-hidden="true" />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent data-agent-menu sideOffset={4} collisionPadding={8} className={SURFACE}>
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

/** A compact replacement for a native select: the trigger names the current value. */
export function PillSelect({
  label,
  icon,
  value,
  options,
  disabled,
  onChange,
  align = 'start',
  side,
}: {
  label: string;
  icon?: ReactNode;
  value: string;
  options: SelectOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
  align?: 'start' | 'end';
  side?: 'top' | 'bottom';
}) {
  const current = options.find((option) => option.value === value)?.label ?? value;
  return (
    <Menu>
      <MenuTrigger
        disabled={disabled}
        aria-label={`${label}: ${current}`}
        className="flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs text-zinc-400 outline-none hover:bg-white/[0.07] hover:text-zinc-100 focus-visible:ring-1 focus-visible:ring-blue-500 disabled:opacity-50 data-[state=open]:bg-white/[0.07] data-[state=open]:text-zinc-100"
      >
        {icon && <span className="flex-shrink-0" aria-hidden="true">{icon}</span>}
        <span className="truncate">{current}</span>
        <ChevronDown size={12} className="flex-shrink-0 text-zinc-500" aria-hidden="true" />
      </MenuTrigger>
      <MenuContent align={align} side={side} className="min-w-36" aria-label={label}>
        <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
          {options.map((option) => (
            <DropdownMenu.RadioItem key={option.value} value={option.value} className={ITEM}>
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              <DropdownMenu.ItemIndicator>
                <Check size={13} className="text-blue-400" aria-hidden="true" />
              </DropdownMenu.ItemIndicator>
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
      </MenuContent>
    </Menu>
  );
}

/** Pointer coordinates ignore the UI scale's `zoom`, but fixed positions are scaled by it. */
export function pointerToCss(value: number) {
  return value / (Number(getComputedStyle(document.documentElement).zoom) || 1);
}

/** A menu that opens at a point, for right-clicks: anchored to an invisible trigger there. */
export function AnchoredMenu({
  x,
  y,
  onClose,
  onCloseAutoFocus,
  children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  children: ReactNode;
}) {
  return (
    <Menu open onOpenChange={(open) => { if (!open) onClose(); }}>
      <MenuTrigger asChild>
        <span aria-hidden="true" style={{ position: 'fixed', left: pointerToCss(x), top: pointerToCss(y), width: 0, height: 0 }} />
      </MenuTrigger>
      <MenuContent sideOffset={2} onCloseAutoFocus={onCloseAutoFocus}>
        {children}
      </MenuContent>
    </Menu>
  );
}
