import React from 'react';
import { FileMinus, PencilRuler, Folder, FolderOpen, ChevronRight, ChevronDown, MoreHorizontal } from 'lucide-react';
import { RiDeleteBin6Line } from 'react-icons/ri';
import { useSettingsStore } from '../store/settingsStore';
import { useVimStore } from '../store/vimStore';
import { useNotesStore } from '../store/notesStore';
import { Folder as FolderType } from '../types/Note';
import { findNote, useNoteMeta, type NoteMeta } from './workspace/noteMeta';
import {
  Files,
  FolderItem,
  FolderTrigger,
  FolderContent,
  File,
  FolderIcon,
  FolderLabel,
  FileIcon,
  FileLabel,
} from './animate-ui/primitives/radix/files';

const cursorRingClass = ' ring-1 ring-inset ring-blue-400/70 bg-zinc-800/60';

interface AnimatedFileTreeProps {
  onSelectNote: (note: any) => void;
  onSelectFolder: (folderId: string) => void;
  onContextMenu: (e: React.MouseEvent, item: any) => void;
  onDeleteFolder: (folderId: string, e: React.MouseEvent) => void;
  onDeleteNote: (noteId: string, e: React.MouseEvent) => void;
  selectedFolderId: string | null;
  expandedFolders: Set<string>;
  onExpandedFoldersChange: (expanded: Set<string>) => void;
  renamingNoteId: string | null;
  renamingFolderId: string | null;
  renameValue: string;
  folderRenameValue: string;
  onRename: () => void;
  onFolderRename: () => void;
  onRenameValueChange: (value: string) => void;
  onFolderRenameValueChange: (value: string) => void;
  onStartRenaming: (noteId: string, title: string) => void;
  onStartFolderRenaming: (folderId: string, name: string) => void;
  selectedNoteId: string | null;
  /** Keyboard cursor row while the vim explorer is active. */
  vimCursorId?: string | null;
  onCancelRename?: () => void;
  onCancelFolderRename?: () => void;
}

const noNotes: NoteMeta[] = [];

/** Fixed sizes and offsets differ between root and nested rows; `depth` is undefined at the root. */
const NoteRow = React.memo(function NoteRow({
  note,
  depth,
  selected,
  renaming,
  renameValue,
  cursor,
  actions,
}: {
  note: NoteMeta;
  depth?: number;
  selected: boolean;
  renaming: boolean;
  /** Empty unless this row is the one being renamed, so other rows skip rename keystrokes. */
  renameValue: string;
  cursor: boolean;
  actions: React.RefObject<AnimatedFileTreeProps>;
}) {
  const nested = depth !== undefined;
  const withNote = (run: (full: NonNullable<ReturnType<typeof findNote>>) => void) => {
    const full = findNote(note.id);
    if (full) run(full);
  };
  const openMenu = (e: React.MouseEvent) => withNote((full) => actions.current.onContextMenu(e, { note: full }));

  return (
    <File
      data-tree-id={note.id}
      data-tree-parent={note.folder_id}
      tabIndex={selected ? 0 : -1}
      aria-label={note.title || 'Untitled'}
      className={`
        group relative focus-visible:outline focus-visible:outline-1 focus-visible:outline-blue-400 font-small px-2 py-1.5 ${nested ? 'rounded-md' : 'rounded-lg'} cursor-pointer transition-all duration-200 flex items-center
        ${renaming
          ? nested ? 'bg-zinc-800' : 'bg-zinc-800 border border-zinc-700'
          : selected
            ? `${nested ? 'bg-blue-600/20' : 'bg-blue-600/30'} text-blue-100 border-l-2 border-blue-500`
            : `hover:bg-zinc-800/50 ${nested ? '' : 'border border-transparent '}text-zinc-300`
        }${cursor ? cursorRingClass : ''}
      `}
      style={nested ? { paddingLeft: `${(depth + 1) * 16 + 8}px` } : undefined}
      onClick={() => withNote((full) => actions.current.onSelectNote(full))}
      onContextMenu={openMenu}
      onDoubleClick={() => actions.current.onStartRenaming(note.id, note.title || 'Untitled')}
    >
      <div className='flex items-center justify-between w-full'>
        <div className='flex-1 min-w-0 pr-2'>
          <div className={`
            font-small text-sm truncate flex items-start
            ${renaming ? 'text-white' : selected ? 'text-blue-100' : 'text-zinc-300'}
          `}>
            <FileIcon className={`mr-2 flex-shrink-0 ${nested ? 'mt-0.5 ' : ''}${selected ? "text-blue-300" : "text-zinc-500"}`}>
              {note.note_type === 'canvas' ? <PencilRuler size={nested ? 15 : 17} /> : <FileMinus size={nested ? 13 : 15} />}
            </FileIcon>
            {renaming ? (
              <input
                type="text"
                value={renameValue}
                onChange={(e) => actions.current.onRenameValueChange(e.target.value)}
                onBlur={() => actions.current.onRename()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') actions.current.onRename();
                  if (e.key === 'Escape') actions.current.onCancelRename?.();
                }}
                className="w-full bg-zinc-700 text-white text-sm p-0 border-none outline-none focus:ring-0"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <FileLabel className={selected ? "text-blue-100" : "text-zinc-300"}>{note.title || 'Untitled'}</FileLabel>
            )}
          </div>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            openMenu(e);
          }}
          className='opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-white hover:bg-zinc-700/50 rounded transition-all duration-200 flex-shrink-0 active:scale-95 ml-auto mr-1'
          title="More options"
        >
          <MoreHorizontal size={14} />
        </button>
        <button
          onClick={(e) => actions.current.onDeleteNote(note.id, e)}
          className='opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400
          hover:bg-zinc-700 rounded transition-all duration-200 flex-shrink-0 active:scale-95'
          title="Delete note"
        >
          <RiDeleteBin6Line size={12} />
        </button>
      </div>
    </File>
  );
});

