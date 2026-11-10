import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS as DndCss } from '@dnd-kit/utilities';
import { FileText, GitBranch, Home, Maximize2, Minus, PanelLeft, PanelLeftDashed, PanelRight, PenTool, Search, X } from 'lucide-react';
import useUiStore from '../../store/UiStore';
import { useNotesStore } from '../../store/notesStore';
import { useSettingsStore } from '../../store/settingsStore';
import { IconButton } from '../ui/kit';
import { AnchoredMenu, MenuItem, MenuSeparator } from '../ui/menu';
import { closeTabs, goHome, openNote, openPalette } from './actions';
import { findNote, useNoteMeta, type NoteMeta } from './noteMeta';
import { SHORTCUTS } from './shortcuts';
import { useWorkspaceStore } from './workspaceStore';
import { useGitPolling } from './GitPanel';
import { changeCount, useGitStore } from '../../store/gitStore';

/** Keeps the tab list in step with what's open, and makes a tab permanent on the first edit. */
function useTabSync() {
  const currentNoteId = useNotesStore((s) => s.currentNote?.id ?? null);
  const notes = useNoteMeta();
  const ready = useWorkspaceStore((s) => s.ready);
  const loadError = useNotesStore((s) => s.loadError);

  useEffect(() => {
    if (currentNoteId) useWorkspaceStore.getState().openTab(currentNoteId);
  }, [currentNoteId]);

  useEffect(() => {
    if (ready && !loadError) useWorkspaceStore.getState().pruneTabs(new Set(notes.map((note) => note.id)));
  }, [notes, ready, loadError]);

  useEffect(() => useNotesStore.subscribe((state, previous) => {
    const note = state.currentNote;
    if (note && note.id === previous.currentNote?.id && note.content !== previous.currentNote.content) {
      useWorkspaceStore.getState().pinTab(note.id);
    }
  }), []);
}

function NoteTab({
  note,
  active,
  preview,
  onMenu,
}: {
  note: NoteMeta;
  active: boolean;
  preview: boolean;
  onMenu: (x: number, y: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: note.id });
  const title = note.title || 'Untitled';
  const Icon = note.note_type === 'canvas' ? PenTool : FileText;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      title={title}
      style={{ transform: DndCss.Translate.toString(transform), transition }}
      onClick={() => {
        const full = findNote(note.id);
        if (full && !active) void openNote(full);
      }}
      onDoubleClick={() => useWorkspaceStore.getState().pinTab(note.id)}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault();
          void closeTabs([note.id]);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          const full = findNote(note.id);
          if (full) void openNote(full);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
      className={`tab group relative flex h-full max-w-48 flex-shrink-0 cursor-default select-none items-center gap-1.5 border-r border-zinc-800 pl-2.5 pr-1 text-xs outline-none ${
        active ? 'bg-zinc-950 text-zinc-100' : 'text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300'
      } ${isDragging ? 'z-10 opacity-80' : ''}`}
    >
      <Icon size={13} className="flex-shrink-0" aria-hidden="true" />
      <span className={`min-w-0 truncate ${preview ? 'italic' : ''}`}>{title}</span>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Close ${title}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          void closeTabs([note.id]);
        }}
        className={`flex size-[18px] flex-shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-zinc-100 ${active ? '' : 'invisible group-hover:visible'}`}
      >
        <X size={12} />
      </button>
    </div>
  );
}

function WindowControls() {
  const call = async (action: 'minimize' | 'toggleMaximize' | 'close') => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow()[action]();
  };
  const buttonClass = 'flex h-full w-10 items-center justify-center text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-100';
  return (
    <div className="flex h-full flex-shrink-0">
      <button type="button" aria-label="Minimize window" className={buttonClass} onClick={() => void call('minimize')}><Minus size={14} /></button>
      <button type="button" aria-label="Maximize window" className={buttonClass} onClick={() => void call('toggleMaximize')}><Maximize2 size={12} /></button>
      <button type="button" aria-label="Close window" className={`${buttonClass} hover:bg-red-500/80`} onClick={() => void call('close')}><X size={14} /></button>
    </div>
  );
}

