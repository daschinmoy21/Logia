import { AnimatePresence, motion } from 'framer-motion';
import { footerSaveLabel } from '../lib/note-utils';
import { prefersReducedMotion } from '../lib/utils';
import { useNotesStore } from '../store/notesStore';

interface FooterProps {
  wordCount: number;
  isSaved: boolean;
}

export default function Footer({ wordCount, isSaved }: FooterProps) {
  const saveError = useNotesStore((s) => s.saveError);
  const saveLabel = saveError ? 'Not saved' : footerSaveLabel(isSaved);
  const reduceMotion = prefersReducedMotion();

  return (
    <footer className="h-8 border-t border-zinc-800 px-6 flex items-center justify-between text-xs text-zinc-400 flex-shrink-0">
      <div className="flex items-center space-x-4">
        <span>Words: {wordCount}</span>
        <span
          className="inline-flex items-center min-w-[4.5rem]"
          aria-live="polite"
          data-testid="footer-save-status"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={saveLabel}
              initial={reduceMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className={saveError ? 'text-red-400' : isSaved ? 'text-zinc-500' : 'text-amber-400/90'}
            >
              {saveLabel}
            </motion.span>
          </AnimatePresence>
        </span>
        {saveError && (
          <button
            type="button"
            onClick={() => void useNotesStore.getState().saveCurrentNote().catch(() => {})}
            className="text-zinc-300 underline underline-offset-2 hover:text-white"
            title={saveError}
          >
            Retry
          </button>
        )}
      </div>
      <span className="hidden xl:inline text-[10px] text-zinc-500" title="Ctrl+H/L: left/right pane. Ctrl+J/K: next/previous pane.">Ctrl+H/J/K/L · panes</span>
    </footer>
  );
}