export const AnimatedFileTree: React.FC<AnimatedFileTreeProps> = (props) => {
  const {
    onSelectFolder,
    onContextMenu,
    onDeleteFolder,
    selectedFolderId,
    expandedFolders,
    onExpandedFoldersChange,
    renamingNoteId,
    renamingFolderId,
    renameValue,
    folderRenameValue,
    onFolderRename,
    onFolderRenameValueChange,
    onStartFolderRenaming,
    selectedNoteId,
    vimCursorId = null,
    onCancelFolderRename,
  } = props;
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Rows read the latest callbacks through a ref: new handlers shouldn't re-render them.
  const actions = React.useRef(props);
  React.useLayoutEffect(() => {
    actions.current = props;
  });

  React.useEffect(() => {
    if (!vimCursorId) return;
    const row = rootRef.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(vimCursorId)}"]`);
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const active = document.activeElement;
    if (row && active instanceof HTMLElement && rootRef.current?.contains(active) && active.matches('[data-tree-id]')) row.focus({ preventScroll: true });
  }, [vimCursorId]);

  const cursorRing = (id: string) => (id === vimCursorId ? cursorRingClass : '');

  const currentNotes = useNoteMeta();
  const currentFolders = useNotesStore((state) => state.folders);

  const notesByFolder = React.useMemo(() => {
    const groups = new Map<string | undefined, NoteMeta[]>();
    for (const note of currentNotes) {
      const key = note.folder_id ?? undefined;
      const group = groups.get(key);
      if (group) group.push(note);
      else groups.set(key, [note]);
    }
    return groups;
  }, [currentNotes]);

  const getChildFolders = (parentId?: string) => {
    if (parentId === undefined) {
      return currentFolders.filter(f => f.parent_id == null);
    }
    return currentFolders.filter(f => f.parent_id === parentId);
  };

  const getNotesInFolder = (folderId?: string) => notesByFolder.get(folderId) ?? noNotes;

  const renderNote = (note: NoteMeta, depth?: number) => {
    const renaming = note.id === renamingNoteId;
    return (
      <NoteRow
        key={note.id}
        note={note}
        depth={depth}
        selected={note.id === selectedNoteId}
        renaming={renaming}
        renameValue={renaming ? renameValue : ''}
        cursor={note.id === vimCursorId}
        actions={actions}
      />
    );
  };

  const renderFolder = (folder: FolderType, depth: number = 0): React.ReactNode => {
    const childFolders = getChildFolders(folder.id);
    const folderNotes = getNotesInFolder(folder.id);
    const isSelected = selectedFolderId === folder.id;
    const hasChildren = childFolders.length > 0 || folderNotes.length > 0;

    return (
      <FolderItem key={folder.id} value={folder.id}>
        <div
          data-tree-id={folder.id}
          data-tree-parent={folder.parent_id}
          data-tree-folder
          tabIndex={-1}
          className={`focus-visible:outline focus-visible:outline-1 focus-visible:outline-blue-400 flex items-center py-1.5 px-1 rounded-md cursor-pointer transition-all duration-200 group
            ${isSelected
              ? 'bg-blue-600/10 text-blue-100 border-l-2 border-blue-500'
              : 'hover:bg-zinc-800/70 text-zinc-300'
            }${cursorRing(folder.id)}`}
          style={{ paddingLeft: `${depth * 8}px` }}
          onClick={(e) => {
            e.stopPropagation();
            onSelectFolder(folder.id);
          }}
          onContextMenu={(e) => onContextMenu(e, { folder })}
          onDoubleClick={() => onStartFolderRenaming(folder.id, folder.name)}
        >
          <FolderTrigger
            className="flex items-center flex-1"
          >
            <div className="flex items-start mr-0.5">
              {hasChildren ? (
                <FolderIcon
                  closeIcon={<ChevronRight size={14} className={isSelected ? "text-blue-300" : "text-zinc-500"} />}
                  openIcon={<ChevronDown size={14} className={isSelected ? "text-blue-300" : "text-zinc-500"} />}
                />
              ) : (
                <div className="w-4" />
              )}
            </div>
            {expandedFolders.has(folder.id) ? (
              <FolderOpen size={16} className={isSelected ? "text-blue-200" : "text-blue-400"} />
            ) : (
              <Folder size={16} className={isSelected ? "text-blue-200" : "text-blue-400"} />
            )}
            {renamingFolderId === folder.id ? (
              <input
                type="text"
                value={folderRenameValue}
                onChange={(e) => onFolderRenameValueChange(e.target.value)}
                onBlur={onFolderRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onFolderRename();
                  if (e.key === 'Escape') onCancelFolderRename?.();
                }}
                className="flex-1 bg-zinc-700 text-white text-sm px-1 py-0.5 border-none outline-none focus:ring-0"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <FolderLabel className={isSelected ? "text-blue-100/90 text-sm truncate px-1 py-0.5" : "text-zinc-300 text-sm truncate px-1 py-0.5"}>
                {folder.name}
              </FolderLabel>
            )}
          </FolderTrigger>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onContextMenu(e, { folder });
            }}
            className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-white ml-auto mr-1 active:scale-95 transition-all"
            title="More options"
          >
            <MoreHorizontal size={14} />
          </button>
          <button
            onClick={(e) => onDeleteFolder(folder.id, e)}
            className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400 active:scale-95 transition-all"
            title="Delete folder"
          >
            <RiDeleteBin6Line size={12} />
          </button>
        </div>

        <FolderContent className="ml-4">
          {childFolders.map(childFolder => renderFolder(childFolder, depth + 1))}
          {folderNotes.map(note => renderNote(note, depth))}
        </FolderContent>
      </FolderItem>
    );
  };

  const onTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, button')) return;
    const row = target.closest<HTMLElement>('[data-tree-id]');
    if (!row) return;
    const rows = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-tree-id]') ?? [])].filter(item => item.getBoundingClientRect().height > 0);
    const index = rows.indexOf(row);
    const key = event.key;
    let destination: HTMLElement | undefined;
    if (key === 'ArrowDown' || key === 'j') destination = rows[Math.min(rows.length - 1, index + 1)];
    else if (key === 'ArrowUp' || key === 'k') destination = rows[Math.max(0, index - 1)];
    else if (key === 'Home') destination = rows[0];
    else if (key === 'End') destination = rows[rows.length - 1];
    else if (key === 'Enter' || key === ' ') {
      if (row.hasAttribute('data-tree-folder')) row.querySelector<HTMLButtonElement>('[data-slot="folder-trigger"]')?.click();
      else row.click();
    } else if (key === 'ArrowRight' || key === 'l') {
      if (row.hasAttribute('data-tree-folder') && !expandedFolders.has(row.dataset.treeId!)) row.querySelector<HTMLButtonElement>('[data-slot="folder-trigger"]')?.click();
      else destination = rows[index + 1];
    } else if (key === 'ArrowLeft' || key === 'h') {
      if (row.hasAttribute('data-tree-folder') && expandedFolders.has(row.dataset.treeId!)) row.querySelector<HTMLButtonElement>('[data-slot="folder-trigger"]')?.click();
      else destination = rows.find(item => item.dataset.treeId === row.dataset.treeParent);
    } else return;
    event.preventDefault(); event.stopPropagation();
    destination?.focus();
  };

  const rootFolders = getChildFolders(undefined);
  const rootNotes = getNotesInFolder(undefined);

  return (
    <div ref={rootRef} className='space-y-1' onKeyDown={onTreeKeyDown} onFocus={(event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>('[data-tree-id]');
      if (row && useSettingsStore.getState().vimEnabled && useVimStore.getState().mode === 'explorer') useVimStore.getState().setExplorerCursor(row.dataset.treeId!);
    }}>
      <Files
        open={Array.from(expandedFolders)}
        onOpenChange={(open) => onExpandedFoldersChange(new Set(open))}
      >
        {rootFolders.map(folder => renderFolder(folder))}
      </Files>

      {/* Root level notes */}
      {rootNotes.map((note) => renderNote(note))}
    </div>
  );
};
