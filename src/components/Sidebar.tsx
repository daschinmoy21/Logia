import type { ReactNode } from "react";
import { Resizable } from "re-resizable";
import {
  CalendarDays,
  ChevronRight,
  ChevronsDownUp,
  FilePlus2,
  FolderPlus,
  Home,
  ListTodo,
  Mic,
  PenTool,
  Search,
  SettingsIcon,
  SquarePen,
  Star,
  Trash2,
} from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { useNotesStore } from "../store/notesStore";
import useUiStore from "../store/UiStore";
import { IconButton, Tip } from "./ui/kit";
import { createFolderIn, createIn, goHome, openPalette, openToday, selectNoteQuietly } from "./workspace/actions";
import { FileTree } from "./workspace/FileTree";
import { findNote, useNoteMeta } from "./workspace/noteMeta";
import { startRecording } from "./workspace/recording";
import { Kbd, SHORTCUTS } from "./workspace/shortcuts";
import { useWorkspaceStore } from "./workspace/workspaceStore";

const navRow =
  "flex h-7 w-full items-center gap-2 rounded-[5px] px-2 text-[13px] text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-40";

function NavButton({
  icon,
  label,
  active,
  disabled,
  trailing,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  trailing?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? "page" : undefined}
      className={`${navRow} ${active ? "bg-white/[0.13] text-zinc-50" : ""}`}
    >
      <span className="flex size-4 flex-shrink-0 items-center justify-center" aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {trailing}
    </button>
  );
}

function Favorites() {
  const notes = useNoteMeta();
  const currentNoteId = useNotesStore((s) => s.currentNote?.id ?? null);
  const open = useWorkspaceStore((s) => s.favoritesOpen);
  const setOpen = useWorkspaceStore((s) => s.setFavoritesOpen);
  const starred = notes.filter((note) => note.starred);
  if (starred.length === 0) return null;

  return (
    <section aria-label="Favorites" className="flex-shrink-0 px-1 pb-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="group flex h-6 w-full items-center gap-1 rounded-[5px] px-2 font-mono text-[11px] text-zinc-500 hover:text-zinc-300"
      >
        <span>Favorites</span>
        <ChevronRight size={11} className={`opacity-0 group-hover:opacity-100 ${open ? "rotate-90" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="max-h-44 overflow-y-auto">
          {starred.map((note) => {
            const full = () => findNote(note.id);
            return (
              <button
                key={note.id}
                type="button"
                onClick={() => {
                  const target = full();
                  if (target) void selectNoteQuietly(target);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  const target = full();
                  if (target) useUiStore.getState().setContextMenu({ x: event.clientX, y: event.clientY, note: target });
                }}
                className={`${navRow} ${currentNoteId === note.id ? "bg-white/[0.13] text-zinc-50" : ""}`}
              >
                <Star size={13} className="flex-shrink-0 fill-amber-300/90 text-amber-300/90" aria-hidden="true" />
                <span className="min-w-0 truncate">{note.title || "Untitled"}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export const Sidebar = () => {
  const currentNoteId = useNotesStore((s) => s.currentNote?.id ?? null);
  const currentNoteType = useNotesStore((s) => s.currentNote?.note_type);
  const isRecording = useUiStore((s) => s.isRecording);
  const width = useWorkspaceStore((s) => s.sidebarWidth);
  const native = isTauri();
  const ui = useUiStore.getState();
  const folderTarget = () => useWorkspaceStore.getState().treeFolderId ?? undefined;

  return (
    <>
      <Resizable
        as="aside"
        aria-label="Sidebar"
        className="flex h-full flex-col border-r border-zinc-800 bg-zinc-925 text-zinc-400"
        size={{ width: window.innerWidth < 768 ? Math.min(width, window.innerWidth - 40) : width, height: "100%" }}
        onResizeStop={(_event, _direction, element) => useWorkspaceStore.getState().setSidebarWidth(element.offsetWidth)}
        minWidth={200}
        maxWidth={480}
        enable={{ right: true }}
        handleStyles={{ right: { width: 7, right: -4 } }}
        handleClasses={{ right: "z-10 resize-handle" }}
      >
        <div className="flex h-9 flex-shrink-0 items-center gap-2 pl-3 pr-1.5" data-tauri-drag-region={native || undefined}>
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold tracking-tight text-zinc-100" data-tauri-drag-region={native || undefined}>Logia</span>
          <IconButton label="New note" shortcut={native ? SHORTCUTS.newNote : undefined} onClick={() => void createIn("text", folderTarget())}>
            <SquarePen size={15} />
          </IconButton>
        </div>

        <div className="flex-shrink-0 px-1.5 pb-2">
          <button
            type="button"
            onClick={() => openPalette("notes")}
            className="mb-1.5 flex h-7 w-full items-center gap-2 rounded-md border border-zinc-800 bg-white/[0.02] px-2 text-[13px] text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
          >
            <Search size={14} aria-hidden="true" />
            <span className="flex-1 text-left">Search</span>
            <Kbd keys={SHORTCUTS.quickSwitch} />
          </button>
          <NavButton icon={<Home size={15} />} label="Home" active={!currentNoteId} onClick={() => void goHome()} />
          <NavButton icon={<CalendarDays size={15} />} label="Today" onClick={() => void openToday()} />
          {native && <NavButton icon={<ListTodo size={15} />} label="Tasks" onClick={() => ui.setIsKanbanOpen(true)} />}
          {native && (
            <NavButton
              icon={<Mic size={15} className={isRecording ? "text-red-400" : ""} />}
              label={isRecording ? "Recording…" : "Record audio"}
              disabled={isRecording || !currentNoteId || currentNoteType === "canvas"}
              onClick={() => void startRecording()}
            />
          )}
        </div>

        <Favorites />

        <section aria-label="Notes tree" className="flex min-h-0 flex-1 flex-col">
          <div className="group flex h-6 flex-shrink-0 items-center pl-3 pr-1.5">
            <span className="flex-1 font-mono text-[11px] text-zinc-500">Notes</span>
            <div className="flex items-center opacity-60 group-hover:opacity-100">
              <Tip label="New note"><button type="button" aria-label="New note in tree" onClick={() => void createIn("text", folderTarget())} className="flex size-5 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-zinc-100"><FilePlus2 size={13} /></button></Tip>
              <Tip label="New canvas"><button type="button" aria-label="New canvas" onClick={() => void createIn("canvas", folderTarget())} className="flex size-5 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-zinc-100"><PenTool size={12} /></button></Tip>
              <Tip label="New folder" shortcut={native ? SHORTCUTS.newFolder : undefined}><button type="button" aria-label="New folder" onClick={() => void createFolderIn(folderTarget())} className="flex size-5 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-zinc-100"><FolderPlus size={13} /></button></Tip>
              <Tip label="Collapse all folders"><button type="button" aria-label="Collapse all folders" onClick={() => ui.setExpandedFolders(new Set())} className="flex size-5 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-zinc-100"><ChevronsDownUp size={13} /></button></Tip>
            </div>
          </div>
          <FileTree />
        </section>

        <div className="flex-shrink-0 border-t border-zinc-800 p-1.5">
          <NavButton icon={<SettingsIcon size={15} />} label="Settings" onClick={() => ui.setIsSettingsOpen(true)} />
          {native && <NavButton icon={<Trash2 size={15} />} label="Trash" onClick={() => ui.setIsTrashOpen(true)} />}
        </div>
      </Resizable>

    </>
  );
};
