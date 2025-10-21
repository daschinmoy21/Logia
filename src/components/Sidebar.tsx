import { useEffect, useState } from 'react';
import { FileMinus, PencilRuler, Folder, FolderOpen, ChevronRight, ChevronDown, ListTodo, Clock, CheckCircle } from 'lucide-react';
import { Resizable } from 're-resizable';
import { AnimatePresence, motion } from 'framer-motion';
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
import {
  KanbanProvider,
  KanbanBoard,
  KanbanHeader,
  KanbanCards,
  KanbanCard,
} from './ui/shadcn-io/kanban';
import { invoke } from '@tauri-apps/api/core';
import { AnimatedFileTree } from './AnimatedFileTree';

type KanbanTask = {
  id: string;
  name: string;
  column: string;
  created_at: string;
  updated_at: string;
};

export const Sidebar = () => {
  // Subscribing to state changes individually
  const currentNote = useNotesStore((state) => state.currentNote);

  // Getting actions (they don't cause re-renders)
  const { loadNotes, loadFolders, selectNote, deleteNote, createNote, createFolder, updateNote, updateFolder, deleteFolder } = useNotesStore.getState();

  // Subscribing to UI state changes individually
  const deleteConfirmId = useUiStore((state) => state.deleteConfirmId);
  const deleteConfirmFolderId = useUiStore((state) => state.deleteConfirmFolderId);
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

  // Kanban state
  const [kanbanData, setKanbanData] = useState<KanbanTask[]>([]);

  // Load kanban tasks
  const loadKanbanTasks = async () => {
    try {
      const tasks = await invoke<KanbanTask[]>('get_kanban_data');
      setKanbanData(tasks);
    } catch (error) {
      console.error('Failed to load kanban tasks:', error);
    }
  };

  // Save kanban data
  const saveKanbanData = async (data: KanbanTask[]) => {
    try {
      await invoke('save_kanban_data', { tasks: data });
    } catch (error) {
      console.error('Failed to save kanban data:', error);
    }
  };

  useEffect(() => {
    loadKanbanTasks();
  }, []);
  const kanbanColumns = [
    { id: 'todo', name: 'To Do' },
    { id: 'in-progress', name: 'In Progress' },
    { id: 'done', name: 'Done' },
  ];
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskName, setEditingTaskName] = useState('');

  const addTask = (columnId: string) => {
    const newId = Date.now().toString();
    const newTask: KanbanTask = { id: newId, name: 'New Task', column: columnId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const newData = [...kanbanData, newTask];
    setKanbanData(newData);
    saveKanbanData(newData);
  };

  const deleteTask = (taskId: string) => {
    const newData = kanbanData.filter(task => task.id !== taskId);
    setKanbanData(newData);
    saveKanbanData(newData);
  };

  const startEditingTask = (taskId: string, currentName: string) => {
    setEditingTaskId(taskId);
    setEditingTaskName(currentName);
  };

  const saveTaskName = () => {
    if (editingTaskId && editingTaskName.trim()) {
      const newData = kanbanData.map(task =>
        task.id === editingTaskId ? { ...task, name: editingTaskName.trim(), updated_at: new Date().toISOString() } : task
      );
      setKanbanData(newData);
      saveKanbanData(newData);
    }
    setEditingTaskId(null);
    setEditingTaskName('');
  };

  const cancelEditing = () => {
    setEditingTaskId(null);
    setEditingTaskName('');
  };

  // Getting UI actions
  const {
    openCommandPalette,
    setDeleteConfirmId,
    setDeleteConfirmFolderId,
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

  const handleDeleteFolder = async (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirmFolderId(folderId);
  };

  const handleDeleteNote = async (noteId: string, e: React.MouseEvent) => {
    e.stopPropagation(); //to stop event bubbling 
    setDeleteConfirmId(noteId);
  };

  const confirmDeleteFolder = async () => {
    if (deleteConfirmFolderId) {
      try {
        await deleteFolder(deleteConfirmFolderId);
        setDeleteConfirmFolderId(null);
      } catch (error) {
        console.log("Failed to delete folder", error);
      }
    }
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
          <AnimatedFileTree
            onSelectNote={selectNote}
            onSelectFolder={selectFolder}
            onContextMenu={(e, item) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ x: e.clientX, y: e.clientY, ...item });
            }}
            onDeleteFolder={handleDeleteFolder}
            onDeleteNote={handleDeleteNote}
            selectedFolderId={selectedFolderId}
            expandedFolders={expandedFolders}
            onExpandedFoldersChange={setExpandedFolders}
            renamingNoteId={renamingNoteId}
            renamingFolderId={renamingFolderId}
            renameValue={renameValue}
            folderRenameValue={folderRenameValue}
            onRename={handleRename}
            onFolderRename={handleFolderRename}
            onRenameValueChange={setRenameValue}
            onFolderRenameValueChange={setFolderRenameValue}
            onStartRenaming={startRenaming}
            onStartFolderRenaming={(folderId, name) => {
              setRenamingFolderId(folderId);
              setFolderRenameValue(name);
            }}
          />
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
         className="relative z-[1000]"
       >
         <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setDeleteConfirmId(null)} />

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

       {/* Delete folder confirmation dialog */}
       <Dialog
         open={deleteConfirmFolderId !== null}
         onClose={() => setDeleteConfirmFolderId(null)}
         className="relative z-[1000]"
       >
         <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setDeleteConfirmFolderId(null)} />

        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="bg-zinc-800 border border-zinc-700 rounded-xl p-6 max-w-sm w-full">
            <DialogTitle className="text-white font-medium mb-2">
              Delete Folder
            </DialogTitle>

            <Description className="text-zinc-400 text-sm mb-6">
              Are you sure you want to delete this folder and all its contents? This action cannot be undone.
            </Description>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirmFolderId(null)}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-white
                hover:bg-zinc-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteFolder}
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

       {/* Kanban dialog */}
       {isKanbanOpen && (
         <Dialog
           open={isKanbanOpen}
           onClose={() => setIsKanbanOpen(false)}
           className="relative z-[1000]"
         >
           <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
           <div className="fixed inset-0 flex items-center justify-center p-4" onClick={() => setIsKanbanOpen(false)}>
             <DialogPanel className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-6xl h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <DialogTitle className="text-white font-medium">
                  Kanban Board
                </DialogTitle>
                <button
                  onClick={() => setIsKanbanOpen(false)}
                  className="text-zinc-400 hover:text-white text-xl font-bold"
                >
                  ×
                </button>
              </div>
               <KanbanProvider
                 columns={kanbanColumns}
                 data={kanbanData}
                 onDataChange={(newData) => {
                   setKanbanData(newData);
                   saveKanbanData(newData);
                 }}
               >
                {(column) => (
                  <KanbanBoard id={column.id} className="flex-1">
                    <KanbanHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-zinc-200">
                          {column.id === 'todo' && <ListTodo size={16} className="text-blue-400" />}
                          {column.id === 'in-progress' && <Clock size={16} className="text-yellow-400" />}
                          {column.id === 'done' && <CheckCircle size={16} className="text-green-400" />}
                          <span className="font-semibold">{column.name}</span>
                        </div>
                        <button
                          onClick={() => addTask(column.id)}
                          className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded transition-colors"
                          title="Add Task"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </KanbanHeader>
                    <KanbanCards id={column.id}>
                      {(item) => (
                        <KanbanCard key={item.id} {...item} onDelete={deleteTask}>
                          {editingTaskId === item.id ? (
                            <input
                              type="text"
                              value={editingTaskName}
                              onChange={(e) => setEditingTaskName(e.target.value)}
                              onBlur={saveTaskName}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveTaskName();
                                if (e.key === 'Escape') cancelEditing();
                              }}
                              className="bg-zinc-800 border border-zinc-400 rounded px-2 py-1 text-zinc-500 w-full outline-none focus:border-zinc-700"
                              autoFocus
                            />
                          ) : (
                            <p
                              className="m-0 font-medium text-sm cursor-pointer"
                              onDoubleClick={() => startEditingTask(item.id, item.name)}
                            >
                              {item.name}
                            </p>
                          )}
                        </KanbanCard>
                      )}
                    </KanbanCards>
                  </KanbanBoard>
                )}
              </KanbanProvider>
            </DialogPanel>
          </div>
        </Dialog>
      )}
    </>
  );
};
