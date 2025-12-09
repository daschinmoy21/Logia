import { useEffect, useState } from 'react';
import { Resizable } from 're-resizable';
import { GoPersonFill } from 'react-icons/go';
import { IoSettingsOutline } from 'react-icons/io5';
import { AiOutlineLayout, AiOutlineFolderAdd } from 'react-icons/ai';
import { CiSearch } from 'react-icons/ci';
import { Bot, Plus, ListTodo, Clock, CheckCircle } from 'lucide-react';
import { Description, Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { useNotesStore } from '../store/notesStore';
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
import { Settings } from './Settings';
import toast from 'react-hot-toast';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';

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
  const { loadNotes, loadFolders, selectNote, deleteNote, createNote, createFolder, updateNote, updateFolder, deleteFolder, updateCurrentNoteContent } = useNotesStore.getState();

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
  const googleApiKey = useUiStore((state) => state.googleApiKey);
  const editor = useUiStore((state) => state.editor);

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
            className={`p-2 focus:outline-none transition-colors ${isRecording ? 'text-red-400' : 'text-zinc-400 hover:text-blue-400'} cursor-pointer`}
            onClick={async () => {
              if (!isRecording) {
                try {
                  await invoke('start_recording');
                  setIsRecording(true);
                } catch (error) {
                  console.error('Failed to start recording:', error);
                  toast.error('❌ Failed to start recording', {
                    icon: '❌',
                    style: {
                      background: '#7f1d1d',
                      color: '#fca5a5',
                      border: '1px solid #dc2626',
                    },
                  });
                }
              }
            }}
          >
            <Bot size={20} />
          </button>
          <button
            title="New Canvas"
            className='p-2 text-zinc-400 hover:text-blue-400 cursor-pointer focus:outline-none transition-colors active:scale-95'
            onClick={() => {
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
          <RecStatus isRecording={isRecording} onStop={async () => {
            let noteToUpdate = currentNote;

            // Create a new note if none exists
            if (!currentNote) {
              try {
                await createNote('text');
                noteToUpdate = useNotesStore.getState().currentNote;
              } catch (error) {
                console.error('Failed to create note:', error);
                toast.error('❌ Failed to create new note', {
                  icon: '❌',
                  style: {
                    background: '#7f1d1d',
                    color: '#fca5a5',
                    border: '1px solid #dc2626',
                  },
                });
                return;
              }
            }

            const loadingToast = toast.loading('🎙️ Transcribing audio...', {
              style: {
                background: '#1f2937',
                color: '#fbbf24',
                border: '1px solid #374151',
              },
            });

            try {
              const audioPath = await invoke<string>('stop_recording');
              setIsRecording(false);

              const transcriptionResult = await invoke<string>('transcribe_audio', { audioPath });
              console.log('Transcription result:', transcriptionResult);
              const result = JSON.parse(transcriptionResult);

              if (result.error) {
                throw new Error(result.error);
              }

              if (noteToUpdate && result.text) {
                // Parse current content, default to empty array if invalid
                let currentContent = [];
                if (noteToUpdate.content && noteToUpdate.content.trim()) {
                  try {
                    currentContent = JSON.parse(noteToUpdate.content);
                    if (!Array.isArray(currentContent)) {
                      currentContent = [];
                    }
                  } catch {
                    currentContent = [];
                  }
                }

                // Refresh API key from backend at time of processing (avoids race where store wasn't populated yet in packaged builds)
                let apiKey = googleApiKey;
                try {
                  const runtimeKey = await invoke<string>('get_google_api_key');
                  if (runtimeKey) apiKey = runtimeKey;
                } catch (e) {
                  console.warn('Could not fetch API key at runtime', e);
                }

                if (apiKey) {
                  // Update toast to processing with AI
                  toast.loading('🤖 Processing transcription with AI...', {
                    id: loadingToast,
                    style: {
                      background: '#1f2937',
                      color: '#60a5fa',
                      border: '1px solid #374151',
                    },
                  });

                  try {
                    // Calculate dynamic timeout based on transcript length
                    // Base 30s + 10ms per character (approx 1s per 100 chars)
                    // e.g., 5000 chars (~1000 words) -> 30s + 50s = 80s
                    const timeoutDuration = Math.max(30000, 30000 + (result.text.length * 10));
                    console.log(`Setting AI timeout to ${timeoutDuration}ms for ${result.text.length} chars`);

                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);

                    const client = createGoogleGenerativeAI({ apiKey });
                    const { text: structuredJson } = await generateText({
                      model: client('gemini-2.5-flash'),
                      system: `You are an expert note-taker. Transform the raw transcription into a highly structured, educational note using BlockNote JSON blocks.

Your goal is to organize the information for effective learning, using the most appropriate block types.

Output MUST be a valid JSON array of blocks. Do not wrap in markdown.

Each block must have: "id" (unique string), "type", "props" (object), "content", "children" (array, usually []).

AVAILABLE BLOCK STRUCTURES:

1. PARAGRAPHS & QUOTES:
   - {"id": "unique-id-1", "type": "paragraph", "props": {"textColor": "default", "backgroundColor": "default", "textAlignment": "left"}, "content": "Simple text", "children": []}
   - {"id": "unique-id-2", "type": "paragraph", "props": {"textColor": "default", "backgroundColor": "default", "textAlignment": "left"}, "content": [{"type":"text", "text":"Bold Text", "styles":{"bold":true}}, {"type":"text", "text":" normal text", "styles":{}}], "children": []}
   - {"id": "unique-id-3", "type": "quote", "props": {}, "content": "Key takeaway or important definition", "children": []}

2. HEADINGS (Use hierarchy):
   - {"id": "unique-id-4", "type": "heading", "props": {"level": 1, "textColor": "default", "backgroundColor": "default", "textAlignment": "left"}, "content": "Main Title", "children": []}
   - {"id": "unique-id-5", "type": "heading", "props": {"level": 2, "textColor": "default", "backgroundColor": "default", "textAlignment": "left"}, "content": "Section Title", "children": []}
   - {"id": "unique-id-6", "type": "heading", "props": {"level": 3, "textColor": "default", "backgroundColor": "default", "textAlignment": "left"}, "content": "Subsection", "children": []}
   - {"id": "unique-id-7", "type": "heading", "props": {"level": 2, "isToggleable": true, "textColor": "default", "backgroundColor": "default", "textAlignment": "left"}, "content": "Toggleable Section", "children": []}

3. LISTS (Use for steps, features, pros/cons):
   - {"id": "unique-id-8", "type": "bulletListItem", "props": {}, "content": "Point", "children": []}
   - {"id": "unique-id-9", "type": "numberedListItem", "props": {}, "content": "Step 1", "children": []}
   - {"id": "unique-id-10", "type": "checkListItem", "props": {}, "content": "Task", "children": []}
   - {"id": "unique-id-11", "type": "toggleListItem", "props": {}, "content": "Click to reveal detail", "children": []}

4. CODE (For technical terms/snippets):
   - {"id": "unique-id-12", "type": "codeBlock", "props": {"language": "javascript", "textColor": "default", "backgroundColor": "default", "textAlignment": "left"}, "content": "console.log('code');", "children": []}

5. TABLES (Use for comparisons/data):
   - {"id": "unique-id-13", "type": "table", "props": {"textColor": "default", "backgroundColor": "default", "textAlignment": "left"}, "content": {"type": "tableContent", "rows": [{"cells": ["Col1", "Col2"]}, {"cells": ["Val1", "Val2"]}]}, "children": []}

RULES:
- Generate unique IDs for each block (e.g., using random strings or sequential numbers).
- Organize content logically with headings.
- Use TABLES for comparisons (e.g., "Option A vs Option B").
- Use CODE BLOCKS for any programming code or command line output.
- Use BOLD text for key terms (using the content array format).
- Do NOT use generic "list" type. Use specific list item types.
- Ensure valid JSON syntax with all required fields.`,
                      prompt: result.text,
                      abortSignal: controller.signal,
                    });
                    clearTimeout(timeoutId);

                    // Clean up markdown code blocks if present
                    const cleanedJson = structuredJson.replace(/```json/g, '').replace(/```/g, '').trim();
                    console.log('AI structured response:', cleanedJson);
                    const newBlocks = JSON.parse(cleanedJson);
                    if (!Array.isArray(newBlocks)) throw new Error("AI output is not an array");

                    // Insert blocks at cursor position
                    if (editor) {
                      const cursorPosition = editor.getTextCursorPosition();
                      const blockId = cursorPosition.block;
                      editor.insertBlocks(newBlocks, blockId, 'after');

                      // Force sync to store to ensure persistence even if user switches notes immediately
                      const updatedContent = JSON.stringify(editor.document);
                      updateCurrentNoteContent(updatedContent);
                      // Explicitly save to backend to be safe
                      useNotesStore.getState().saveCurrentNote();
                    } else {
                      // Fallback: append to content
                      const updatedContent = [...currentContent, ...newBlocks];
                      updateCurrentNoteContent(JSON.stringify(updatedContent));
                    }

                    toast.success('✅ Transcription structured by AI', {
                      id: loadingToast,
                      icon: '🎉',
                      style: {
                        background: '#065f46',
                        color: '#10b981',
                        border: '1px solid #047857',
                      },
                    });
                    toast('Done! 🎊', {
                      icon: '🎊',
                      style: {
                        background: '#7c3aed',
                        color: '#c4b5fd',
                        border: '1px solid #6d28d9',
                      },
                    });
                  } catch (error: any) {
                    console.error('AI structuring failed:', error);
                    let errorMessage = 'AI structuring failed';
                    if (error.name === 'AbortError') {
                      errorMessage = 'AI request timed out (limit based on transcript length)';
                    } else if (error.message) {
                      errorMessage = `AI Error: ${error.message}`;
                    }

                    toast.error(`⚠️ ${errorMessage}. Falling back to raw transcript.`, {
                      id: loadingToast,
                      duration: 5000,
                      style: {
                        background: '#7f1d1d',
                        color: '#fca5a5',
                        border: '1px solid #dc2626',
                      },
                    });

                    console.log('Falling back to simple paragraph');
                    // Fallback to simple paragraph
                    const newBlock = {
                      id: Date.now().toString(),
                      type: 'paragraph',
                      props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
                      content: result.text,
                      children: []
                    };
                    if (editor) {
                      const cursorPosition = editor.getTextCursorPosition();
                      const blockId = cursorPosition.block;
                      editor.insertBlocks([newBlock], blockId, 'after');

                      // Force sync fallback as well
                      const updatedContent = JSON.stringify(editor.document);
                      updateCurrentNoteContent(updatedContent);
                      useNotesStore.getState().saveCurrentNote();
                    } else {
                      // Fallback: append to content
                      const updatedContent = [...currentContent, newBlock];
                      updateCurrentNoteContent(JSON.stringify(updatedContent));
                    }
                  }
                } else {
                  // No API key, fallback to simple paragraph
                  const newBlock = {
                    id: Date.now().toString(),
                    props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
                    content: result.text,
                    children: []
                  };
                  if (editor) {
                    const cursorPosition = editor.getTextCursorPosition();
                    const blockId = cursorPosition.block;
                    editor.insertBlocks([newBlock], blockId, 'after');
                  } else {
                    // Fallback: append to content
                    const updatedContent = [...currentContent, newBlock];
                    updateCurrentNoteContent(JSON.stringify(updatedContent));
                  }
                  toast.success('✅ Transcription complete', {
                    id: loadingToast,
                    icon: '📝',
                    style: {
                      background: '#92400e',
                      color: '#fbbf24',
                      border: '1px solid #78350f',
                    },
                  });
                  toast('Done! 📝', {
                    icon: '📝',
                    style: {
                      background: '#7c3aed',
                      color: '#c4b5fd',
                      border: '1px solid #6d28d9',
                    },
                  });
                }
              } else {
                toast.success('Transcription complete (no text)', { id: loadingToast });
              }
            } catch (error) {
              console.error('Transcription failed:', error);
              toast.error(`❌ Transcription failed: ${error}`, {
                id: loadingToast,
                icon: '❌',
                style: {
                  background: '#7f1d1d',
                  color: '#fca5a5',
                  border: '1px solid #dc2626',
                },
              });
              setIsRecording(false);
            }
          }} />
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
            selectedNoteId={currentNote?.id || null}
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
                              className="bg-zinc-950 border border-zinc-700/80 rounded px-2 py-1 text-zinc-300 w-full outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all placeholder-zinc-600"
                              autoFocus
                            />
                          ) : (
                            <p
                              className="m-0 font-medium text-sm cursor-pointer text-zinc-200"
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

      {/* Settings dialog */}
      <Settings />
    </>
  );
};
