import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CircleCheckBig, NotebookText, Settings2 } from 'lucide-react';
import '../App.css';
import './mobile.css';
import { useNotesStore } from '../store/notesStore';
import { getNoteText } from '../lib/workspace';
import type { Note } from '../types/Note';
import { cn } from '../lib/utils';
import { useMobileStore, TEXT_SIZES, type MobileTab } from './mobileStore';
import { useViewportVars } from './useViewport';
import { useBackLayer, useNativeBackButton } from './backStack';
import { NotesScreen } from './NotesScreen';
import { MobileEditor } from './MobileEditor';
import { TasksScreen } from './TasksScreen';
import { SettingsScreen } from './SettingsScreen';
import { Snackbar } from './ui';
import { flushPendingDeletes } from './noteActions';

const DARK_QUERY = '(prefers-color-scheme: dark)';

// Before the first paint, so a light theme never flashes the desktop's dark canvas.
{
  const preference = useMobileStore.getState().theme;
  const dark = preference === 'dark' || (preference === 'system' && (window.matchMedia?.(DARK_QUERY).matches ?? true));
  document.documentElement.dataset.shell = 'mobile';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function useResolvedTheme() {
  const preference = useMobileStore((s) => s.theme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.(DARK_QUERY).matches ?? true);
  useEffect(() => {
    const query = window.matchMedia?.(DARK_QUERY);
    if (!query) return;
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  const theme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.shell = 'mobile';
    root.dataset.theme = theme;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = theme === 'dark' ? '#121110' : '#fbf8f3';
  }, [theme]);
  return theme;
}

const TABS: Array<{ id: MobileTab; label: string; icon: (active: boolean) => ReactNode }> = [
  { id: 'notes', label: 'Notes', icon: (active) => <NotebookText size={20} strokeWidth={active ? 2.2 : 1.8} /> },
  { id: 'tasks', label: 'Tasks', icon: (active) => <CircleCheckBig size={20} strokeWidth={active ? 2.2 : 1.8} /> },
  { id: 'settings', label: 'Settings', icon: (active) => <Settings2 size={20} strokeWidth={active ? 2.2 : 1.8} /> },
];

function BottomNav({ tab, onChange }: { tab: MobileTab; onChange: (tab: MobileTab) => void }) {
  return (
    <nav
      aria-label="Sections"
      className="m-chrome absolute inset-x-0 bottom-0 z-20 border-t border-m-line/70 bg-m-surface pb-(--m-safe-bottom) pl-(--m-safe-left) pr-(--m-safe-right)"
    >
      <div className="flex h-(--m-nav-h) items-stretch">
        {TABS.map((item) => {
          const active = item.id === tab;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onChange(item.id)}
              className="flex flex-1 flex-col items-center justify-center gap-0.5"
            >
              <span
                className={cn(
                  'flex h-7 w-14 items-center justify-center rounded-full transition-colors duration-200 motion-reduce:transition-none',
                  active ? 'bg-m-accent-soft text-m-accent' : 'text-m-muted active:bg-m-press',
                )}
                aria-hidden="true"
              >
                {item.icon(active)}
              </span>
              <span className={cn('text-[11.5px] leading-none', active ? 'font-semibold text-m-text' : 'font-medium text-m-muted')}>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** Notes made and left untouched in this session are cleared away on the way out, like a blank page never kept. */
const freshNotes = new Map<string, string>();

function isBlank(note: Note) {
  return note.note_type !== 'canvas' && getNoteText(note.content).trim() === '';
}

export default function MobileApp() {
  const theme = useResolvedTheme();
  const reduceMotion = useReducedMotion();
  const tab = useMobileStore((s) => s.tab);
  const setTab = useMobileStore((s) => s.setTab);
  const textSize = useMobileStore((s) => s.textSize);
  const currentNote = useNotesStore((s) => s.currentNote);
  useViewportVars();
  useNativeBackButton();

  useEffect(() => {
    document.documentElement.style.setProperty('--m-editor-size', `${TEXT_SIZES[textSize]}px`);
  }, [textSize]);

  // TODO(sync): pull remote changes here before reloading. For now this rereads local storage.
  const onRefresh = useCallback(async () => {
    const { loadNotes, loadFolders } = useNotesStore.getState();
    await Promise.all([loadNotes(), loadFolders()]);
  }, []);

  useEffect(() => {
    void onRefresh();
  }, [onRefresh]);

  // Android may stop the app any time after it leaves the screen: settle edits and deletes first.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return;
      const notes = useNotesStore.getState();
      if (notes.saveTimeout || notes.saveError) void notes.saveCurrentNote().catch(() => {});
      flushPendingDeletes();
    };
    const onPageHide = () => {
      flushPendingDeletes();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  // Remember notes that start blank, so leaving them blank doesn't leave clutter behind.
  useEffect(() => {
    if (currentNote && !freshNotes.has(currentNote.id) && isBlank(currentNote) && Date.now() - Date.parse(currentNote.created_at) < 10_000) {
      freshNotes.set(currentNote.id, currentNote.content);
    }
  }, [currentNote]);

  const closeEditor = useCallback(async () => {
    const notes = useNotesStore.getState();
    const note = notes.currentNote;
    if (!note) return;
    await notes.selectNote(null);
    if (freshNotes.has(note.id)) {
      freshNotes.delete(note.id);
      const latest = useNotesStore.getState().notes.find((n) => n.id === note.id);
      // Quietly: a browser workspace can't delete, and a blank note is harmless.
      if (latest && isBlank(latest)) void useNotesStore.getState().deleteNote(note.id).catch(() => {});
    }
  }, []);

  const openNote = useCallback((note: Note) => {
    void useNotesStore.getState().selectNote(note);
  }, []);

  const editorOpen = !!currentNote;
  useBackLayer(editorOpen, () => void closeEditor());
  // Back from another tab goes to Notes first, then out of the app.
  useBackLayer(tab !== 'notes' && !editorOpen, () => setTab('notes'));

  const changeTab = (next: MobileTab) => {
    if (next === tab) {
      // Tapping the current tab scrolls it back to the top.
      document.querySelector('[data-mobile-tab] .m-scroll')?.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      return;
    }
    setTab(next);
  };

  return (
    <div className="m-root" data-theme={theme}>
      <main
        inert={editorOpen}
        aria-hidden={editorOpen || undefined}
        data-mobile-tab={tab}
        className="absolute inset-0"
      >
        {/* Notes stays mounted so its scroll position and filters survive a trip to the editor. */}
        <div className={cn('absolute inset-0', tab !== 'notes' && 'hidden')}>
          <NotesScreen onOpen={openNote} onRefresh={onRefresh} />
        </div>
        {tab === 'tasks' && <div className="m-anim-fade absolute inset-0"><TasksScreen /></div>}
        {tab === 'settings' && <div className="m-anim-fade absolute inset-0"><SettingsScreen /></div>}
        <BottomNav tab={tab} onChange={changeTab} />
      </main>

      <AnimatePresence>
        {currentNote && (
          <motion.div
            key={currentNote.id}
            className="absolute inset-0 z-30 bg-m-bg shadow-[-8px_0_24px_rgb(0_0_0/0.18)]"
            initial={reduceMotion ? { opacity: 0 } : { x: '100%' }}
            animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { x: '100%' }}
            transition={{ duration: reduceMotion ? 0.12 : 0.28, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <MobileEditor note={currentNote} theme={theme} onBack={() => void closeEditor()} />
          </motion.div>
        )}
      </AnimatePresence>

      <Snackbar raised={!editorOpen} />
    </div>
  );
}
