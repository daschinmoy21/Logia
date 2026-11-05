import { useState, useEffect, useMemo, useRef, type ComponentType } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { isTauri } from '@tauri-apps/api/core';
import {
  CalendarDays,
  ChevronRight,
  FilePlus2,
  FileText,
  FileUp,
  FolderPlus,
  GitBranch,
  Home,
  Layout,
  PanelLeft,
  PanelRight,
  PanelRightDashed,
  Plus,
  Search,
  Settings,
  Star,
} from 'lucide-react';
import useUiStore from '../store/UiStore';
import { useNotesStore } from '../store/notesStore';
import { useSettingsStore } from '../store/settingsStore';
import { commandPaletteResults, cycleIndex } from '../lib/note-utils';
import { notePreview } from '../lib/workspace';
import { prefersReducedMotion } from '../lib/utils';
import type { Note } from '../types/Note';
import {
  createCanvas,
  createFolderIn,
  createTextNote,
  folderPath,
  goHome,
  importMarkdown,
  openNote,
  openPalette,
  openToday,
  relativeTime,
  toggleStar,
} from './workspace/actions';
import { useWorkspaceStore } from './workspace/workspaceStore';
import { hasMod, Kbd, SHORTCUTS, shortcutAria, type Shortcut } from './workspace/shortcuts';
import './CommandPalette.css';

const MAX_NOTE_RESULTS = 50;

interface Command {
  id: string;
  title: string;
  keywords: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  shortcut?: Shortcut;
  /** Runs after the palette closes. */
  run: () => void;
  /** The action moves focus itself, so don't hand it back to where the palette opened. */
  movesFocus?: boolean;
}

type PaletteItem =
  | { kind: 'note'; id: string; note: Note }
  | { kind: 'create'; id: string; title: string }
  | { kind: 'command'; id: string; command: Command };

const noNotes: Note[] = [];

function useCommands(isOpen: boolean): Command[] {
  // A closed palette stays mounted, but shouldn't react to every keystroke.
  const currentNote = useNotesStore((s) => (isOpen ? s.currentNote : null));
  const isAiOpen = useUiStore((s) => s.isAiSidebarOpen);
  const sidebarFloating = useSettingsStore((s) => s.sidebarFloating);
  const native = isTauri();
  const isTextNote = !!currentNote && currentNote.note_type !== 'canvas';

  const commands: Command[] = [
    // Browsers keep Ctrl/Cmd+N and Ctrl/Cmd+Shift+N for themselves, so only advertise them on desktop.
    { id: 'new-note', title: 'New note', keywords: 'create add write page', icon: FilePlus2, shortcut: native ? SHORTCUTS.newNote : undefined, run: () => createTextNote(), movesFocus: true },
    { id: 'new-folder', title: 'New folder', keywords: 'create add directory organize', icon: FolderPlus, shortcut: native ? SHORTCUTS.newFolder : undefined, run: () => void createFolderIn(useWorkspaceStore.getState().treeFolderId ?? undefined), movesFocus: true },
    { id: 'new-canvas', title: 'New canvas', keywords: 'create add draw sketch diagram whiteboard', icon: Layout, run: () => createCanvas(), movesFocus: true },
    { id: 'daily', title: "Open today's daily note", keywords: 'date journal calendar', icon: CalendarDays, shortcut: SHORTCUTS.dailyNote, run: openToday, movesFocus: true },
    { id: 'home', title: 'Go home', keywords: 'notes list start overview', icon: Home, run: goHome, movesFocus: true },
    { id: 'import', title: 'Import Markdown files', keywords: 'md upload obsidian add', icon: FileUp, run: importMarkdown, movesFocus: true },
  ];

  if (isTextNote) {
    commands.push(
      { id: 'context', title: 'Toggle note context panel', keywords: 'outline headings backlinks links tags', icon: PanelRightDashed, shortcut: SHORTCUTS.contextPanel, run: () => useWorkspaceStore.getState().toggleContextPanel() },
    );
  }
  if (currentNote) {
    commands.push({
      id: 'star',
      title: currentNote.starred ? 'Unstar this note' : 'Star this note',
      keywords: 'favorite favourite bookmark pin',
      icon: Star,
      run: () => toggleStar(currentNote),
    });
  }

  commands.push(
    { id: 'ai', title: isAiOpen ? 'Close AI panel' : 'Open AI panel', keywords: 'toggle assistant chat sidebar', icon: PanelRight, shortcut: SHORTCUTS.toggleAi, run: () => useUiStore.getState().setIsAiSidebarOpen(!isAiOpen) },
    { id: 'sidebar', title: sidebarFloating ? 'Pin sidebar' : 'Auto-hide sidebar', keywords: 'toggle files explorer navigation', icon: PanelLeft, shortcut: SHORTCUTS.sidebar, run: () => useSettingsStore.getState().setSidebarFloating(!sidebarFloating) },
    { id: 'settings', title: 'Open settings', keywords: 'preferences options ai keys vim', icon: Settings, run: () => useUiStore.getState().setIsSettingsOpen(true), movesFocus: true },
  );
  if (native) {
    commands.push({ id: 'sync', title: 'Git sync settings', keywords: 'backup remote push pull', icon: GitBranch, run: () => useUiStore.getState().setIsSettingsOpen(true, 'sync'), movesFocus: true });
  }
  return commands;
}

