import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { useComposerVim } from '../../hooks/useComposerVim';
import { useSettingsStore } from '../../store/settingsStore';

/** Unsent text survives closing the panel or switching agents, but not a restart. */
const drafts = new Map<string, string>();

const MAX_HEIGHT = 160;

interface AgentComposerProps {
  draftKey: string;
  label: string;
  placeholder: string;
  busy?: boolean;
  canSend?: boolean;
  sendLabel?: string;
  /** Return false to keep the draft, for example when the provider isn't ready. */
  onSend: (text: string) => boolean;
  onStop?: () => void;
  leading?: ReactNode;
  autoFocus?: boolean;
}

/** The agent bar's text input, with its own Vim mode independent of the note editor's. */
export function AgentComposer({
  draftKey,
  label,
  placeholder,
  busy = false,
  canSend = true,
  sendLabel = 'Send message',
  onSend,
  onStop,
  leading,
  autoFocus = false,
}: AgentComposerProps) {
  const vimEnabled = useSettingsStore((s) => s.composerVim ?? s.vimEnabled);
  const setComposerVim = useSettingsStore((s) => s.setComposerVim);
  const [draft, setDraftState] = useState(() => drafts.get(draftKey) ?? '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const setDraft = (text: string) => {
    drafts.set(draftKey, text);
    setDraftState(text);
  };

  const hasText = !!draft.trim();
  const submit = () => {
    if (busy || !canSend || !hasText) return;
    if (onSend(draft.trim())) setDraft('');
  };

  const vim = useComposerVim({ textareaRef, enabled: vimEnabled, value: draft, onChange: setDraft, onSubmit: submit });

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [draft]);

  const normal = vimEnabled && vim.mode === 'normal';

  return (
    <div className="shrink-0 bg-zinc-950 px-3 pb-3 pt-2" data-vim-escape-to-editor>
      <div
        className={`rounded-2xl border bg-zinc-900/80 shadow-lg shadow-black/10 transition-colors focus-within:border-zinc-600 ${
          busy ? 'border-red-500/40' : 'border-zinc-800'
        }`}
      >
        <textarea
          ref={textareaRef}
          autoFocus={autoFocus}
          data-agent-composer
          value={draft}
          rows={3}
          aria-label={label}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          className={`block w-full resize-none bg-transparent px-4 pt-4 pb-3 text-[13px] leading-6 text-zinc-100 placeholder:text-zinc-500 focus:outline-none ${
            normal ? 'caret-amber-300' : 'caret-zinc-100'
          }`}
          {...vim.textareaProps}
        />
        <div className="flex items-end justify-between gap-2 px-2.5 pb-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-1">{leading}</div>
          {busy && onStop ? (
            <button
              type="button"
              onClick={onStop}
              className="flex size-8 flex-shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-300 transition-colors hover:bg-red-500/30"
              title="Stop generating"
              aria-label="Stop generating"
            >
              <Square size={12} className="fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={busy || !canSend || !hasText}
              className="flex size-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-500 text-white transition-colors hover:bg-indigo-400 disabled:bg-zinc-800 disabled:text-zinc-500"
              title={sendLabel}
              aria-label={sendLabel}
            >
              <ArrowUp size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 px-1 font-mono text-[10px] text-zinc-500">
        {vimEnabled ? (
          <span className="flex min-w-0 items-center gap-2">
            <span
              role="status"
              data-testid="composer-vim-mode"
              className={normal ? 'text-amber-300' : 'text-zinc-300'}
            >
              -- {vim.mode.toUpperCase()} --
            </span>
            <span data-testid="composer-vim-position">
              {vim.row}:{vim.col}
            </span>
            {vim.pending && <span className="text-zinc-400">{vim.pending}</span>}
          </span>
        ) : (
          <span className="truncate">Enter sends · Shift+Enter adds a line</span>
        )}
        <button
          type="button"
          onClick={() => setComposerVim(!vimEnabled)}
          aria-pressed={vimEnabled}
          title={vimEnabled ? 'Turn off Vim keys in this composer' : 'Use Vim keys in this composer'}
          className={`flex-shrink-0 rounded px-1.5 py-0.5 transition-colors hover:bg-zinc-900 hover:text-zinc-200 ${
            vimEnabled ? 'text-blue-300' : 'text-zinc-500'
          }`}
        >
          Vim {vimEnabled ? 'on' : 'off'}
        </button>
      </div>
    </div>
  );
}
