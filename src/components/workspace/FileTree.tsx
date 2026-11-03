import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { ChevronRight, FileText, Folder, FolderOpen, MoreHorizontal, PenTool, Plus } from 'lucide-react';
import { flattenVisibleTree, type TreeItem } from '../../lib/note-utils';
import { useNotesStore } from '../../store/notesStore';
import useUiStore from '../../store/UiStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useVimStore } from '../../store/vimStore';
import { createIn, moveFolder, moveNote, openNote, selectNoteQuietly } from './actions';
import { findNote, useNoteMeta, type NoteMeta } from './noteMeta';
import { useWorkspaceStore } from './workspaceStore';
import { pointerToCss } from '../ui/menu';

const ROW_HEIGHT = 28;
const OVERSCAN = 10;
const INDENT = 14;
const PADDING = 6;
const DRAG_THRESHOLD = 5;
const EXPAND_ON_HOVER_MS = 600;
const SCROLL_EDGE = 28;

type Row = TreeItem<NoteMeta>;
/** A folder id, or null for the workspace root. */
type DropTarget = string | null;

const rowLabel = (row: Row) => (row.kind === 'folder' ? row.folder.name : row.note.title || 'Untitled');

function RenameInput({ initial, onCommit, onCancel }: { initial: string; onCommit: (value: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit && value.trim() && value.trim() !== initial) onCommit(value.trim());
    else onCancel();
  };

  return (
    <input
      ref={ref}
      type="text"
      value={value}
      aria-label="New name"
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="min-w-0 flex-1 rounded-[3px] bg-zinc-950 px-1 text-[13px] text-zinc-50 outline outline-1 outline-blue-500"
    />
  );
}

interface TreeRowProps {
  row: Row;
  index: number;
  expanded: boolean;
  selected: boolean;
  tabStop: boolean;
  vimCursor: boolean;
  dropTarget: boolean;
  dragging: boolean;
  renaming: boolean;
  onCommitRename: (row: Row, value: string) => void;
  onCancelRename: (row: Row) => void;
}

/** Rows read everything from props and hand events to the tree, so scrolling and typing skip them. */
const TreeRow = memo(function TreeRow({ row, index, expanded, selected, tabStop, vimCursor, dropTarget, dragging, renaming, onCommitRename, onCancelRename }: TreeRowProps) {
  const folder = row.kind === 'folder';
  const label = rowLabel(row);
  const canvas = row.kind === 'note' && row.note.note_type === 'canvas';
  const FolderIcon = expanded ? FolderOpen : Folder;

  return (
    <div
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      aria-expanded={folder ? expanded : undefined}
      aria-label={label}
      data-tree-id={row.id}
      data-tree-parent={row.parentId ?? undefined}
      data-tree-folder={folder || undefined}
      tabIndex={tabStop ? 0 : -1}
      style={{ transform: `translateY(${index * ROW_HEIGHT}px)`, paddingLeft: PADDING + row.depth * INDENT }}
      className={`tree-row group absolute inset-x-1 flex cursor-default select-none items-center gap-1 rounded-[5px] pr-1 text-[13px] leading-none outline-none ${
        dropTarget
          ? 'bg-blue-500/15 text-zinc-50 shadow-[inset_0_0_0_1px_var(--color-blue-500)]'
          : selected
            ? `bg-blue-500/[0.16] text-zinc-50 ${vimCursor ? '' : 'shadow-[inset_2px_0_0_var(--color-blue-500)]'}`
            : 'text-zinc-300 hover:bg-white/[0.07] active:bg-white/[0.08]'
      } ${dragging ? 'opacity-40' : ''} ${vimCursor ? 'shadow-[inset_0_0_0_1px_var(--color-blue-400)]' : ''}`}
    >
      {row.depth > 0 && <span className="tree-guides" aria-hidden="true" style={{ left: PADDING + 7, width: row.depth * INDENT }} />}
      <span className="flex size-4 flex-shrink-0 items-center justify-center text-zinc-500" aria-hidden="true">
        {folder && <ChevronRight size={13} className={expanded ? 'rotate-90' : ''} />}
      </span>
      <span className={`flex size-4 flex-shrink-0 items-center justify-center ${selected ? 'text-zinc-200' : 'text-zinc-500'}`} aria-hidden="true">
        {folder ? <FolderIcon size={14} /> : canvas ? <PenTool size={13} /> : <FileText size={14} />}
      </span>
      {renaming ? (
        <RenameInput initial={label} onCommit={(value) => onCommitRename(row, value)} onCancel={() => onCancelRename(row)} />
      ) : (
        <span className="min-w-0 flex-1 truncate pl-0.5 leading-[1.3]">{label}</span>
      )}
      {!renaming && (
        <span className="tree-row-actions ml-auto hidden flex-shrink-0 items-center group-hover:flex group-focus-within:flex">
          {folder && (
            <button type="button" tabIndex={-1} data-tree-action="add" aria-label={`New note in ${label}`} className="flex size-5 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-zinc-100">
              <Plus size={13} />
            </button>
          )}
          <button type="button" tabIndex={-1} data-tree-action="menu" aria-label={`More actions for ${label}`} className="flex size-5 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-zinc-100">
            <MoreHorizontal size={13} />
          </button>
        </span>
      )}
    </div>
  );
});

