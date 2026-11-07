import Editor from "./components/Editor.tsx";
import "./App.css";
import { Sidebar } from "./components/Sidebar.tsx";
import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Tooltip } from "radix-ui";
import useUiStore from "./store/UiStore.ts";
import { CommandPalette } from "./components/CommandPalette.tsx";
import AiSidebar from "./components/AiSidebar.tsx";
import KanbanBoardContainer from "./components/KanbanBoard.tsx";
import { Settings } from "./components/Settings.tsx";
import { VimController } from "./components/vim/VimController.tsx";

import { useNotesStore } from "./store/notesStore";
import { useSettingsStore } from "./store/settingsStore";
import { useVimStore } from "./store/vimStore";
import { Toaster } from "react-hot-toast";
import PreflightModal from "./components/PrereflightModal.tsx";
import { UpdatePrompt } from "./components/UpdatePrompt.tsx";
import { prefersReducedMotion } from "./lib/utils";
import { closeTabs, createFolderIn, createTextNote, cycleTab, openPalette, openToday } from "./components/workspace/actions";
import { useWorkspaceStore } from "./components/workspace/workspaceStore";
import { hasMod, isBlockingModalOpen } from "./components/workspace/shortcuts";
import { TabBar } from "./components/workspace/TabBar";
import { StatusBar } from "./components/workspace/StatusBar";
import { WorkspaceMenus } from "./components/workspace/WorkspaceMenus";

import { usePaneNavigation } from "./hooks/usePaneNavigation";
import { useUiScale } from "./hooks/useUiScale";
import { useEdgeReveal } from "./hooks/useEdgeReveal";

import { AnimatePresence, motion } from "framer-motion";

/** Under this width there's no room to pin the sidebar, and no hover to reveal it. */
const NARROW_QUERY = "(max-width: 767px)";

/** The panel stays while it's being used: typing in it, or with one of its menus open. */
const aiPanelIdle = () => {
  const panel = document.querySelector('[data-workspace-pane="ai"]');
  return !panel?.contains(document.activeElement) && !document.querySelector('[role="menu"]');
};

