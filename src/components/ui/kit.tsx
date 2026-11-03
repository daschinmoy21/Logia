import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Tooltip } from 'radix-ui';
import { Kbd, type Shortcut } from '../workspace/shortcuts';

/** A hover hint with an optional shortcut. Needs the provider mounted in App. */
export function Tip({
  label,
  shortcut,
  side = 'bottom',
  children,
}: {
  label: ReactNode;
  shortcut?: Shortcut;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="pointer-events-none z-[100000] flex max-w-72 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 shadow-lg shadow-black/40"
        >
          {label}
          {shortcut && <Kbd keys={shortcut} />}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The accessible name; also the hover hint unless `hint` overrides it. */
  label: string;
  hint?: ReactNode;
  shortcut?: Shortcut;
  active?: boolean;
  side?: 'top' | 'right' | 'bottom' | 'left';
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({ label, hint, shortcut, active, side, className = '', children, ref, ...props }: IconButtonProps) {
  return (
    <Tip label={hint ?? label} shortcut={shortcut} side={side}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        {...props}
        className={`inline-flex size-7 flex-shrink-0 items-center justify-center rounded-md hover:bg-white/[0.07] active:bg-white/10 disabled:pointer-events-none disabled:opacity-40 ${
          active ? 'bg-white/[0.08] text-zinc-100' : 'text-zinc-400 hover:text-zinc-100'
        } ${className}`}
      >
        {children}
      </button>
    </Tip>
  );
}

const BUTTON_VARIANTS = {
  primary: 'bg-blue-500 text-zinc-925 hover:bg-blue-400 disabled:bg-zinc-800 disabled:text-zinc-500',
  secondary: 'border border-zinc-800 bg-zinc-900 text-zinc-200 hover:border-zinc-700 hover:bg-zinc-800 disabled:text-zinc-600',
  ghost: 'text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-100 disabled:text-zinc-600',
  danger: 'bg-red-500/90 text-white hover:bg-red-500 disabled:opacity-50',
  'danger-ghost': 'text-red-300 hover:bg-red-500/10 disabled:opacity-50',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: 'sm' | 'md';
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = 'secondary', size = 'md', className = '', ref, ...props }: ButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      {...props}
      className={`inline-flex flex-shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium disabled:cursor-not-allowed ${
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-2.5 text-[13px]'
      } ${BUTTON_VARIANTS[variant]} ${className}`}
    />
  );
}
