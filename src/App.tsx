import Editor from "./components/Editor.tsx";
import Header from "./components/Header.tsx";
import "./App.css";
import { Sidebar } from "./components/Sidebar.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import useUiStore from "./store/UiStore.ts";
import { CommandPalette } from "./components/CommandPalette.tsx";
import Footer from "./components/Footer.tsx";
import AiSidebar from "./components/AiSidebar.tsx";
import { Settings } from "./components/Settings.tsx";
import { VimController } from "./components/vim/VimController.tsx";

import { useNotesStore } from "./store/notesStore";
import { useSettingsStore } from "./store/settingsStore";
import { useVimStore } from "./store/vimStore";
import { Toaster } from "react-hot-toast";
import PreflightModal from "./components/PrereflightModal.tsx";
import { countWordsInNoteContent } from "./lib/note-utils";
import { prefersReducedMotion } from "./lib/utils";

import { AnimatePresence, motion } from "framer-motion";

/** How long the pointer must rest on the left edge before the sidebar opens. */
const REVEAL_DELAY_MS = 70;
/** Grace period after the pointer leaves before the sidebar hides. */
const HIDE_DELAY_MS = 260;

function App() {
  const { openCommandPalette, isAiSidebarOpen, setIsAiSidebarOpen } = useUiStore();
  const isSidebarFloating = useSettingsStore((s) => s.sidebarFloating);
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
  const { currentNote, saveTimeout } = useNotesStore();

  const wordCount = currentNote
    ? countWordsInNoteContent(currentNote.content)
    : 0;

  const isSaved = !saveTimeout;

  const [hoverOpen, setHoverOpen] = useState(false);
  const [edgeHot, setEdgeHot] = useState(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceMotion = prefersReducedMotion();

  const showFloatingSidebar = isSidebarFloating && (hoverOpen || explorerActive || sidebarBusy);

  const clearTimers = useCallback(() => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    revealTimerRef.current = null;
    hideTimerRef.current = null;
  }, []);

  // Reset hover state when pinning the sidebar again
  useEffect(() => {
    if (!isSidebarFloating) {
      setHoverOpen(false);
      clearTimers();
    }
  }, [isSidebarFloating, clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    const settings = useSettingsStore.getState();
    settings.refreshKeyStatus();
    settings.refreshCliStatus();

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.altKey) && key === "p") {
        event.preventDefault();
        openCommandPalette();
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
  }, [openCommandPalette]);

  const onEdgeEnter = () => {
    setEdgeHot(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
    if (hoverOpen || revealTimerRef.current) return;
    revealTimerRef.current = setTimeout(() => {
      revealTimerRef.current = null;
      setHoverOpen(true);
    }, REVEAL_DELAY_MS);
  };

  const onEdgeLeave = () => {
    setEdgeHot(false);
    // Pointer only brushed the edge: cancel the pending reveal.
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    // If the panel opened under a still pointer and the pointer then flicked
    // away, the panel never saw mouseenter/leave — hide it unless it's entered.
    if (hoverOpen) scheduleHide();
  };

  const keepOpen = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
    setHoverOpen(true);
  };

  const scheduleHide = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setHoverOpen(false);
      hideTimerRef.current = null;
    }, HIDE_DELAY_MS);
  };

  const panelTransition = reduceMotion
    ? { duration: 0.01 }
    : { type: "spring" as const, stiffness: 420, damping: 38, mass: 0.8 };

  return (
    <div className="bg-zinc-950 flex flex-col h-screen overflow-hidden">
      <PreflightModal />
      <Settings />
      <CommandPalette />
      <VimController />
      <Header />

      <div className="flex flex-1 overflow-hidden relative">
        <AnimatePresence initial={false}>
          {!isSidebarFloating && (
            <motion.div
              key="pinned-sidebar"
              className="h-full flex-shrink-0 overflow-hidden"
              initial={reduceMotion ? false : { opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, x: -12 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              <Sidebar />
            </motion.div>
          )}
        </AnimatePresence>

        {isSidebarFloating && (
          <>
            {/* Invisible hot zone on the left edge, with a soft glow hint */}
            <div
              className="absolute left-0 top-0 bottom-0 w-2.5 z-40"
              onMouseEnter={onEdgeEnter}
              onMouseLeave={onEdgeLeave}
              onClick={() => setHoverOpen(true)}
              aria-hidden="true"
            >
              <div
                className={`absolute left-0 top-1/2 -translate-y-1/2 h-24 w-[3px] rounded-r-full bg-blue-400/70 shadow-[0_0_14px_2px_rgba(96,165,250,0.35)] transition-all duration-200 ${
                  edgeHot && !showFloatingSidebar ? "opacity-100 scale-y-100" : "opacity-0 scale-y-50"
                }`}
              />
            </div>

            <AnimatePresence>
              {showFloatingSidebar && (
                <motion.div
                  key="floating-sidebar"
                  initial={reduceMotion ? false : { x: "-104%", opacity: 0.6 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={reduceMotion ? undefined : { x: "-104%", opacity: 0.6 }}
                  transition={panelTransition}
                  className="floating-sidebar absolute left-1.5 top-1.5 bottom-1.5 z-[900] rounded-xl overflow-hidden border border-zinc-800/80 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.75)]"
                  onMouseEnter={keepOpen}
                  onMouseLeave={scheduleHide}
                >
                  <Sidebar />
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex-1 overflow-y-auto">
            <Editor />
          </div>
          <AnimatePresence initial={false}>
            {currentNote && currentNote.note_type !== "canvas" && (
              <motion.div
                key="editor-footer"
                initial={reduceMotion ? false : { height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="overflow-hidden flex-shrink-0"
              >
                <Footer wordCount={wordCount} isSaved={isSaved} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <AiSidebar
          isOpen={isAiSidebarOpen}
          onClose={() => setIsAiSidebarOpen(false)}
        />
      </div>
      <Toaster
        containerStyle={{
          zIndex: 99999,
        }}
        position="bottom-center"
        reverseOrder={false}
        toastOptions={{
          style: {
            background: "rgba(24, 24, 27, 0.92)",
            color: "#f4f4f5",
            border: "1px solid rgba(63, 63, 70, 0.6)",
            backdropFilter: "blur(12px)",
            borderRadius: "10px",
            fontSize: "13px",
          },
        }}
      />
    </div>
  );
}

export default App;
