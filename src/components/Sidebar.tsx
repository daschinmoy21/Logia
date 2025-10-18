import { useEffect, useState } from 'react';
import { FileMinus, PencilRuler, Folder, FolderOpen, ChevronRight, ChevronDown } from 'lucide-react';
import { Resizable } from 're-resizable';
import { ListTodo } from 'lucide-react';
import { GoPersonFill } from 'react-icons/go';
import { IoSettingsOutline } from 'react-icons/io5';
import { AiOutlineLayout, AiOutlineFolderAdd } from 'react-icons/ai';
import { CiSearch } from 'react-icons/ci';
import { Bot, Plus } from 'lucide-react';
import { RiDeleteBin6Line } from 'react-icons/ri';
import { Description, Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { useNotesStore } from '../store/notesStore';
import { Folder as FolderType } from '../types/Note';
import RecStatus from './RecStatus';
import useUiStore from '../store/UiStore';

export const Sidebar = () => {
  // Subscribing to state changes individually
  const currentNote = useNotesStore((state) => state.currentNote);

  // Getting actions (they don't cause re-renders)
  const { loadNotes, loadFolders, selectNote, deleteNote, createNote, createFolder, updateNote, updateFolder, deleteFolder } = useNotesStore.getState();

  // Subscribing to UI state changes individually
  const deleteConfirmId = useUiStore((state) => state.deleteConfirmId);
  const renamingNoteId = useUiStore((state) => state.renamingNoteId);
  const renameValue = useUiStore((state) => state.renameValue);
  const contextMenu = useUiStore((state) => state.contextMenu);
  const isSettingsOpen = useUiStore((state) => state.isSettingsOpen);
  const isKanbanOpen = useUiStore((state) => state.isKanbanOpen);
  const isSupportOpen = useUiStore((state) => state.isSupportOpen);
  const isRecording = useUiStore((state) => state.isRecording);

  // Folder renaming state
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [folderRenameValue, setFolderRenameValue] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Getting UI actions
  const {
    openCommandPalette,
    setDeleteConfirmId,
    startRenaming,
    finishRenaming,
    setRenameValue,
    setContextMenu,
    setIsSettingsOpen,
    setIsKanbanOpen,
    setIsSupportOpen,
    setIsRecording,
  } = useUiStore.getState();


  useEffect(() => {
    loadNotes();
    loadFolders();
  }, [loadNotes, loadFolders]);

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [setContextMenu]);

  const handleCreateNote = async (noteType: 'text' | 'canvas' = 'text', folderId?: string) => {
    try {
      await createNote(noteType, folderId || selectedFolderId || undefined);
    } catch (error) {
      console.error("Error creating note", error);
    }
  };

  const handleCreateFolder = async (folderId?: string) => {
    try {
      await createFolder('New Folder', folderId || selectedFolderId || undefined);
    } catch (error) {
      console.error("Error creating folder", error);
    }
  };

  const handleDeleteNote = async (noteId: string, e: React.MouseEvent) => {
    e.stopPropagation(); //to stop event bubbling 
    setDeleteConfirmId(noteId);
  };

  const confirmDelete = async () => {
    if (deleteConfirmId) {
      try {
        await deleteNote(deleteConfirmId);
        setDeleteConfirmId(null);
      } catch (error) {
        console.log("Failed to delete note", error);
      }
    }
  };

  const handleRename = () => {
    if (renamingNoteId && renameValue.trim()) {
      updateNote(renamingNoteId, { title: renameValue.trim() });
    }
    finishRenaming();
  };

  const handleFolderRename = () => {
    if (renamingFolderId && folderRenameValue.trim()) {
      updateFolder(renamingFolderId, { name: folderRenameValue.trim() });
    }
    setRenamingFolderId(null);
    setFolderRenameValue('');
  };

  const selectFolder = (folderId: string) => {
    setSelectedFolderId(folderId);
    setExpandedFolders(prev => new Set([...prev, folderId]));
  };

  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folderId)) {
        newSet.delete(folderId);
      } else {
        newSet.add(folderId);
      }
      return newSet;
    });
  };

  // File Tree Component
  const FileTree = () => {
    // Get fresh state inside component to ensure re-renders
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

    const renderTreeItem = (folder: FolderType, depth: number = 0) => {
      const childFolders = getChildFolders(folder.id);
      const folderNotes = getNotesInFolder(folder.id);
      const isExpanded = expandedFolders.has(folder.id);
      const isSelected = selectedFolderId === folder.id;
      const hasChildren = childFolders.length > 0 || folderNotes.length > 0;

      return (
        <div key={folder.id}>
          <div
            className={`flex items-center py-1.5 px-1 rounded-md cursor-pointer group ${isSelected ? 'bg-zinc-800' : 'hover:bg-zinc-800/70'}`}
            style={{ paddingLeft: `${depth * 8}px` }}
            onClick={() => selectFolder(folder.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ x: e.clientX, y: e.clientY, folder });
            }}
            onDoubleClick={() => {
              setRenamingFolderId(folder.id);
              setFolderRenameValue(folder.name);
            }}
          >
            <div className="flex items-center mr-1">
              {hasChildren ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFolder(folder.id);
                  }}
                  className="text-zinc-500 hover:text-zinc-300 p-0.5 active:scale-95"
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              ) : (
                <div className="w-4" />
              )}
            </div>
            {isExpanded ? <FolderOpen size={16} className="text-blue-400 mr-2" /> : <Folder size={16} className="text-blue-400 mr-2" />}
            {renamingFolderId === folder.id ? (
              <input
                type="text"
                value={folderRenameValue}
                onChange={(e) => setFolderRenameValue(e.target.value)}
                onBlur={handleFolderRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleFolderRename();
                  if (e.key === 'Escape') {
                    setRenamingFolderId(null);
                    setFolderRenameValue('');
                  }
                }}
                className="flex-1 bg-zinc-700 text-white text-sm px-1 py-0.5 border-none outline-none focus:ring-0"
                autoFocus
              />
            ) : (
              <span className="text-sm text-zinc-300 truncate flex-1">{folder.name}</span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteFolder(folder.id);
              }}
              className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400 ml-2 active:scale-95"
              title="Delete folder"
            >
              <RiDeleteBin6Line size={12} />
            </button>
          </div>

          {isExpanded && (
            <div className="mt-1">
              {childFolders.map(childFolder => renderTreeItem(childFolder, depth + 1))}
              {folderNotes.map(note => (
                <div
                  key={note.id}
                  onClick={() => selectNote(note)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, note });
                  }}
                  className={`
                    group relative font-small px-2 py-1.5 rounded-md cursor-pointer transition-all duration-200
                    ${currentNote?.id === note.id
                      ? 'bg-zinc-800'
                      : 'hover:bg-zinc-800/50'
                    }
                  `}
                  style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
                >
                  <div className='flex items-start justify-between'>
                    <div className='flex-1 min-w-0 pr-2'>
                      <div className={`
                        font-small text-sm truncate flex items-start
                        ${currentNote?.id === note.id ? 'text-white' : 'text-zinc-300'}
                      `}>
                        {note.note_type === 'canvas' ? <PencilRuler size={15} className='mr-2 flex-shrink-0 mt-0.5' /> : <FileMinus size={13} className='mr-2 flex-shrink-0 mt-0.5' />}
                        {renamingNoteId === note.id ? (
                          <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={handleRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRename();
                              if (e.key === 'Escape') finishRenaming();
                            }}
                            className="w-full bg-zinc-700 text-white text-sm p-0 border-none outline-none focus:ring-0"
                            autoFocus
                          />
                        ) : (
                          note.title || 'Untitled'
                        )}
                      </div>
                    </div>

                    <button
                      onClick={(e) => handleDeleteNote(note.id, e)}
                      className='opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400
                      hover:bg-zinc-700 rounded transition-all duration-200 flex-shrink-0 active:scale-95'
                      title="Delete note"
                    >
                      <RiDeleteBin6Line size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    };

    const rootFolders = getChildFolders(undefined);
    const rootNotes = getNotesInFolder(undefined);

    return (
      <div className='space-y-1'>
        {rootFolders.map(folder => renderTreeItem(folder))}
        {rootNotes.map((note) => (
          <div
            key={note.id}
            onClick={() => selectNote(note)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, note });
            }}
            className={`
              group relative font-small px-2 py-1.5 rounded-lg cursor-pointer transition-all duration-200
              ${currentNote?.id === note.id
                ? 'bg-zinc-800 border border-zinc-700'
                : 'hover:bg-zinc-800/50 border border-transparent'
              }
            `}
          >
            <div className='flex items-start justify-between'>
              <div className='flex-1 min-w-0 pr-2'>
                <div className={`
                  font-small text-sm truncate flex items-start
                  ${currentNote?.id === note.id ? 'text-white' : 'text-zinc-300'}
                `}>
                  {note.note_type === 'canvas' ? <PencilRuler size={17} className='mr-2 flex-shrink-0' /> : <FileMinus size={15} className='mr-2 flex-shrink-0' />}
                  {renamingNoteId === note.id ? (
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={handleRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename();
                        if (e.key === 'Escape') finishRenaming();
                      }}
                      className="w-full bg-zinc-700 text-white text-sm p-0 border-none outline-none focus:ring-0"
                      autoFocus
                    />
                  ) : (
                    note.title || 'Untitled'
                  )}
                </div>
              </div>

              <button
                onClick={(e) => handleDeleteNote(note.id, e)}
                className='opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400
                hover:bg-zinc-700 rounded transition-all duration-200 flex-shrink-0 active:scale-95'
                title="Delete note"
              >
                <RiDeleteBin6Line size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      <Resizable
        as="aside"
        className="bg-zinc-900 py-2 border-r border-zinc-850 flex flex-col h-full"
        defaultSize={{ width: 270, height: '100%' }}
        minWidth={230}
        maxWidth={340}
        enable={{ right: true }}
        handleClasses={{ right: 'w-1 bg-zinc-900 hover:bg-zinc-700 transition-colors' }}
      >
        {/* Search button */}
        <div className='mb-2 px-2'>
          <button
            onClick={openCommandPalette}
            className='w-full bg-zinc-800/50 border border-zinc-700 hover:bg-zinc-800 transition-colors text-zinc-400 text-sm flex items-center gap-2 p-2 rounded-md active:scale-95'
          >
            <CiSearch size={18} />
            Search (Alt + P)
          </button>
        </div>

        {/* Action buttons row */}
        <div className='bg-zinc-900 flex justify-around text-sm mb-1 pb-2 border-b border-zinc-700'>
          <button
            title="Notes Agent"
            className='p-2 text-zinc-500 cursor-not-allowed focus:outline-none'
            disabled
          >
            <Bot size={20} />
          </button>
          <button
            title="New Canvas"
            className='p-2 text-zinc-400 hover:text-blue-400 cursor-pointer focus:outline-none transition-colors active:scale-95'
            onClick={() => {
              console.log("Canvas button clicked");
              handleCreateNote('canvas');
            }}
          >
            <AiOutlineLayout size={20} />
          </button>
          <button
            title="New Folder"
            className='p-2 text-zinc-400 hover:text-yellow-400 cursor-pointer focus:outline-none transition-colors active:scale-95'
            onClick={() => handleCreateFolder()}
          >
            <AiOutlineFolderAdd size={20} />
          </button>
          <button
            title="New Note"
            className='p-2 text-zinc-400 hover:text-green-400 cursor-pointer  focus:outline-none px-3 py-1 rounded-md transition-all duration-200 active:scale-95'
            onClick={() => handleCreateNote('text')}
          >
            <Plus size={20} />
          </button>
        </div>
        {/* Recording animation div visible when capturing system audio */}
        {isRecording &&
          <RecStatus isRecording={isRecording} onStop={() => setIsRecording(false)} />
        }


        {/* File Tree */}
        <div className='flex-1 overflow-y-auto px-2' onClick={(e) => {
          if (e.target === e.currentTarget) {
            setSelectedFolderId(null);
          }
        }}>
          <FileTree />
        </div>
        {/* Bottom Actions */}
        <div className="mt-auto border-t border-zinc-700/50 ">
          <div className="px-2 pt-2">
            <button
              className="w-full text-left text-zinc-400 hover:text-blue-400 hover:bg-zinc-800/50 cursor-pointer focus:outline-none px-3 py-1
              rounded-md transition-all duration-200 active:scale-95"
              onClick={() => {
                setIsKanbanOpen(!isKanbanOpen);
                setIsSettingsOpen(false);
                setIsSupportOpen(false);
              }}
              title="Kanban Board"
            >
              <span className="flex items-center text-sm font-bold">
                <ListTodo className="mr-3" size={18} />
                To-do List
              </span>
            </button>
          </div>

          <div className="px-2 py-1">
            <button
              className="w-full text-left text-zinc-400 hover:text-white hover:bg-zinc-800/50 cursor-pointer focus:outline-none px-3 py-1  rounded-md transition-all duration-200 active:scale-95"
              onClick={() => {
                setIsSettingsOpen(!isSettingsOpen);
                setIsKanbanOpen(false);
                setIsSupportOpen(false);
              }}
              title="Settings"
            >
              <span className="flex items-center text-sm font-bold">
                <IoSettingsOutline className="mr-3" size={18} />
                Settings
              </span>
            </button>
          </div>

          <div className="px-2 py-1">
            <button
              className="w-full text-left text-zinc-400 hover:text-purple-400 hover:bg-zinc-800/50 cursor-pointer focus:outline-none px-3 py-1 rounded-md transition-all duration-200 active:scale-95"
              onClick={() => {
                setIsSupportOpen(!isSupportOpen);
                setIsKanbanOpen(false);
                setIsSettingsOpen(false);
              }}
              title="Support"
            >
              <span className="flex items-center text-sm font-bold">
                <GoPersonFill className="mr-3" size={18} />
                Support
              </span>
            </button>
          </div>
        </div>
      </Resizable>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteConfirmId !== null}
        onClose={() => setDeleteConfirmId(null)}
        className="relative z-50"
      >
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" aria-hidden="true" />

        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="bg-zinc-800 border border-zinc-700 rounded-xl p-6 max-w-sm w-full">
            <DialogTitle className="text-white font-medium mb-2">
              Delete Note
            </DialogTitle>

            <Description className="text-zinc-400 text-sm mb-6">
              Are you sure you want to delete this note? This action cannot be undone.
            </Description>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-white 
                hover:bg-zinc-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white 
                rounded-lg transition-colors"
              >
                Delete
              </button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>

      {contextMenu && (
        <div
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="absolute z-50 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg py-1"
        >
          {contextMenu.note && (
            <button
              onClick={() => {
                startRenaming(contextMenu!.note!.id, contextMenu!.note!.title || 'Untitled');
                setContextMenu(null);
              }}
              className="block w-full text-left px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700 active:scale-95"
            >
              Rename
            </button>
          )}
          {contextMenu.folder && (
            <>
              <button
                onClick={() => {
                  handleCreateNote('text', contextMenu!.folder!.id);
                  setContextMenu(null);
                }}
                className="block w-full text-left px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700 active:scale-95"
              >
                New Note
              </button>
              <button
                onClick={() => {
                  handleCreateFolder(contextMenu!.folder!.id);
                  setContextMenu(null);
                }}
                className="block w-full text-left px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700 active:scale-95"
              >
                New Folder
              </button>
              <button
                onClick={() => {
                  setRenamingFolderId(contextMenu!.folder!.id);
                  setFolderRenameValue(contextMenu!.folder!.name);
                  setContextMenu(null);
                }}
                className="block w-full text-left px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700 active:scale-95"
              >
                Rename
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
};
