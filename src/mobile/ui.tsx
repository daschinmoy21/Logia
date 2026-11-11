import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/utils';
import { useBackLayer } from './backStack';
import { useSnackbar } from './snackbar';

/** A round, thumb-sized icon button with a pressed state instead of hover. */
export function IconTap({
  label,
  onClick,
  children,
  className,
  pressed,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'm-press flex size-12 flex-shrink-0 items-center justify-center rounded-full text-m-text disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
}

export type SheetAction = {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  danger?: boolean;
};

/** A bottom sheet of actions. Back, the scrim, or Escape dismiss it. */
export function ActionSheet({
  open,
  title,
  subtitle,
  actions,
  onClose,
}: {
  open: boolean;
  title?: string;
  subtitle?: string;
  actions: SheetAction[];
  onClose: () => void;
}) {
  useBackLayer(open, onClose);
  useEscape(open, onClose);
  const titleId = useId();
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) firstRef.current?.focus({ preventScroll: true });
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="m-chrome fixed inset-0 z-[60]" data-mobile-layer>
      <div className="m-anim-fade absolute inset-0 bg-(--m-scrim)" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className="m-anim-sheet absolute inset-x-0 bottom-0 rounded-t-[28px] bg-m-raised pb-[calc(12px+var(--m-safe-bottom))] pt-2 shadow-(--m-shadow)"
      >
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-m-line" aria-hidden="true" />
        {title && (
          <div className="px-6 pb-2 pt-1">
            <h2 id={titleId} className="truncate text-[17px] font-semibold text-m-text">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-sm text-m-muted">{subtitle}</p>}
          </div>
        )}
        <ul className="px-2">
          {actions.map((action, index) => (
            <li key={action.label}>
              <button
                ref={index === 0 ? firstRef : undefined}
                type="button"
                onClick={() => {
                  onClose();
                  action.onSelect();
                }}
                className={cn(
                  'm-press flex h-14 w-full items-center gap-4 rounded-2xl px-4 text-left text-base',
                  action.danger ? 'text-m-danger' : 'text-m-text',
                )}
              >
                <span className={cn('flex-shrink-0', action.danger ? 'text-m-danger' : 'text-m-muted')} aria-hidden="true">{action.icon}</span>
                {action.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

/** A small popover menu under the top bar's overflow button. */
export function OverflowMenu({
  open,
  actions,
  onClose,
  label,
}: {
  open: boolean;
  actions: SheetAction[];
  onClose: () => void;
  label: string;
}) {
  useBackLayer(open, onClose);
  useEscape(open, onClose);
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) firstRef.current?.focus({ preventScroll: true });
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="m-chrome fixed inset-0 z-[60]" data-mobile-layer>
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        role="menu"
        aria-label={label}
        className="m-anim-pop absolute right-[calc(8px+var(--m-safe-right))] top-[calc(var(--m-vtop,0px)+var(--m-safe-top)+44px)] min-w-[220px] overflow-hidden rounded-2xl border border-m-line bg-m-raised py-1.5 shadow-(--m-shadow)"
      >
        {actions.map((action, index) => (
          <button
            key={action.label}
            ref={index === 0 ? firstRef : undefined}
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              action.onSelect();
            }}
            className={cn(
              'm-press flex h-12 w-full items-center gap-3.5 px-4 text-left text-[15px]',
              action.danger ? 'text-m-danger' : 'text-m-text',
            )}
          >
            <span className={cn('flex-shrink-0', action.danger ? 'text-m-danger' : 'text-m-muted')} aria-hidden="true">{action.icon}</span>
            {action.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/** The single snackbar. It sits above the bottom bar when there is one. */
export function Snackbar({ raised }: { raised: boolean }) {
  const snack = useSnackbar((s) => s.snack);
  const close = useSnackbar((s) => s.close);

  useEffect(() => {
    if (!snack) return;
    const timer = window.setTimeout(() => close('timeout'), snack.duration);
    return () => window.clearTimeout(timer);
  }, [snack, close]);

  if (!snack) return null;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-[70] flex justify-center px-3"
      style={{ bottom: raised ? 'calc(var(--m-nav-h) + var(--m-safe-bottom) + 12px)' : 'calc(var(--m-safe-bottom) + 16px)' }}
    >
      <div
        key={snack.id}
        role="status"
        aria-live="polite"
        className="m-anim-snack m-chrome pointer-events-auto flex min-h-12 w-full max-w-[560px] items-center gap-2 rounded-2xl bg-(--m-text) py-1.5 pl-4 pr-1.5 text-[15px] text-(--m-bg) shadow-(--m-shadow)"
      >
        <span className="min-w-0 flex-1 py-2 leading-snug">{snack.message}</span>
        {snack.actionLabel && (
          <button
            type="button"
            onClick={() => close('action')}
            className="m-press h-10 flex-shrink-0 rounded-xl px-3 text-[15px] font-semibold text-(--m-snack-action)"
          >
            {snack.actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/** Choose one of a few options. Reads as a radio group to assistive tech. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-full bg-m-fill p-1">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full text-[15px] font-medium transition-colors duration-150 motion-reduce:transition-none',
              selected ? 'bg-(--m-seg) text-m-text shadow-sm' : 'text-m-muted active:bg-m-press',
            )}
          >
            {option.icon}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
