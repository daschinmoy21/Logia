import React from 'react';
import { FileMinus, PencilRuler, Folder, FolderOpen, ChevronRight, ChevronDown } from 'lucide-react';
import { RiDeleteBin6Line } from 'react-icons/ri';
import { useNotesStore } from '../store/notesStore';
import { Folder as FolderType } from '../types/Note';
import useUiStore from '../store/UiStore';
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
}

export const AnimatedFileTree: React.FC<AnimatedFileTreeProps> = ({
  onSelectNote,
  onSelectFolder,
  onContextMenu,
  onDeleteFolder,
  onDeleteNote,
  selectedFolderId,
  expandedFolders,
  onExpandedFoldersChange,
  renamingNoteId,
  renamingFolderId,
  renameValue,
  folderRenameValue,
  onRename,
  onFolderRename,
  onRenameValueChange,
  onFolderRenameValueChange,
  onStartRenaming,
  onStartFolderRenaming,
}) => {
  const currentNotes = useNotesStore((state) => state.notes);
  const currentFolders = useNotesStore((state) => state.folders);

  const getChildFolders = (parentId?: string) => {
    if (parentId === undefined) {
      return currentFolders.filter(f => f.parent_id == null);
    }
    return currentFolders.filter(f => f.parent_id === parentId);
  };

  const getNotesInFolder = (folderId?: string) => {
    if (folderId === undefined) {
      return currentNotes.filter(n => n.folder_id == null);
    }
    return currentNotes.filter(n => n.folder_id === folderId);
  };

  const renderFolder = (folder: FolderType, depth: number = 0): React.ReactNode => {
    const childFolders = getChildFolders(folder.id);
    const folderNotes = getNotesInFolder(folder.id);
    const isSelected = selectedFolderId === folder.id;
    const hasChildren = childFolders.length > 0 || folderNotes.length > 0;

    return (
      <FolderItem key={folder.id} value={folder.id}>
        <div
          className={`flex py-1.5 px-1 rounded-md cursor-pointer group ${isSelected ? 'bg-zinc-800' : 'hover:bg-zinc-800/70'}`}
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
                  closeIcon={<ChevronRight size={14} className="text-zinc-500" />}
                  openIcon={<ChevronDown size={14} className="text-zinc-500" />}
                />
              ) : (
                <div className="w-4" />
              )}
            </div>
            {expandedFolders.has(folder.id) ? (
              <FolderOpen size={16} className="text-blue-400" />
            ) : (
              <Folder size={16} className="text-blue-400" />
            )}
            {renamingFolderId === folder.id ? (
              <input
                type="text"
                value={folderRenameValue}
                onChange={(e) => onFolderRenameValueChange(e.target.value)}
                onBlur={onFolderRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onFolderRename();
                  if (e.key === 'Escape') {
                    // Reset renaming state
                  }
                }}
                className="flex-1 bg-zinc-700 text-white text-sm px-1 py-0.5 border-none outline-none focus:ring-0"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
      <FolderLabel className="text-sm text-zinc-300 truncate px-1 py-0.5">
        {folder.name}
      </FolderLabel>
            )}
          </FolderTrigger>
          <button
            onClick={(e) => onDeleteFolder(folder.id, e)}
            className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400 ml-2 active:scale-95"
            title="Delete folder"
          >
            <RiDeleteBin6Line size={12} />
          </button>
        </div>

        <FolderContent className="ml-4">
          {childFolders.map(childFolder => renderFolder(childFolder, depth + 1))}
          {folderNotes.map(note => (
            <File
              key={note.id}
              className={`
                group relative font-small px-2 py-1.5 rounded-md cursor-pointer transition-all duration-200
                ${note.id === renamingNoteId
                  ? 'bg-zinc-800'
                  : 'hover:bg-zinc-800/50'
                }
              `}
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
              onClick={() => onSelectNote(note)}
              onContextMenu={(e) => onContextMenu(e, { note })}
              onDoubleClick={() => onStartRenaming(note.id, note.title || 'Untitled')}
            >
              <div className='flex items-start justify-between'>
                <div className='flex-1 min-w-0 pr-2'>
                  <div className={`
                    font-small text-sm truncate flex items-start
                    ${note.id === renamingNoteId ? 'text-white' : 'text-zinc-300'}
                  `}>
                    <FileIcon className="mr-2 flex-shrink-0 mt-0.5">
                      {note.note_type === 'canvas' ? <PencilRuler size={15} /> : <FileMinus size={13} />}
                    </FileIcon>
                    {renamingNoteId === note.id ? (
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => onRenameValueChange(e.target.value)}
                        onBlur={onRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') onRename();
                          if (e.key === 'Escape') {
                            // Reset renaming state
                          }
                        }}
                        className="w-full bg-zinc-700 text-white text-sm p-0 border-none outline-none focus:ring-0"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <FileLabel>{note.title || 'Untitled'}</FileLabel>
                    )}
                  </div>
                </div>

                <button
                  onClick={(e) => onDeleteNote(note.id, e)}
                  className='opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400
                  hover:bg-zinc-700 rounded transition-all duration-200 flex-shrink-0 active:scale-95'
                  title="Delete note"
                >
                  <RiDeleteBin6Line size={12} />
                </button>
              </div>
            </File>
          ))}
        </FolderContent>
      </FolderItem>
    );
  };

  const rootFolders = getChildFolders(undefined);
  const rootNotes = getNotesInFolder(undefined);

  return (
    <div className='space-y-1'>
      <Files
        open={Array.from(expandedFolders)}
        onOpenChange={(open) => onExpandedFoldersChange(new Set(open))}
      >
        {rootFolders.map(folder => renderFolder(folder))}
      </Files>

      {/* Root level notes */}
      {rootNotes.map((note) => (
        <File
          key={note.id}
          className={`
            group relative font-small px-2 py-1.5 rounded-lg cursor-pointer transition-all duration-200
            ${note.id === renamingNoteId
              ? 'bg-zinc-800 border border-zinc-700'
              : 'hover:bg-zinc-800/50 border border-transparent'
            }
          `}
          onClick={() => onSelectNote(note)}
          onContextMenu={(e) => onContextMenu(e, { note })}
          onDoubleClick={() => onStartRenaming(note.id, note.title || 'Untitled')}
        >
          <div className='flex items-start justify-between'>
            <div className='flex-1 min-w-0 pr-2'>
              <div className={`
                font-small text-sm truncate flex items-start
                ${note.id === renamingNoteId ? 'text-white' : 'text-zinc-300'}
              `}>
                <FileIcon className="mr-2 flex-shrink-0">
                  {note.note_type === 'canvas' ? <PencilRuler size={17} /> : <FileMinus size={15} />}
                </FileIcon>
                {renamingNoteId === note.id ? (
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => onRenameValueChange(e.target.value)}
                    onBlur={onRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onRename();
                      if (e.key === 'Escape') {
                        // Reset renaming state
                      }
                    }}
                    className="w-full bg-zinc-700 text-white text-sm p-0 border-none outline-none focus:ring-0"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <FileLabel>{note.title || 'Untitled'}</FileLabel>
                )}
              </div>
            </div>

            <button
              onClick={(e) => onDeleteNote(note.id, e)}
              className='opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400
              hover:bg-zinc-700 rounded transition-all duration-200 flex-shrink-0 active:scale-95'
              title="Delete note"
            >
              <RiDeleteBin6Line size={14} />
            </button>
          </div>
        </File>
      ))}
    </div>
  );
};
