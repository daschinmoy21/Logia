import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Fuse from 'fuse.js';
import { useSettingsStore } from '../../store/settingsStore';
import { useVimStore, type VimReturnTo } from '../../store/vimStore';
import useUiStore from '../../store/UiStore';
import { useNotesStore } from '../../store/notesStore';
import { vimBridge } from '../../lib/vim/bridge';
import { LEADER_BINDINGS, type LeaderAction } from '../../lib/vim/keymap';
import { flattenVisibleTree, type TreeItem } from '../../lib/note-utils';
import { PROVIDERS, getProvider } from '../../lib/ai/providers';
import { prefersReducedMotion } from '../../lib/utils';

/* ------------------------------------------------------------- helpers -- */

const isEditableTarget = (el: EventTarget | null): el is HTMLElement => {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
};

const dialogOpen = () => !!document.querySelector('[role="dialog"]');

/** Wait until the editor for a (new) note is mounted, then run `fn`. */
function whenEditorReady(previous: unknown, fn: () => void, timeoutMs = 1500) {
  const started = performance.now();
  const tick = () => {
    const editor = useUiStore.getState().editor;
    if (editor && editor !== previous && editor.domElement?.isConnected) {
      fn();
      return;
    }
    if (performance.now() - started < timeoutMs) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function focusEditor(mode: 'normal' | 'insert' = 'normal') {
  const editor = useUiStore.getState().editor;
  const vim = useVimStore.getState();
  if (editor?.domElement?.isConnected) {
    vim.setMode(mode);
    editor.focus();
    if (mode === 'normal') vimBridge.engine?.enterNormal();
  } else {
    vim.setMode('normal');
  }
}

async function createAndOpen(type: 'text' | 'canvas', folderId?: string) {
  const previous = useUiStore.getState().editor;
  useVimStore.getState().setMode('normal');
  await useNotesStore.getState().createNote(type, folderId);
  if (type !== 'text') return;
  whenEditorReady(previous, () => {
    // New notes start with an "Untitled" heading: clear it so typing names the note.
    const editor = useUiStore.getState().editor;
    const first = editor?.document?.[0];
    const firstText = Array.isArray(first?.content)
      ? first.content.map((c: { text?: string }) => c.text ?? '').join('')
      : '';
    if (editor && first && firstText === 'Untitled') {
      editor.updateBlock(first, { content: [] });
      editor.setTextCursorPosition(first, 'start');
    }
    focusEditor('insert');
  });
}

function treeItems(): TreeItem[] {
  const { folders, notes } = useNotesStore.getState();
  return flattenVisibleTree(folders, notes, useUiStore.getState().expandedFolders);
}

function enterExplorer() {
  const ui = useUiStore.getState();
  const { folders, currentNote } = useNotesStore.getState();
  const vim = useVimStore.getState();

  // Reveal the current note by expanding its ancestor folders.
  if (currentNote?.folder_id) {
    const expanded = new Set(ui.expandedFolders);
    let id: string | undefined = currentNote.folder_id;
    while (id) {
      expanded.add(id);
      id = folders.find((f) => f.id === id)?.parent_id;
    }
    ui.setExpandedFolders(expanded);
  }

  (document.activeElement as HTMLElement | null)?.blur?.();
  const items = treeItems();
  const cursor =
    items.find((i) => i.id === vim.explorerCursor)?.id ??
    items.find((i) => i.id === currentNote?.id)?.id ??
    items[0]?.id ??
    null;
  vim.setExplorerCursor(cursor);
  vim.setMode('explorer');
}

function leaveExplorer() {
  if (useNotesStore.getState().currentNote) focusEditor('normal');
  else useVimStore.getState().setMode('normal');
}

function runLeader(action: LeaderAction) {
  const ui = useUiStore.getState();
  const notes = useNotesStore.getState();
  const settings = useSettingsStore.getState();
  switch (action) {
    case 'explorer':
      enterExplorer();
      break;
    case 'find':
      useVimStore.getState().setMode('normal');
      ui.openCommandPalette();
      break;
    case 'ai':
      ui.setIsAiSidebarOpen(true);
      setTimeout(() => {
        const input = document.querySelector<HTMLTextAreaElement>('[data-vim-escape-to-editor] textarea');
        input?.focus();
      }, 250);
      break;
    case 'newNote':
      void createAndOpen('text');
      break;
    case 'newCanvas':
      void createAndOpen('canvas');
      break;
    case 'toggleSidebar':
      settings.setSidebarFloating(!settings.sidebarFloating);
      break;
    case 'home':
      notes.selectNote(null);
      useVimStore.getState().setMode('normal');
      break;
    case 'settings':
      ui.setIsSettingsOpen(true);
      break;
    case 'todo':
      ui.setIsKanbanOpen(true);
      break;
  }
}

/* --------------------------------------------------------- ex commands -- */

const exHistory: string[] = [];

async function runEx(input: string): Promise<void> {
  const vim = useVimStore.getState();
  const ui = useUiStore.getState();
  const notesState = useNotesStore.getState();
  const settings = useSettingsStore.getState();
  const line = input.trim();
  if (!line) return;
  const [cmd, ...restParts] = line.split(/\s+/);
  const rest = restParts.join(' ');

  if (/^\d+$/.test(cmd)) {
    vimBridge.engine?.gotoLine(parseInt(cmd, 10));
    return;
  }

  switch (cmd) {
    case 'w':
    case 'write':
      await notesState.saveCurrentNote();
      vim.flash(notesState.currentNote ? `"${notesState.currentNote.title || 'Untitled'}" written` : 'No note open');
      return;
    case 'q':
    case 'q!':
    case 'quit':
    case 'bd':
      notesState.selectNote(null);
      vim.setMode('normal');
      return;
    case 'wq':
    case 'x':
      await notesState.saveCurrentNote();
      notesState.selectNote(null);
      vim.setMode('normal');
      return;
    case 'e':
    case 'edit':
    case 'o':
    case 'open': {
      if (!rest) {
        ui.openCommandPalette();
        return;
      }
      const fuse = new Fuse(notesState.notes, { keys: ['title'], threshold: 0.4 });
      const hit = fuse.search(rest)[0]?.item;
      if (!hit) {
        vim.flash(`E32: No note matching "${rest}"`, true);
        return;
      }
      const previous = ui.editor;
      notesState.selectNote(hit);
      whenEditorReady(previous, () => focusEditor('normal'));
      return;
    }
    case 'new':
    case 'enew':
    case 'vnew':
      await createAndOpen('text');
      return;
    case 'canvas':
      await createAndOpen('canvas');
      return;
    case 'ai':
      ui.setIsAiSidebarOpen(true);
      if (rest) ui.setPendingAiPrompt(rest);
      else runLeader('ai');
      return;
    case 'provider': {
      if (!rest) {
        vim.flash(`provider=${settings.activeProvider} (${PROVIDERS.map((p) => p.id).join(', ')})`);
        return;
      }
      const provider = getProvider(rest.toLowerCase());
      if (!provider) {
        vim.flash(`Unknown provider "${rest}". Try: ${PROVIDERS.map((p) => p.id).join(', ')}`, true);
        return;
      }
      settings.setActiveProvider(provider.id);
      vim.flash(`AI provider: ${provider.label}`);
      return;
    }
    case 'set':
    case 'se': {
      const opt = rest.replace(/!$/, '');
      if (opt === 'novim') settings.setVimEnabled(false);
      else if (opt === 'vim') settings.setVimEnabled(true);
      else if (opt === 'invvim') settings.setVimEnabled(!settings.vimEnabled);
      else vim.flash(`E518: Unknown option: ${rest}`, true);
      return;
    }
    case 'sidebar':
    case 'float':
    case 'pin':
      settings.setSidebarFloating(cmd === 'float' ? true : cmd === 'pin' ? false : !settings.sidebarFloating);
      return;
    case 'settings':
    case 'options':
      ui.setIsSettingsOpen(true);
      return;
    case 'help':
    case 'h':
      ui.setIsSettingsOpen(true, 'editor');
      return;
    case 'todo':
      ui.setIsKanbanOpen(true);
      return;
    case 'home':
      notesState.selectNote(null);
      return;
    default:
      vim.flash(`E492: Not an editor command: ${line}`, true);
  }
}

/* --------------------------------------------------------- component -- */

export function VimController() {
  const vimEnabled = useSettingsStore((s) => s.vimEnabled);
  const leaderOpen = useVimStore((s) => s.leaderOpen);
  const commandLine = useVimStore((s) => s.commandLine);
  const message = useVimStore((s) => s.message);
  const pendingG = useRef(false);

  // Turning vim off resets any modal state.
  useEffect(() => {
    if (!vimEnabled) {
      const vim = useVimStore.getState();
      vim.setMode('normal');
      vim.setLeaderOpen(false);
      vim.closeCommandLine();
      vim.setPending('');
    }
  }, [vimEnabled]);

  useEffect(() => {
    if (!vimEnabled) return;

    const returnTarget = (): VimReturnTo => {
      const mode = useVimStore.getState().mode;
      if (mode === 'explorer') return 'explorer';
      const editor = useUiStore.getState().editor;
      return editor?.domElement && document.activeElement === editor.domElement ? 'editor' : 'none';
    };

    vimBridge.leader = () => useVimStore.getState().setLeaderOpen(true);
    vimBridge.commandLine = (prefix) => useVimStore.getState().openCommandLine(prefix, returnTarget());
    vimBridge.focusExplorer = () => enterExplorer();

    const handleExplorerKey = (e: KeyboardEvent) => {
      const vim = useVimStore.getState();
      const ui = useUiStore.getState();
      const notes = useNotesStore.getState();
      const items = treeItems();
      const index = Math.max(0, items.findIndex((i) => i.id === vim.explorerCursor));
      const item = items[index];
      const move = (to: number) => {
        const target = items[Math.max(0, Math.min(items.length - 1, to))];
        if (target) vim.setExplorerCursor(target.id);
      };
      const key = e.key;

      if (pendingG.current) {
        pendingG.current = false;
        if (key === 'g') move(0);
        return;
      }

      switch (key) {
        case 'j':
        case 'ArrowDown':
          move(index + 1);
          return;
        case 'k':
        case 'ArrowUp':
          move(index - 1);
          return;
        case 'g':
          pendingG.current = true;
          return;
        case 'G':
          move(items.length - 1);
          return;
        case 'd':
          if (e.ctrlKey) return move(index + 10);
          if (item?.kind === 'note') ui.setDeleteConfirmId(item.id);
          else if (item?.kind === 'folder') ui.setDeleteConfirmFolderId(item.id);
          return;
        case 'u':
          if (e.ctrlKey) move(index - 10);
          return;
        case 'l':
        case 'o':
        case 'Enter':
        case 'ArrowRight': {
          if (!item) return;
          if (item.kind === 'folder') {
            if (!ui.expandedFolders.has(item.id)) {
              ui.setExpandedFolders(new Set([...ui.expandedFolders, item.id]));
            } else if (key === 'l' || key === 'ArrowRight') {
              move(index + 1);
            } else {
              const next = new Set(ui.expandedFolders);
              next.delete(item.id);
              ui.setExpandedFolders(next);
            }
            return;
          }
          const previous = ui.editor;
          notes.selectNote(item.note);
          if (item.note.note_type === 'canvas') vim.setMode('normal');
          else whenEditorReady(previous, () => focusEditor('normal'), 800);
          // Same note already open: no remount happens, focus directly.
          if (notes.currentNote?.id === item.id) focusEditor('normal');
          return;
        }
        case 'h':
        case 'ArrowLeft': {
          if (!item) return;
          if (item.kind === 'folder' && ui.expandedFolders.has(item.id)) {
            const next = new Set(ui.expandedFolders);
            next.delete(item.id);
            ui.setExpandedFolders(next);
          } else if (item.parentId) {
            vim.setExplorerCursor(item.parentId);
          }
          return;
        }
        case 'a':
        case 'A': {
          const folderId = item?.kind === 'folder' ? item.id : item?.parentId ?? undefined;
          if (key === 'a') void createAndOpen('text', folderId);
          else
            void notes.createFolder('New Folder', folderId).then((folder) => {
              if (folderId) ui.setExpandedFolders(new Set([...useUiStore.getState().expandedFolders, folderId]));
              vim.setExplorerCursor(folder.id);
              ui.setFolderRenameRequest({ id: folder.id, name: folder.name });
            });
          return;
        }
        case 'r':
          if (item?.kind === 'note') ui.startRenaming(item.id, item.note.title || 'Untitled');
          else if (item?.kind === 'folder') ui.setFolderRenameRequest({ id: item.id, name: item.folder.name });
          return;
        case 's':
          if (item?.kind === 'note') void notes.toggleStar(item.id);
          return;
        case '/':
          vim.setMode('normal');
          ui.openCommandPalette();
          return;
        case ':':
          vim.openCommandLine(':', 'explorer');
          return;
        case ' ':
          vim.setLeaderOpen(true);
          return;
        case 'Escape':
        case 'q':
        case 'i':
          leaveExplorer();
          return;
        default:
          if (e.ctrlKey && key === 'l') leaveExplorer();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.metaKey) return;
      const vim = useVimStore.getState();

      // Second key of a leader sequence, wherever focus is.
      if (vim.leaderOpen) {
        e.preventDefault();
        e.stopPropagation();
        vim.setLeaderOpen(false);
        const binding = LEADER_BINDINGS.find((b) => b.key === e.key);
        if (binding) runLeader(binding.action);
        return;
      }

      if (vim.commandLine) return; // the command-line input handles its own keys
      const target = e.target;

      if (vim.mode === 'explorer') {
        if (isEditableTarget(target) || dialogOpen()) return; // renaming, confirm dialogs
        if (e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        handleExplorerKey(e);
        return;
      }

      const editorDom = useUiStore.getState().editor?.domElement as HTMLElement | undefined;
      if (editorDom && target instanceof Node && editorDom.contains(target)) return; // editor engine

      if (isEditableTarget(target)) {
        if ((e.key === 'Escape' || (e.ctrlKey && e.key === '[')) && target.closest('[data-vim-escape-to-editor]')) {
          e.preventDefault();
          target.blur();
          focusEditor('normal');
        }
        return;
      }
      if (dialogOpen() || e.altKey) return;
      // The tldraw canvas has its own keyboard shortcuts (Space pans, etc.).
      if (target instanceof Element && target.closest('.tl-container')) return;

      if (e.ctrlKey) {
        if (e.key === 'h') {
          e.preventDefault();
          enterExplorer();
        } else if (e.key === 'l') {
          e.preventDefault();
          focusEditor('normal');
        }
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          vim.setLeaderOpen(true);
          return;
        case ':':
          e.preventDefault();
          vim.openCommandLine(':', 'none');
          return;
        case 'i':
          if (useUiStore.getState().editor) {
            e.preventDefault();
            focusEditor('insert');
          }
          return;
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      vimBridge.leader = () => {};
      vimBridge.commandLine = () => {};
      vimBridge.focusExplorer = () => {};
    };
  }, [vimEnabled]);

  if (!vimEnabled) return null;

  return (
    <>
      <WhichKey open={leaderOpen} />
      <AnimatePresence>{commandLine && <CommandLine key="cmdline" />}</AnimatePresence>
      <AnimatePresence>
        {message && !commandLine && (
          <motion.div
            key={message.text}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={`fixed bottom-3 left-1/2 -translate-x-1/2 z-[2000] rounded-md border px-3 py-1.5 font-mono text-xs shadow-xl backdrop-blur-xl ${
              message.error
                ? 'border-red-500/30 bg-red-950/80 text-red-300'
                : 'border-zinc-700/60 bg-zinc-900/85 text-zinc-300'
            }`}
            role="status"
          >
            {message.text}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function WhichKey({ open }: { open: boolean }) {
  const reduceMotion = prefersReducedMotion();
  const rows = LEADER_BINDINGS.filter((b) => b.key !== ' ');
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: 8 }}
          transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[2000] w-[min(560px,calc(100vw-2rem))] rounded-xl border border-zinc-700/60 bg-zinc-900/90 p-3 shadow-2xl backdrop-blur-xl"
          role="menu"
          aria-label="Leader key bindings"
        >
          <p className="mb-2 px-1 font-mono text-[11px] text-zinc-500">
            <span className="text-blue-300">SPC</span> — press a key · Esc to cancel
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            {rows.map((b) => (
              <div key={b.key} className="flex items-center gap-2 px-1 py-0.5 text-xs">
                <kbd className="min-w-5 rounded border border-zinc-700 bg-zinc-800 px-1.5 text-center font-mono text-[11px] text-blue-300">
                  {b.key}
                </kbd>
                <span className="text-zinc-300 truncate">{b.label}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CommandLine() {
  const commandLine = useVimStore((s) => s.commandLine);
  const [value, setValue] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  if (!commandLine) return null;
  const { prefix, returnTo } = commandLine;

  const close = () => {
    useVimStore.getState().closeCommandLine();
    if (returnTo === 'editor') focusEditor('normal');
    else if (returnTo === 'explorer') useVimStore.getState().setMode('explorer');
  };

  const submit = () => {
    const input = value;
    useVimStore.getState().closeCommandLine();
    if (prefix === ':') {
      if (input.trim()) exHistory.unshift(input.trim());
      const stayInEditor = returnTo === 'editor';
      void runEx(input).then(() => {
        // Commands that open things manage focus themselves.
        const vim = useVimStore.getState();
        if (stayInEditor && vim.mode !== 'insert' && document.activeElement === document.body) {
          focusEditor('normal');
        } else if (returnTo === 'explorer' && vim.mode === 'explorer') {
          /* stay in explorer */
        }
      });
    } else {
      focusEditor('normal');
      if (input) vimBridge.engine?.search(input, prefix === '?');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.12 }}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[2001] w-[min(560px,calc(100vw-2rem))] flex items-center gap-1 rounded-lg border border-zinc-700/70 bg-zinc-900/95 px-3 py-2 font-mono text-sm shadow-2xl backdrop-blur-xl"
    >
      <span className="text-blue-300">{prefix}</span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setHistoryIndex(-1);
        }}
        onBlur={() => useVimStore.getState().closeCommandLine()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape' || (e.ctrlKey && e.key === '[') || (e.key === 'Backspace' && !value)) {
            e.preventDefault();
            close();
          } else if (prefix === ':' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            const next = Math.max(-1, Math.min(exHistory.length - 1, historyIndex + (e.key === 'ArrowUp' ? 1 : -1)));
            setHistoryIndex(next);
            setValue(next === -1 ? '' : exHistory[next]);
          }
        }}
        className="flex-1 bg-transparent text-zinc-100 outline-none placeholder-zinc-600"
        placeholder={prefix === ':' ? 'w, q, e <note>, new, ai <prompt>, provider <id>, set novim, help…' : 'search this note'}
        aria-label={prefix === ':' ? 'Vim command line' : 'Search in note'}
        spellCheck={false}
        autoComplete="off"
      />
    </motion.div>
  );
}