export function FileTree() {
  const notes = useNoteMeta();
  const folders = useNotesStore((s) => s.folders);
  const currentNoteId = useNotesStore((s) => s.currentNote?.id ?? null);
  const expanded = useUiStore((s) => s.expandedFolders);
  const renamingNoteId = useUiStore((s) => s.renamingNoteId);
  const renamingFolderId = useUiStore((s) => s.folderRenameRequest?.id ?? null);
  const vimCursorId = useVimStore((s) => (s.mode === 'explorer' ? s.explorerCursor : null));

  const rows = useMemo(() => flattenVisibleTree(folders, notes, expanded), [folders, notes, expanded]);
  const indexById = useMemo(() => new Map(rows.map((row, index) => [row.id, index])), [rows]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(800);
  // The keyboard position. It moves without opening anything, like an IDE's explorer.
  const [cursorId, setCursorId] = useState<string | null>(null);
  // Highlighted at once while the (slower) editor mount for this note catches up.
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);
  const [revealId, setRevealId] = useState<string | null>(null);
  const focusAfterRender = useRef<string | null>(null);

  const [drag, setDrag] = useState<{ id: string; label: string; target: DropTarget | undefined } | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const dragCleanup = useRef<(() => void) | null>(null);

  const selectedId = pendingOpenId ?? currentNoteId;
  const tabStopId = cursorId && indexById.has(cursorId) ? cursorId : selectedId && indexById.has(selectedId) ? selectedId : rows[0]?.id;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewport(el.clientHeight));
    observer.observe(el);
    setViewport(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => dragCleanup.current?.(), []);

  const scrollToIndex = (index: number) => {
    const el = scrollRef.current;
    if (!el || index < 0) return;
    const top = index * ROW_HEIGHT;
    let next = el.scrollTop;
    if (top < next) next = top;
    else if (top + ROW_HEIGHT > next + el.clientHeight) next = top + ROW_HEIGHT - el.clientHeight;
    if (next !== el.scrollTop) {
      el.scrollTop = next;
      setScrollTop(next);
    }
  };

  const moveCursor = (id: string, focus = true) => {
    setCursorId(id);
    scrollToIndex(indexById.get(id) ?? -1);
    if (focus) focusAfterRender.current = id;
  };

  useLayoutEffect(() => {
    const id = focusAfterRender.current;
    if (!id) return;
    focusAfterRender.current = null;
    scrollRef.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  });

  // Reveal the open note wherever it was opened from, as an IDE's explorer does.
  useEffect(() => {
    setPendingOpenId(null);
    if (!currentNoteId) return;
    const { folders: allFolders, notes: allNotes } = useNotesStore.getState();
    const ui = useUiStore.getState();
    const open = new Set(ui.expandedFolders);
    const seen = new Set<string>();
    let parent = allNotes.find((note) => note.id === currentNoteId)?.folder_id;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      open.add(parent);
      parent = allFolders.find((folder) => folder.id === parent)?.parent_id;
    }
    if (open.size !== ui.expandedFolders.size) ui.setExpandedFolders(open);
    setRevealId(currentNoteId);
  }, [currentNoteId]);

  // New rows are renamed in place, so bring them into view first.
  useEffect(() => {
    const id = renamingFolderId ?? renamingNoteId;
    if (id) setRevealId(id);
  }, [renamingFolderId, renamingNoteId]);

  // Waits for the expansion above to reach the row list.
  useEffect(() => {
    if (!revealId || !indexById.has(revealId)) return;
    setCursorId(revealId);
    scrollToIndex(indexById.get(revealId)!);
    setRevealId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealId, indexById]);

  // The vim explorer owns its cursor; keep it visible and keep focus with it.
  useEffect(() => {
    if (!vimCursorId) return;
    const inside = scrollRef.current?.contains(document.activeElement) && document.activeElement?.matches('[data-tree-id]');
    moveCursor(vimCursorId, !!inside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vimCursorId]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);
  const windowed: Array<[Row, number]> = [];
  for (let index = start; index < end; index++) windowed.push([rows[index], index]);
  // The focused row stays mounted when scrolled away, or the keyboard would lose its place.
  const cursorIndex = tabStopId ? indexById.get(tabStopId) ?? -1 : -1;
  if (cursorIndex >= 0 && (cursorIndex < start || cursorIndex >= end)) windowed.push([rows[cursorIndex], cursorIndex]);

  const rowFromEvent = (target: EventTarget | null): Row | null => {
    const el = target instanceof Element ? target.closest<HTMLElement>('[data-tree-id]') : null;
    const index = el ? indexById.get(el.dataset.treeId!) : undefined;
    return index === undefined ? null : rows[index];
  };

  const setExpanded = (id: string, open: boolean) => {
    const next = new Set(useUiStore.getState().expandedFolders);
    if (open) next.add(id);
    else next.delete(id);
    useUiStore.getState().setExpandedFolders(next);
  };

  const trackFolderContext = (row: Row | null) => {
    useWorkspaceStore.getState().setTreeFolderId(row ? (row.kind === 'folder' ? row.id : row.parentId) : null);
  };

  const openRow = (row: Row, moveFocus: boolean) => {
    if (row.kind !== 'note') return;
    const full = findNote(row.id);
    if (!full) return;
    if (moveFocus) void openNote(full);
    else if (row.id !== currentNoteId) {
      // Paint the highlight first: mounting an editor can take a few frames.
      flushSync(() => setPendingOpenId(row.id));
      requestAnimationFrame(() => setTimeout(() => {
        void selectNoteQuietly(full).then((ok) => { if (!ok) setPendingOpenId(null); });
      }));
    }
  };

  const openContextMenu = (event: MouseEvent, row: Row | null) => {
    event.preventDefault();
    event.stopPropagation();
    const ui = useUiStore.getState();
    if (row?.kind === 'folder') ui.setContextMenu({ x: event.clientX, y: event.clientY, folder: row.folder });
    else if (row?.kind === 'note') {
      const note = findNote(row.id);
      if (note) ui.setContextMenu({ x: event.clientX, y: event.clientY, note });
    } else ui.setContextMenu({ x: event.clientX, y: event.clientY });
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const row = rowFromEvent(event.target);
    trackFolderContext(row);
    if (!row) return;
    const action = (event.target as Element).closest<HTMLElement>('[data-tree-action]')?.dataset.treeAction;
    if (action === 'menu') return openContextMenu(event, row);
    if (action === 'add' && row.kind === 'folder') {
      event.stopPropagation();
      void createIn('text', row.id);
      return;
    }
    setCursorId(row.id);
    if (row.kind === 'folder') setExpanded(row.id, !expanded.has(row.id));
    else openRow(row, false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
    if ((event.target as Element).closest('input, textarea, button')) return;
    const row = rowFromEvent(event.target);
    if (!row) return;
    const index = indexById.get(row.id)!;
    const goTo = (to: number) => {
      const next = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (next) {
        moveCursor(next.id);
        trackFolderContext(next);
      }
    };
    const ui = useUiStore.getState();
    switch (event.key) {
      case 'ArrowDown':
      case 'j':
        goTo(index + 1);
        break;
      case 'ArrowUp':
      case 'k':
        goTo(index - 1);
        break;
      case 'Home':
        goTo(0);
        break;
      case 'End':
        goTo(rows.length - 1);
        break;
      case 'PageDown':
        goTo(index + Math.max(1, Math.floor(viewport / ROW_HEIGHT) - 1));
        break;
      case 'PageUp':
        goTo(index - Math.max(1, Math.floor(viewport / ROW_HEIGHT) - 1));
        break;
      case 'ArrowRight':
      case 'l':
        if (row.kind === 'folder' && !expanded.has(row.id)) setExpanded(row.id, true);
        else goTo(index + 1);
        break;
      case 'ArrowLeft':
      case 'h':
        if (row.kind === 'folder' && expanded.has(row.id)) setExpanded(row.id, false);
        else if (row.parentId) goTo(indexById.get(row.parentId) ?? index);
        break;
      case 'Enter':
        if (row.kind === 'folder') setExpanded(row.id, !expanded.has(row.id));
        else openRow(row, true);
        break;
      case ' ':
        if (row.kind === 'folder') setExpanded(row.id, !expanded.has(row.id));
        else openRow(row, false);
        break;
      case 'F2':
        if (row.kind === 'folder') ui.setFolderRenameRequest({ id: row.id, name: row.folder.name });
        else ui.startRenaming(row.id, row.note.title || 'Untitled');
        break;
      case 'Delete':
        if (row.kind === 'folder') ui.setDeleteConfirmFolderId(row.id);
        else ui.setDeleteConfirmId(row.id);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const onFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    const el = (event.target as Element).closest<HTMLElement>('[data-tree-id]');
    if (!el) return;
    setCursorId(el.dataset.treeId!);
    if (useSettingsStore.getState().vimEnabled && useVimStore.getState().mode === 'explorer') useVimStore.getState().setExplorerCursor(el.dataset.treeId!);
  };

  const dropTargetAt = (x: number, y: number, source: Row): DropTarget | undefined => {
    const el = document.elementFromPoint(x, y);
    const scroll = scrollRef.current;
    if (!el || !scroll?.contains(el)) return undefined;
    const over = rowFromEvent(el);
    const target = !over ? null : over.kind === 'folder' ? over.id : over.parentId;
    if (source.kind === 'note') return target === (source.note.folder_id ?? null) ? undefined : target;
    if (target === (source.folder.parent_id ?? null)) return undefined;
    // A folder can't move into itself or anything inside it.
    const { folders: allFolders } = useNotesStore.getState();
    const seen = new Set<string>();
    for (let id = target; id; id = allFolders.find((f) => f.id === id)?.parent_id ?? null) {
      if (id === source.id) return undefined;
      if (seen.has(id)) break;
      seen.add(id);
    }
    return target;
  };

  // Pointer events rather than HTML5 drag: Tauri's window drop handling swallows the latter.
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.pointerType !== 'mouse') return;
    if ((event.target as Element).closest('input, button')) return;
    const source = rowFromEvent(event.target);
    if (!source) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let lastTarget: DropTarget | undefined;
    let pointer = { x: startX, y: startY };
    let expandTimer: ReturnType<typeof setTimeout> | null = null;
    let frame = 0;

    const autoScroll = () => {
      const scroll = scrollRef.current;
      if (scroll && active) {
        const box = scroll.getBoundingClientRect();
        if (pointer.y < box.top + SCROLL_EDGE) scroll.scrollTop -= 6;
        else if (pointer.y > box.bottom - SCROLL_EDGE) scroll.scrollTop += 6;
      }
      frame = requestAnimationFrame(autoScroll);
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', cancel);
      cancelAnimationFrame(frame);
      if (expandTimer) clearTimeout(expandTimer);
      document.body.classList.remove('tree-dragging');
      dragCleanup.current = null;
    };
    const cancel = () => {
      cleanup();
      setDrag(null);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      suppressClick.current = false;
      cancel();
    };
    const onMove = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
      if (!active) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
        active = true;
        suppressClick.current = true;
        document.body.classList.add('tree-dragging');
        setDrag({ id: source.id, label: rowLabel(source), target: undefined });
        frame = requestAnimationFrame(autoScroll);
      }
      if (ghostRef.current) ghostRef.current.style.transform = `translate(${pointerToCss(e.clientX) + 12}px, ${pointerToCss(e.clientY) + 8}px)`;
      const target = dropTargetAt(e.clientX, e.clientY, source);
      if (target === lastTarget) return;
      lastTarget = target;
      setDrag((current) => (current ? { ...current, target } : current));
      if (expandTimer) clearTimeout(expandTimer);
      expandTimer = null;
      if (target && !useUiStore.getState().expandedFolders.has(target)) {
        expandTimer = setTimeout(() => setExpanded(target, true), EXPAND_ON_HOVER_MS);
      }
    };
    const onUp = () => {
      const target = lastTarget;
      const dropped = active && target !== undefined;
      cleanup();
      setDrag(null);
      // The click that ends a drag lands on whatever is under the pointer; it shouldn't open it.
      if (active) setTimeout(() => { suppressClick.current = false; });
      if (!dropped) return;
      if (target) setExpanded(target, true);
      if (source.kind === 'note') void moveNote(source.id, target ?? undefined);
      else void moveFolder(source.id, target ?? undefined);
    };

    dragCleanup.current = cancel;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', cancel);
  };

  const commitRename = (row: Row, value: string) => {
    const ui = useUiStore.getState();
    const store = useNotesStore.getState();
    if (row.kind === 'folder') {
      ui.setFolderRenameRequest(null);
      void store.updateFolder(row.id, { name: value });
    } else {
      ui.finishRenaming();
      void store.updateNote(row.id, { title: value });
    }
    focusAfterRender.current = row.id;
  };

  const cancelRename = (row: Row) => {
    const ui = useUiStore.getState();
    if (row.kind === 'folder') ui.setFolderRenameRequest(null);
    else ui.finishRenaming();
    focusAfterRender.current = row.id;
  };

  const rootDrop = drag?.target === null;

  return (
    <div
      ref={scrollRef}
      role="tree"
      aria-label="Notes and folders"
      className={`file-tree min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-2 ${rootDrop ? 'bg-blue-500/[0.06]' : ''}`}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onClick={onClick}
      onDoubleClick={(event) => {
        const row = rowFromEvent(event.target);
        if (row?.kind === 'note' && !(event.target as Element).closest('button')) useWorkspaceStore.getState().pinTab(row.id);
      }}
      onContextMenu={(event) => openContextMenu(event, rowFromEvent(event.target))}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onPointerDown={onPointerDown}
    >
      {rows.length === 0 ? (
        <p className="px-3 py-2 text-xs leading-5 text-zinc-500">No notes yet. Create one above, or right-click here.</p>
      ) : (
        <div className="relative" style={{ height: rows.length * ROW_HEIGHT }}>
          {windowed.map(([row, index]) => (
            <TreeRow
              key={row.id}
              row={row}
              index={index}
              expanded={row.kind === 'folder' && expanded.has(row.id)}
              selected={row.id === selectedId}
              tabStop={row.id === tabStopId}
              vimCursor={row.id === vimCursorId}
              dropTarget={drag?.target === row.id}
              dragging={drag?.id === row.id}
              renaming={row.kind === 'folder' ? row.id === renamingFolderId : row.id === renamingNoteId}
              onCommitRename={commitRename}
              onCancelRename={cancelRename}
            />
          ))}
        </div>
      )}
      {drag && createPortal(
        <div
          ref={ghostRef}
          aria-hidden="true"
          className="pointer-events-none fixed left-0 top-0 z-[99999] max-w-64 truncate rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 shadow-lg shadow-black/50"
        >
          {drag.label}
          {drag.target === null && <span className="ml-2 text-zinc-400">Move to root</span>}
        </div>,
        document.body,
      )}
    </div>
  );
}
