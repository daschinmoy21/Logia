import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import {
  clampNormalCursor,
  composerCursorPosition,
  composerVimEscape,
  composerVimKey,
  initialComposerVim,
  type ComposerVimMode,
  type ComposerVimState,
} from '../lib/vim/composerVim';

interface Options {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  enabled: boolean;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

/** Keeps a caret moved by j/k inside a scrolled textarea. Soft-wrapped lines make this approximate. */
function revealRow(el: HTMLTextAreaElement, row: number) {
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
  const top = (row - 1) * lineHeight;
  if (top < el.scrollTop) el.scrollTop = top;
  else if (top + lineHeight * 2 > el.scrollTop + el.clientHeight) el.scrollTop = top + lineHeight * 2 - el.clientHeight;
}

/**
 * Vim for a controlled textarea. Text and caret stay in the DOM, so typing,
 * paste, IME and mouse selection keep working natively; only normal-mode keys
 * are translated here.
 */
export function useComposerVim({ textareaRef, enabled, value, onChange, onSubmit }: Options) {
  const [mode, setMode] = useState<ComposerVimMode>('insert');
  const [pending, setPending] = useState('');
  const [position, setPosition] = useState({ row: 1, col: 1 });
  const vim = useRef<ComposerVimState>(initialComposerVim());
  const nextCursor = useRef<number | null>(null);

  const syncPosition = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const next = composerCursorPosition(el.value, el.selectionStart);
    setPosition((prev) => (prev.row === next.row && prev.col === next.col ? prev : next));
  }, [textareaRef]);

  useEffect(() => {
    vim.current = initialComposerVim();
    setMode('insert');
    setPending('');
  }, [enabled]);

  // React moves the caret to the end when it writes a new value; put it back.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el && nextCursor.current !== null) {
      el.setSelectionRange(nextCursor.current, nextCursor.current);
      nextCursor.current = null;
      revealRow(el, composerCursorPosition(el.value, el.selectionStart).row);
    }
    syncPosition();
  }, [value, textareaRef, syncPosition]);

  const run = (step: (state: ComposerVimState) => ComposerVimState) => {
    const el = textareaRef.current;
    if (!el) return;
    const next = step({ ...vim.current, text: el.value, cursor: el.selectionStart });
    vim.current = next;
    setMode(next.mode);
    setPending(next.count + next.pending);
    if (next.text !== el.value) {
      nextCursor.current = next.cursor;
      onChange(next.text);
    } else {
      el.setSelectionRange(next.cursor, next.cursor);
      revealRow(el, composerCursorPosition(el.value, next.cursor).row);
      syncPosition();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const plainEnter = e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;

    if (!enabled) {
      if (plainEnter) {
        e.preventDefault();
        onSubmit();
      }
      return;
    }

    if (e.key === 'Escape' || (e.ctrlKey && e.key === '[')) {
      e.preventDefault();
      e.stopPropagation();
      run(composerVimEscape);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (vim.current.mode === 'insert') {
      if (plainEnter) {
        e.preventDefault();
        onSubmit();
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (plainEnter) onSubmit();
      return;
    }
    const key = e.key === 'Backspace' ? 'h' : e.key === 'Delete' ? 'x' : e.key === ' ' ? 'l' : e.key;
    if ([...key].length > 1) return; // Named keys (Tab, arrows, Home…) keep their native behaviour.
    e.preventDefault();
    run((state) => composerVimKey(state, key));
  };

  const onSelect = () => {
    const el = textareaRef.current;
    if (!el) return;
    // A click past the end of a line rests on its last character, like Vim.
    if (enabled && vim.current.mode === 'normal' && el.selectionStart === el.selectionEnd) {
      const clamped = clampNormalCursor(el.value, el.selectionStart);
      if (clamped !== el.selectionStart) el.setSelectionRange(clamped, clamped);
    }
    syncPosition();
  };

  return {
    mode,
    pending,
    row: position.row,
    col: position.col,
    textareaProps: {
      onKeyDown,
      onSelect,
      // VimController leaves Escape alone on elements carrying this attribute.
      'data-composer-vim': enabled ? mode : undefined,
    },
  };
}