function App() {
  useUiScale();
  const isAiSidebarOpen = useUiStore((s) => s.isAiSidebarOpen);
  const setIsAiSidebarOpen = useUiStore((s) => s.setIsAiSidebarOpen);
  const isKanbanOpen = useUiStore((s) => s.isKanbanOpen);
  const setIsKanbanOpen = useUiStore((s) => s.setIsKanbanOpen);
  const sidebarFloatingSetting = useSettingsStore((s) => s.sidebarFloating);
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  const isSidebarFloating = sidebarFloatingSetting || isNarrow;
  const explorerActive = useVimStore((s) => s.mode === "explorer");
  // Keep the auto-hide sidebar open while something inside it needs it.
  const sidebarBusy = useUiStore(
    (s) =>
      !!s.contextMenu ||
      !!s.renamingNoteId ||
      !!s.deleteConfirmId ||
      !!s.deleteConfirmFolderId ||
      !!s.folderRenameRequest,
  );
  const currentNoteId = useNotesStore((s) => s.currentNote?.id);
  const workspaceReady = useWorkspaceStore((s) => s.ready);

  const sidebarReveal = useEdgeReveal();
  const { open: hoverOpen, setOpen: setHoverOpen, clearTimers } = sidebarReveal;
  const aiReveal = useEdgeReveal(aiPanelIdle);
  const [treeFocused, setTreeFocused] = useState(false);
  usePaneNavigation(() => setHoverOpen(true), () => setHoverOpen(false));
  const reduceMotion = prefersReducedMotion();

  const showFloatingSidebar = isSidebarFloating && (hoverOpen || explorerActive || sidebarBusy || treeFocused);

  // Reset hover state when pinning the sidebar again
  useEffect(() => {
    if (!isSidebarFloating) {
      setHoverOpen(false);
      clearTimers();
    }
  }, [isSidebarFloating, clearTimers, setHoverOpen]);

  // Pinning replaces the hover panel; there's nothing left to hide.
  useEffect(() => {
    if (isAiSidebarOpen) {
      aiReveal.setOpen(false);
      aiReveal.clearTimers();
    }
  }, [isAiSidebarOpen, aiReveal.setOpen, aiReveal.clearTimers]);

  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = () => setIsNarrow(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // On narrow screens the sidebar covers the note, so opening one dismisses it.
  useEffect(() => {
    if (isNarrow) {
      setHoverOpen(false);
      setTreeFocused(false);
      if (useVimStore.getState().mode === 'explorer') useVimStore.getState().setMode('normal');
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest('[data-workspace-pane="tree"]')) {
        active.blur();
        useUiStore.getState().editor?.focus();
      }
    }
  }, [isNarrow, currentNoteId, setHoverOpen]);

  // Load here, not in the sidebar: an auto-hidden sidebar isn't mounted, and the
  // home view needs to know what exists.
  useEffect(() => {
    const { loadNotes, loadFolders } = useNotesStore.getState();
    Promise.all([loadNotes(), loadFolders()]).finally(() => useWorkspaceStore.getState().setReady(true));
  }, []);

  useEffect(() => {
    if (isTauri()) {
      const settings = useSettingsStore.getState();
      settings.refreshKeyStatus();
      settings.refreshCliStatus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      // Respect shortcuts already handled by the editor or canvas.
      if (event.defaultPrevented || event.isComposing) return;
      // Every shortcut below needs a modifier; plain typing skips the modal lookup.
      if (!event.ctrlKey && !event.metaKey && !event.altKey) return;
      // The palette handles its own keys; other modals keep theirs to themselves.
      if (useUiStore.getState().isCommandPaletteOpen || isBlockingModalOpen()) return;
      const key = event.key.toLowerCase();

      const plainMod = hasMod(event) && !event.shiftKey && !event.altKey;
      let action: (() => void) | null = null;
      if (plainMod && key === "p") action = () => openPalette("notes");
      else if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === "KeyP") action = () => openPalette("notes");
      else if (hasMod(event) && event.shiftKey && !event.altKey && key === "p") action = () => openPalette("commands");
      else if (plainMod && key === "n") action = () => createTextNote();
      else if (hasMod(event) && event.shiftKey && !event.altKey && key === "n") action = () => void createFolderIn(useWorkspaceStore.getState().treeFolderId ?? undefined);
      else if (hasMod(event) && event.shiftKey && !event.altKey && key === "d") action = openToday;
      else if (event.ctrlKey && !event.altKey && event.key === "Tab") action = () => cycleTab(event.shiftKey ? -1 : 1);
      else if (plainMod && key === "w") {
        action = () => {
          const id = useNotesStore.getState().currentNote?.id;
          if (id) void closeTabs([id]);
        };
      } else if (plainMod && key === ".") {
        action = () => {
          // Only a text note has a context panel to toggle.
          const note = useNotesStore.getState().currentNote;
          if (note && note.note_type !== "canvas") useWorkspaceStore.getState().toggleContextPanel();
        };
      }
      if (action) {
        event.preventDefault();
        if (!event.repeat) action();
        return;
      }

      // Mod+\ toggles between a pinned and an auto-hiding sidebar
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        const s = useSettingsStore.getState();
        s.setSidebarFloating(!s.sidebarFloating);
      }
      // Mod+Shift+L toggles the AI panel
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === "l") {
        event.preventDefault();
        const ui = useUiStore.getState();
        ui.setIsAiSidebarOpen(!ui.isAiSidebarOpen);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!workspaceReady || !isTauri()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void import('./lib/cli/bridge').then(module => module.startDesktopCliBridge()).then(cleanup => {
      if (disposed) cleanup(); else stop = cleanup;
    }).catch(error => console.error('CLI bridge could not start:', error));
    return () => { disposed = true; stop?.(); };
  }, [workspaceReady]);

  return (
    <Tooltip.Provider delayDuration={400} skipDelayDuration={250}>
      <div className="flex h-full flex-col overflow-hidden bg-zinc-950">
        <PreflightModal />
        <Settings />
        <UpdatePrompt />
        <CommandPalette />
        <VimController />
        <WorkspaceMenus />
        {/* Mounted here so it outlives an auto-hiding sidebar. */}
        <KanbanBoardContainer isOpen={isKanbanOpen} onClose={() => setIsKanbanOpen(false)} />

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {!isSidebarFloating && (
            <div data-workspace-pane="tree" className="h-full flex-shrink-0 overflow-clip">
              <Sidebar />
            </div>
          )}

          {isSidebarFloating && (
            <>
              {isNarrow && showFloatingSidebar && (
                <div
                  className="absolute inset-0 z-[850] bg-black/50"
                  onClick={() => setHoverOpen(false)}
                  aria-hidden="true"
                />
              )}
              {/* Invisible hot zone on the left edge */}
              <div
                className="absolute bottom-0 left-0 top-0 z-40 w-2"
                onMouseEnter={sidebarReveal.onEdgeEnter}
                onMouseLeave={sidebarReveal.onEdgeLeave}
                onClick={() => setHoverOpen(true)}
                aria-hidden="true"
              />

              <AnimatePresence>
                {showFloatingSidebar && (
                  <motion.div
                    key="floating-sidebar"
                    data-workspace-pane="tree"
                    onFocusCapture={() => setTreeFocused(true)}
                    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTreeFocused(false); }}
                    initial={reduceMotion ? false : { x: -24, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={reduceMotion ? undefined : { x: -24, opacity: 0 }}
                    transition={{ duration: 0.1, ease: "easeOut" }}
                    className="floating-sidebar absolute bottom-1.5 left-1.5 top-1.5 z-[900] overflow-clip rounded-lg border border-zinc-800 shadow-2xl shadow-black/60"
                    onMouseEnter={sidebarReveal.keepOpen}
                    onMouseLeave={sidebarReveal.scheduleHide}
                  >
                    <Sidebar />
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            <TabBar
              onToggleSidebar={isNarrow ? () => setHoverOpen((open) => !open) : undefined}
              sidebarOpen={showFloatingSidebar}
            />
            <div className="relative flex min-h-0 flex-1 overflow-hidden">
              <div className="min-w-0 flex-1 overflow-hidden" data-workspace-pane="editor" tabIndex={-1}>
                <Editor />
              </div>
              {!isAiSidebarOpen && !isNarrow && (
                <div
                  className="absolute bottom-0 right-0 top-0 z-40 w-1"
                  // A held button means a scrollbar drag that ran into the edge.
                  onMouseEnter={(event) => { if (event.buttons === 0) aiReveal.onEdgeEnter(); }}
                  onMouseLeave={aiReveal.onEdgeLeave}
                  aria-hidden="true"
                />
              )}
              <AiSidebar
                isOpen={isAiSidebarOpen || aiReveal.open}
                peek={!isAiSidebarOpen && aiReveal.open && !isNarrow}
                onPeekEnter={aiReveal.keepOpen}
                onPeekLeave={aiReveal.scheduleHide}
                onClose={() => {
                  setIsAiSidebarOpen(false);
                  aiReveal.clearTimers();
                  aiReveal.setOpen(false);
                }}
              />
            </div>
          </div>
        </div>
        <StatusBar />
        <Toaster
          containerStyle={{
            zIndex: 99999,
            bottom: 34,
          }}
          position="bottom-center"
          reverseOrder={false}
          toastOptions={{
            duration: 3000,
            style: {
              background: "var(--color-zinc-900)",
              color: "var(--color-zinc-100)",
              border: "1px solid var(--color-zinc-800)",
              borderRadius: "8px",
              fontSize: "13px",
              padding: "6px 10px",
              boxShadow: "0 8px 24px rgb(0 0 0 / 0.5)",
            },
          }}
        />
      </div>
    </Tooltip.Provider>
  );
}

export default App;
