import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Resizable } from "re-resizable";
import {
  Plus,
  ListTodo,
  Search,
  Files,
  Sparkles,
  Trash2,
  ChevronDown,
  ExternalLink,
  SettingsIcon,
  Layout,
} from "lucide-react";
import {
  Description,
  Dialog,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import { useNotesStore } from "../store/notesStore";
import RecStatus from "./RecStatus";
import useUiStore from "../store/UiStore";
import KanbanBoardContainer from "./KanbanBoard";
import { invoke } from "@tauri-apps/api/core";
import { AnimatedFileTree } from "./AnimatedFileTree";
import toast from "react-hot-toast";
import { processTranscription } from "../lib/aiTranscription";

export const Sidebar = () => {
  // Subscribing to state changes individually
  const currentNote = useNotesStore((state) => state.currentNote);

  // Getting actions (they don't cause re-renders)
  const {
    loadNotes,
    loadFolders,
    selectNote,
    deleteNote,
    createNote,
    createFolder,
    updateNote,
    updateFolder,
    deleteFolder,
    updateCurrentNoteContent,
  } = useNotesStore.getState();

  // Subscribing to UI state changes individually
  const deleteConfirmId = useUiStore((state) => state.deleteConfirmId);
  const deleteConfirmFolderId = useUiStore(
    (state) => state.deleteConfirmFolderId,
  );
  const renamingNoteId = useUiStore((state) => state.renamingNoteId);
  const renameValue = useUiStore((state) => state.renameValue);
  const contextMenu = useUiStore((state) => state.contextMenu);
  const isKanbanOpen = useUiStore((state) => state.isKanbanOpen);
  const isRecording = useUiStore((state) => state.isRecording);
  const isProcessingRecording = useUiStore(
    (state) => state.isProcessingRecording,
  );

  // Folder renaming state
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [folderRenameValue, setFolderRenameValue] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const expandedFolders = useUiStore((state) => state.expandedFolders);

  // Getting UI actions
  const {
    openCommandPalette,
    setDeleteConfirmId,
    setDeleteConfirmFolderId,
    startRenaming,
    finishRenaming,
    setRenameValue,
    setContextMenu,
    setIsKanbanOpen,
    setIsRecording,
    setIsSettingsOpen,
    setExpandedFolders,
    setIsProcessingRecording,
  } = useUiStore.getState();

  useEffect(() => {
    loadNotes();
    loadFolders();
  }, [loadNotes, loadFolders]);

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, [setContextMenu]);

  const handleCreateNote = async (
    noteType: "text" | "canvas" = "text",
    folderId?: string,
  ) => {
    try {
      await createNote(noteType, folderId || selectedFolderId || undefined);
    } catch (error) {
      console.error("Error creating note", error);
    }
  };

  const handleCreateFolder = async (folderId?: string) => {
    try {
      await createFolder(
        "New Folder",
        folderId || selectedFolderId || undefined,
      );
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
    setFolderRenameValue("");
  };

  const selectFolder = (folderId: string) => {
    setSelectedFolderId(folderId);
  };

  return (
    <>
      <Resizable
        as="aside"
        className="bg-zinc-950 pb-2 border-r border-zinc-900 flex flex-col h-full text-zinc-400 select-none"
        defaultSize={{ width: 260, height: "100%" }}
        minWidth={240}
        maxWidth={360}
        enable={{ right: true }}
        handleClasses={{
          right:
            "w-0.5 bg-zinc-900 hover:bg-blue-500/50 transition-colors delay-150",
        }}
      >
        {/* === Scrollable Content Area === */}
        <div className="flex flex-col flex-1 overflow-hidden px-3 py-2 gap-4">
          {/* 1. Primary Navigation */}
          <div className="space-y-0.5">
            <button
              onClick={openCommandPalette}
              className="w-full border border-blue-200/40 flex items-center gap-3 px-2 py-1.5 mb-2 text-sm font-medium hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 rounded-md transition-colors group"
            >
              <Search size={16} />
              <span>Search</span>
              <kbd className="ml-auto pointer-events-none hidden h-5 select-none items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-1.5 font-mono text-[10px] text-zinc-500 opacity-0 group-hover:opacity-100 font-medium transition-opacity sm:flex">
                <span className="text-xs">⌘</span>P
              </kbd>
            </button>
            <button
              onClick={() => setIsKanbanOpen(true)}
              className="w-full flex items-center gap-3 px-2 py-1.5 text-sm font-medium hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 rounded-md transition-colors"
            >
              <ListTodo size={16} />
              <span>To-do List</span>
            </button>
            <button
              disabled={!currentNote || currentNote.note_type === "canvas"}
              onClick={async () => {
                if (!currentNote || currentNote.note_type === "canvas") return;
                if (!isRecording) {
                  try {
                    await invoke("start_recording");
                    setIsRecording(true);
                  } catch (error) {
                    // Simplified error handling for UI cleanliness
                    toast.error("Recording failed");
                  }
                }
              }}
              className={`w-full flex items-center gap-3 px-2 py-1.5 text-sm font-medium hover:bg-zinc-900 rounded-md transition-colors
                     ${isRecording ? "text-red-400 animate-pulse" : "text-zinc-400 hover:text-zinc-200"}
                     ${!currentNote || currentNote.note_type === "canvas" ? "opacity-50 cursor-not-allowed" : ""}
                    `}
            >
              <Sparkles size={16} />
              <span>AI Audio Capture</span>
              {isRecording && (
                <span className="ml-auto w-2 h-2 rounded-full bg-red-500"></span>
              )}
            </button>

            <button
              onClick={() => {
                console.log("Opening Settings via Sidebar");
                setIsSettingsOpen(true);
              }}
              className="w-full flex items-center gap-3 px-2 py-1.5 text-sm font-medium hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 rounded-md transition-colors"
            >
              <SettingsIcon size={16} />
              <span>Settings</span>
            </button>
          </div>

          <div className="flex flex-col flex-1 min-h-0 space-y-1">
            <div className="flex items-center justify-between px-2 text-xs font-semibold text-zinc-500 group cursor-pointer hover:text-zinc-400 transition-colors mb-1">
              <span className="flex items-center gap-1">
                Notes <ChevronDown size={10} />
              </span>
              <div className="flex items-center gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCreateNote("text");
                  }}
                  className="hover:bg-zinc-800 p-0.5 rounded text-zinc-500 hover:text-zinc-300"
                  title="New Note"
                >
                  <Files size={16} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCreateNote("canvas");
                  }}
                  className="hover:bg-zinc-800 p-0.5 rounded text-zinc-500 hover:text-zinc-300"
                  title="New Canvas"
                >
                  <Layout size={16} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCreateFolder();
                  }}
                  className="hover:bg-zinc-800 p-0.5 rounded text-zinc-500 hover:text-zinc-300"
                  title="New Folder"
                >
                  <Plus size={20} />
                </button>
              </div>
            </div>

            {/* File Tree Component */}
            <div
              onClick={() => setSelectedFolderId(null)}
              className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent"
            >
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
          </div>

          {/* 4. Bottom Section / Others */}
          <div className="pt-2 border-t border-zinc-900/50 space-y-1 flex-shrink-0">
            <div className="px-2 text-xs font-semibold text-zinc-600 mb-2">
              Others
            </div>
            <button className="w-full flex items-center gap-3 px-2 py-1.5 text-sm font-medium hover:bg-zinc-900 text-zinc-500 hover:text-zinc-300 rounded-md transition-colors">
              <Trash2 size={16} />
              <span>Trash</span>
            </button>
            <button className="w-full flex items-center gap-3 px-2 py-1.5 text-sm font-medium hover:bg-zinc-900 text-zinc-500 hover:text-zinc-300 rounded-md transition-colors">
              <ExternalLink size={16} />
              <span>Learn More</span>
            </button>
          </div>
        </div>

        {/* Recording Status Animation (Slide Up/Down) */}
        <AnimatePresence>
          {(isRecording || isProcessingRecording) && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="overflow-hidden border-t border-zinc-800 bg-zinc-900/30"
            >
              <RecStatus
                isRecording={isRecording}
                isProcessing={isProcessingRecording}
                onStop={async () => {
                  setIsProcessingRecording(true);
                  setIsRecording(false); // Stop the recording UI immediately

                  try {
                    // 1. Stop recording and get transcript
                    const transcriptionResult =
                      await invoke<string>("stop_recording");
                    let transcriptText = "";

                    try {
                      const parsed = JSON.parse(transcriptionResult);
                      transcriptText = parsed.text || transcriptionResult;
                    } catch {
                      transcriptText = transcriptionResult;
                    }

                    if (!transcriptText || transcriptText.trim() === "") {
                      throw new Error("No transcript generated");
                    }

                    // 2. Ensure we have a note
                    let noteToUpdate = currentNote;
                    if (!noteToUpdate) {
                      try {
                        await createNote("text");
                        // Wait a tick for store update or fetch freshly
                        noteToUpdate = useNotesStore.getState().currentNote;
                      } catch (e) {
                        console.error("Failed to create note", e);
                        toast.error("Could not create new note");
                        setIsProcessingRecording(false);
                        return;
                      }
                    }

                    if (!noteToUpdate) {
                      toast.error("No active note found.");
                      setIsProcessingRecording(false);
                      return;
                    }

                    // 3. Process with AI Utility
                    const googleApiKey = useUiStore.getState().googleApiKey;
                    const editor = useUiStore.getState().editor; // Access editor instance
                    const currentContent =
                      JSON.parse(noteToUpdate.content || "[]") || [];

                    await processTranscription({
                      transcriptionText: transcriptText,
                      googleApiKey,
                      editor,
                      updateCurrentNoteContent,
                      saveCurrentNote: useNotesStore.getState().saveCurrentNote,
                      currentContent,
                    });
                  } catch (e) {
                    console.error("Audio capture process failed", e);
                    toast.error("Recording process failed");
                  } finally {
                    setIsProcessingRecording(false);
                  }
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </Resizable>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteConfirmId !== null}
        onClose={() => setDeleteConfirmId(null)}
        className="relative z-[1000]"
      >
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-sm"
          onClick={() => setDeleteConfirmId(null)}
        />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="bg-zinc-800 border border-zinc-700 rounded-xl p-6 max-w-sm w-full">
            <DialogTitle className="text-white font-medium mb-2">
              Delete Note
            </DialogTitle>
            <Description className="text-zinc-400 text-sm mb-6">
              Irreversible action.
            </Description>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg"
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
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-sm"
          onClick={() => setDeleteConfirmFolderId(null)}
        />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="bg-zinc-800 border border-zinc-700 rounded-xl p-6 max-w-sm w-full">
            <DialogTitle className="text-white font-medium mb-2">
              Delete Folder
            </DialogTitle>
            <Description className="text-zinc-400 text-sm mb-6">
              Irreversible action.
            </Description>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirmFolderId(null)}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteFolder}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg"
              >
                Delete
              </button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>

      <AnimatePresence>
        {contextMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1, ease: "easeOut" }}
            style={{ top: contextMenu.y, left: contextMenu.x }}
            className="absolute z-50 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl py-1.5 min-w-[140px] overflow-hidden"
          >
            {contextMenu.note && (
              <>
                <button
                  onClick={() => {
                    startRenaming(
                      contextMenu!.note!.id,
                      contextMenu!.note!.title || "Untitled",
                    );
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                >
                  Rename
                </button>
                <button
                  onClick={(e) => {
                    handleDeleteNote(contextMenu!.note!.id, e);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-zinc-800 hover:text-red-300 transition-colors"
                >
                  Delete
                </button>
              </>
            )}
            {contextMenu.folder && (
              <>
                <button
                  onClick={() => {
                    handleCreateNote("text", contextMenu!.folder!.id);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                >
                  New Note
                </button>
                <button
                  onClick={() => {
                    handleCreateNote("canvas", contextMenu!.folder!.id);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                >
                  New Canvas
                </button>
                <button
                  onClick={() => {
                    handleCreateFolder(contextMenu!.folder!.id);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                >
                  New Folder
                </button>
                <div className="h-px bg-zinc-800 my-1 mx-2" />
                <button
                  onClick={() => {
                    setRenamingFolderId(contextMenu!.folder!.id);
                    setFolderRenameValue(contextMenu!.folder!.name);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                >
                  Rename
                </button>
                <button
                  onClick={(e) => {
                    handleDeleteFolder(contextMenu!.folder!.id, e);
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-zinc-800 hover:text-red-300 transition-colors"
                >
                  Delete
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <KanbanBoardContainer
        isOpen={isKanbanOpen}
        onClose={() => setIsKanbanOpen(false)}
      />
    </>
  );
};