export function TabBar({
  onToggleSidebar,
  sidebarOpen = false,
  children,
}: {
  /** Set on narrow screens, where the button shows or hides the sidebar instead of pinning it. */
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
  children?: ReactNode;
}) {
  useTabSync();
  const tabs = useWorkspaceStore((s) => s.tabs);
  const previewTab = useWorkspaceStore((s) => s.previewTab);
  const currentNoteId = useNotesStore((s) => s.currentNote?.id ?? null);
  const notes = useNoteMeta();
  const isAiSidebarOpen = useUiStore((s) => s.isAiSidebarOpen);
  const setIsAiSidebarOpen = useUiStore((s) => s.setIsAiSidebarOpen);
  const sidebarFloating = useSettingsStore((s) => s.sidebarFloating);
  const setSidebarFloating = useSettingsStore((s) => s.setSidebarFloating);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const native = isTauri();
  const aiTab = useWorkspaceStore((s) => s.aiTab);
  const gitChanges = useGitStore((s) => changeCount(s.status));
  const showGit = native && isAiSidebarOpen && aiTab === 'git';
  useGitPolling(native);

  const byId = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  const shown = tabs.map((id) => byId.get(id)).filter((note): note is NoteMeta => !!note);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (!currentNoteId) return;
    stripRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [currentNoteId, tabs]);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) useWorkspaceStore.getState().moveTab(String(active.id), String(over.id));
  };

  const sidebarLabel = onToggleSidebar
    ? sidebarOpen ? 'Hide sidebar' : 'Show sidebar'
    : sidebarFloating ? 'Pin sidebar' : 'Auto-hide sidebar';
  const SidebarIcon = sidebarFloating && !onToggleSidebar ? PanelLeftDashed : PanelLeft;
  const menuIndex = menu ? tabs.indexOf(menu.id) : -1;

  return (
    <header className="flex h-9 flex-shrink-0 items-stretch border-b border-zinc-800 bg-zinc-925" data-tauri-drag-region={native || undefined}>
      <div className="flex flex-shrink-0 items-center border-r border-zinc-800 px-1">
        <IconButton
          label={sidebarLabel}
          shortcut={onToggleSidebar ? undefined : SHORTCUTS.sidebar}
          aria-pressed={onToggleSidebar ? sidebarOpen : sidebarFloating}
          onClick={onToggleSidebar ?? (() => setSidebarFloating(!sidebarFloating))}
        >
          <SidebarIcon size={15} />
        </IconButton>
      </div>
      <div ref={stripRef} role="tablist" aria-label="Open notes" className="tab-strip flex min-w-0 items-stretch overflow-x-auto overflow-y-hidden">
        <button
          type="button"
          role="tab"
          aria-selected={!currentNoteId}
          aria-label="Home tab"
          onClick={() => void goHome()}
          className={`flex w-9 flex-shrink-0 items-center justify-center border-r border-zinc-800 ${!currentNoteId ? 'bg-zinc-950 text-zinc-100' : 'text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300'}`}
        >
          <Home size={14} />
        </button>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={shown.map((note) => note.id)} strategy={horizontalListSortingStrategy}>
            {shown.map((note) => (
              <NoteTab
                key={note.id}
                note={note}
                active={note.id === currentNoteId}
                preview={note.id === previewTab}
                onMenu={(x, y) => setMenu({ x, y, id: note.id })}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
      <div className="min-w-4 flex-1" data-tauri-drag-region={native || undefined} />
      <div className="flex flex-shrink-0 items-center gap-0.5 px-1.5">
        {children}
        {native ? (
          <IconButton
            label={showGit ? 'Close source control' : 'Open source control'}
            hint={gitChanges ? `Source control · ${gitChanges} changed` : 'Source control'}
            aria-pressed={showGit}
            active={showGit}
            className="relative"
            onClick={() => {
              if (showGit) return setIsAiSidebarOpen(false);
              useWorkspaceStore.getState().setAiTab('git');
              setIsAiSidebarOpen(true);
            }}
          >
            <GitBranch size={15} />
            {gitChanges > 0 && (
              <span className="absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full bg-accent px-1 font-mono text-[9px] leading-[14px] text-zinc-950" aria-hidden="true">
                {gitChanges > 99 ? '99+' : gitChanges}
              </span>
            )}
          </IconButton>
        ) : (
          <IconButton label="Search notes and commands" hint="Search" shortcut={SHORTCUTS.quickSwitch} onClick={() => openPalette('notes')}>
            <Search size={15} />
          </IconButton>
        )}
        <IconButton
          label={isAiSidebarOpen ? 'Close AI sidebar' : 'Open AI sidebar'}
          hint={isAiSidebarOpen ? 'Close AI panel' : 'Open AI panel'}
          shortcut={SHORTCUTS.toggleAi}
          aria-pressed={isAiSidebarOpen}
          active={isAiSidebarOpen}
          onClick={() => setIsAiSidebarOpen(!isAiSidebarOpen)}
        >
          <PanelRight size={15} />
        </IconButton>
      </div>
      {native && <WindowControls />}
      {menu && (
        <AnchoredMenu key={`${menu.x}:${menu.y}`} x={menu.x} y={menu.y} onClose={() => setMenu(null)} onCloseAutoFocus={(event) => event.preventDefault()}>
          <MenuItem shortcut={SHORTCUTS.closeTab} onSelect={() => void closeTabs([menu.id])}>Close</MenuItem>
          <MenuItem disabled={tabs.length < 2} onSelect={() => void closeTabs(tabs.filter((id) => id !== menu.id))}>Close others</MenuItem>
          <MenuItem disabled={menuIndex === tabs.length - 1} onSelect={() => void closeTabs(tabs.slice(menuIndex + 1))}>Close to the right</MenuItem>
          <MenuSeparator />
          <MenuItem disabled={menu.id !== previewTab} onSelect={() => useWorkspaceStore.getState().pinTab(menu.id)}>Keep open</MenuItem>
        </AnchoredMenu>
      )}
    </header>
  );
}