export const CommandPalette = () => {
  const { searchQuery, setSearchQuery, searchResults, isCommandPaletteOpen, closeCommandPalette } = useUiStore();
  const notes = useNotesStore((s) => (isCommandPaletteOpen ? s.notes : noNotes));
  const folders = useNotesStore((s) => s.folders);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(true);
  const reduceMotion = prefersReducedMotion();
  const commands = useCommands(isCommandPaletteOpen);

  const commandMode = searchQuery.startsWith('>');
  const trimmedQuery = searchQuery.trim();

  const matchedNotes = useMemo(
    () => (commandMode ? [] : commandPaletteResults(searchQuery, notes, searchResults)),
    [commandMode, searchQuery, notes, searchResults],
  );

  let items: PaletteItem[];
  if (commandMode) {
    const terms = searchQuery.slice(1).toLowerCase().split(/\s+/).filter(Boolean);
    items = commands
      .filter((c) => {
        const haystack = `${c.title} ${c.keywords}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .map((command) => ({ kind: 'command', id: command.id, command }));
  } else {
    items = matchedNotes.slice(0, MAX_NOTE_RESULTS).map((note) => ({ kind: 'note', id: note.id, note }));
    const isPlainTitle = trimmedQuery && !/(^|\s)(#|is:)/.test(trimmedQuery);
    const lowered = trimmedQuery.toLowerCase();
    if (isPlainTitle && !notes.some((n) => n.title.trim().toLowerCase() === lowered)) {
      items.push({ kind: 'create', id: 'create', title: trimmedQuery });
    }
  }

  const activeIndex = Math.min(selectedIndex, Math.max(items.length - 1, 0));
  const activeOptionId = items.length ? `command-palette-option-${activeIndex}` : undefined;

  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  // Keep the keyboard selection visible while moving through long lists
  useEffect(() => {
    if (!isCommandPaletteOpen) return;
    document
      .querySelector('#command-palette-results [aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isCommandPaletteOpen]);

  useEffect(() => {
    if (!isCommandPaletteOpen) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    restoreFocusRef.current = true;

    // Focus after mount animation frame so autoFocus works with AnimatePresence
    const t = requestAnimationFrame(() => inputRef.current?.focus());

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCommandPalette();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener('keydown', onKeyDown);
      const previous = previousFocusRef.current;
      if (restoreFocusRef.current && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [isCommandPaletteOpen, closeCommandPalette]);

  const runItem = (index: number) => {
    const item = items[index];
    if (!item) return;
    restoreFocusRef.current = item.kind === 'command' && !item.command.movesFocus;
    closeCommandPalette();
    if (item.kind === 'note') openNote(item.note);
    else if (item.kind === 'create') createTextNote(item.title);
    else item.command.run();
  };

  const move = (delta: number) => {
    setSelectedIndex(cycleIndex(activeIndex, delta, items.length));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const key = e.key.toLowerCase();
    const mod = hasMod(e) && !e.shiftKey && !e.altKey;

    // A mode's own shortcut walks the list; the other mode's shortcut switches to it.
    if (mod && key === 'k') {
      e.preventDefault();
      if (commandMode) move(-1);
      else openPalette('commands');
    } else if (mod && key === 'p') {
      e.preventDefault();
      if (commandMode) openPalette('notes');
      else move(-1);
    } else if (e.key === 'ArrowDown' || (e.ctrlKey && (key === 'j' || key === 'n'))) {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!e.nativeEvent.isComposing) runItem(activeIndex);
    } else if (e.key === 'Tab') {
      // The input is the only tab stop: the options are reached with the arrow keys.
      e.preventDefault();
    }
  };

  const emptyMessage = commandMode
    ? 'No commands match.'
    : trimmedQuery
      ? 'No notes match. Try #tag, is:starred, is:canvas or is:text.'
      : 'No notes yet. Type a title to create one, or > for commands.';

  const groupLabel = commandMode ? 'Commands' : trimmedQuery ? 'Notes' : 'Recent';
  const hiddenCount = commandMode ? 0 : matchedNotes.length - Math.min(matchedNotes.length, MAX_NOTE_RESULTS);

  return (
    <AnimatePresence>
      {isCommandPaletteOpen && (
        <motion.div
          className="command-palette-overlay"
          onClick={closeCommandPalette}
          role="presentation"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className="command-palette-container"
            data-command-palette
            onClick={(e) => e.stopPropagation()}
            // Clicking inside must never pull focus out of the input.
            onMouseDown={(e) => {
              if (e.target !== inputRef.current) e.preventDefault();
            }}
            role="dialog"
            aria-modal="true"
            aria-label={commandMode ? 'Run a command' : 'Search notes'}
            initial={reduceMotion ? false : { opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="command-palette-input-row">
              {commandMode ? (
                <ChevronRight size={16} className="command-palette-input-icon" aria-hidden="true" />
              ) : (
                <Search size={16} className="command-palette-input-icon" aria-hidden="true" />
              )}
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                placeholder={commandMode ? 'Run a command…' : 'Search notes, or type > for commands…'}
                value={searchQuery}
                onChange={(e) => {
                  const value = e.target.value;
                  setSearchQuery(value, value.startsWith('>') ? [] : notes);
                }}
                onKeyDown={handleKeyDown}
                autoFocus
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label={commandMode ? 'Search commands' : 'Search notes or type > for commands'}
                aria-autocomplete="list"
                aria-expanded={items.length > 0}
                aria-controls="command-palette-results"
                aria-activedescendant={activeOptionId}
              />
            </div>

            {items.length > 0 && (
              <div className="command-palette-group-label" aria-hidden="true">{groupLabel}</div>
            )}
            <ul id="command-palette-results" className="command-palette-results" role="listbox" aria-label={groupLabel}>
              {items.map((item, index) => {
                const selected = index === activeIndex;
                const common = {
                  id: `command-palette-option-${index}`,
                  role: 'option' as const,
                  'aria-selected': selected,
                  className: selected ? 'selected' : '',
                  onClick: () => runItem(index),
                  onMouseMove: () => {
                    if (index !== activeIndex) setSelectedIndex(index);
                  },
                };

                if (item.kind === 'command') {
                  const { command } = item;
                  const Icon = command.icon;
                  return (
                    <li key={item.id} {...common} aria-keyshortcuts={command.shortcut ? shortcutAria(command.shortcut) : undefined}>
                      <Icon size={15} className="command-palette-icon" />
                      <span className="command-palette-title">{command.title}</span>
                      {command.shortcut && <Kbd keys={command.shortcut} className="command-palette-keys" />}
                    </li>
                  );
                }

                if (item.kind === 'create') {
                  return (
                    <li key={item.id} {...common}>
                      <Plus size={15} className="command-palette-icon" />
                      <span className="command-palette-title">Create note “{item.title}”</span>
                    </li>
                  );
                }

                const { note } = item;
                const isCanvas = note.note_type === 'canvas';
                const preview = isCanvas ? 'Canvas' : notePreview(note, 90);
                const path = folderPath(note.folder_id, folders, ' / ');
                return (
                  <li key={item.id} {...common}>
                    {isCanvas ? (
                      <Layout size={15} className="command-palette-icon command-palette-icon--canvas" />
                    ) : (
                      <FileText size={15} className="command-palette-icon" />
                    )}
                    <span className="command-palette-note">
                      <span className="command-palette-title">{note.title || 'Untitled'}</span>
                      {preview && <span className="command-palette-preview">{preview}</span>}
                    </span>
                    <span className="command-palette-meta">
                      {path && <span className="command-palette-path">{path}</span>}
                      <span>{relativeTime(note.updated_at)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>

            {items.length === 0 && <div className="command-palette-empty">{emptyMessage}</div>}
            {hiddenCount > 0 && (
              <div className="command-palette-more">{hiddenCount} more. Keep typing to narrow the list.</div>
            )}
            <div className="sr-only" role="status">
              {items.length === 0 ? emptyMessage : `${items.length} ${items.length === 1 ? 'result' : 'results'}`}
            </div>

            <div className="command-palette-footer">
              <div className="command-palette-modes">
                <button type="button" tabIndex={-1} aria-pressed={!commandMode} onClick={() => openPalette('notes')}>
                  Notes <Kbd keys={SHORTCUTS.quickSwitch} />
                </button>
                <button type="button" tabIndex={-1} aria-pressed={commandMode} onClick={() => openPalette('commands')}>
                  Commands <Kbd keys={SHORTCUTS.commands} />
                </button>
              </div>
              <div className="command-palette-hints" aria-hidden="true">
                <span><kbd>↑↓</kbd> move</span>
                <span><kbd>↵</kbd> {commandMode ? 'run' : 'open'}</span>
                <span><kbd>esc</kbd> close</span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
