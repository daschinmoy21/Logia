import { useState, useEffect } from 'react';
import { FileMinus, PencilRuler } from 'lucide-react';
import { Resizable } from 're-resizable';
import { Settings } from 'lucide-react';

import { BiEditAlt } from 'react-icons/bi';
import { GoPersonFill } from 'react-icons/go';
import { IoSettingsOutline } from 'react-icons/io5';
import { AiOutlineCheckSquare, AiOutlineLayout, AiOutlineFolderAdd } from 'react-icons/ai';
import { CiSearch } from 'react-icons/ci';
import { HiOutlineSparkles } from 'react-icons/hi2';
import { Bot, Plus } from 'lucide-react';
import { RiDeleteBin6Line } from 'react-icons/ri';
import { Description, Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { useNotesStore } from '../store/notesStore';
import { Note } from '../types/Note';

interface SidebarProps {
  toggleCommandPallete: () => void;
}

export const Sidebar = ({ toggleCommandPallete }: SidebarProps) => {
  const {
    notes,
    currentNote,
    isLoading,
    loadNotes,
    selectNote,
    deleteNote,
    createNote,
    updateNote,
  } = useNotesStore();

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; note: Note } | null>(null);


  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  const handleCreateNote = async (noteType: 'text' | 'canvas' = 'text') => {
    try {
      await createNote(noteType);
    } catch (error) {
      console.error("Error creating note", error);
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
    setRenamingNoteId(null);
    setRenameValue('');
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  return (
    <>
      <Resizable
        as="aside"
        className="bg-zinc-900 py-4 border-r border-zinc-850 flex flex-col h-full"
        defaultSize={{ width: 270, height: '100%' }}
        minWidth={250}
        maxWidth={340}
        enable={{ right: true }}
        handleClasses={{ right: 'w-1 bg-zinc-850 hover:bg-zinc-700 transition-colors' }}
      >
        {/* Search button */}
        <div className='mb-3 px-4'>
          <button
            onClick={toggleCommandPallete}
            className='bg-zinc-800 rounded-lg w-full py-2 text-zinc-300 hover:text-white 
            cursor-pointer focus:outline-none flex items-center justify-center transition-colors duration-200'
          >
            <CiSearch size={19} className='mr-2 text-zinc-300' />
            <span>Search (Alt + P)</span>
          </button>
        </div>

        {/* Action buttons row */}
        <div className='bg-zinc-900 flex justify-around text-sm mb-2 pb-2 border-b border-zinc-700'>
          <button
            title="Notes Agent"
            className='p-2 text-zinc-400 hover:text-orange-600 cursor-pointer focus:outline-none'
          >
            <Bot size={20} />
          </button>
          <button
            title="Canvas"
            className='p-2 text-zinc-400 hover:text-white cursor-pointer focus:outline-none'
            onClick={() => handleCreateNote('canvas')}
          >
            <AiOutlineLayout size={20} />
          </button>
          <button
            title="Add folder"
            className='p-2 text-zinc-400 hover:text-white cursor-pointer focus:outline-none'
          >
            <AiOutlineFolderAdd size={20} />
          </button>
          <button
            title="New note"
            className='p-2 text-zinc-400 hover:text-white cursor-pointer focus:outline-none'
            onClick={() => handleCreateNote('text')}
          >
            <Plus size={20} />
          </button>
        </div>


        {/* Notes list */}
        <div className='flex-1 overflow-y-auto px-1'>
          {notes.length === 0 && !isLoading ? (
            <div className='text-center py-8 px-4'>
              <div className='text-zinc-500 text-sm mb-2'>No notes yet</div>
              <div className='text-zinc-600 text-xs'>Click + to create your first note</div>
            </div>
          ) : (
            <div className='space-y-1'>
              {notes.map((note) => (
                <div
                  key={note.id}
                  onClick={() => selectNote(note)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, note });
                  }}
                  className={`
                    group relative font-small p-1 ml-1 rounded-xs cursor-pointer transition-all duration-200
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
                              if (e.key === 'Escape') setRenamingNoteId(null);
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
                      hover:bg-zinc-700 rounded transition-all duration-200 flex-shrink-0'
                      title="Delete note"
                    >
                      <RiDeleteBin6Line size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className='flex justify-around border-t border-zinc-700 text-zinc-400 py-2 mt-2 px-3'>
          <Settings />Settings
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
          <button
            onClick={() => {
              setRenamingNoteId(contextMenu.note.id);
              setRenameValue(contextMenu.note.title);
              setContextMenu(null);
            }}
            className="block w-full text-left px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
          >
            Rename
          </button>
        </div>
      )}
    </>
  );
};
