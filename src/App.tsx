// import { useState } from "react";
// import reactLogo from "./assets/react.svg";
// import { invoke } from "@tauri-apps/api/core";
import Editor from "./components/Editor.tsx";
import "./App.css";
import { Sidebar } from "./components/Sidebar.tsx";
import { useEffect } from "react";
import useUiStore from "./store/UiStore.ts";
import { CommandPalette } from "./components/CommandPalette.tsx";
import Footer from "./components/Footer.tsx";
import AiSidebar from "./components/AiSidebar.tsx";
import { useNotesStore } from "./store/notesStore";

function App() {
  const { openCommandPalette, isAiSidebarOpen, setIsAiSidebarOpen } = useUiStore();
  const { currentNote, saveTimeout } = useNotesStore();

  const wordCount = currentNote ? currentNote.content.split(/\s+/).filter(word => word.length > 0).length : 0;
  const isSaved = !saveTimeout;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.altKey) && event.key === 'p') {
        event.preventDefault();
        openCommandPalette();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openCommandPalette]);

  return (
    <div className="bg-zinc-950 flex flex-col h-screen overflow-hidden">
      <CommandPalette />
      <div className="flex flex-1 overflow-hidden">
        <div className="h-full flex-shrink-0">
          <Sidebar />
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex-1 overflow-y-auto">
            <Editor />
          </div>
          {currentNote && <Footer wordCount={wordCount} isSaved={isSaved}/>}
        </div>
        <AiSidebar isOpen={isAiSidebarOpen} onClose={() => setIsAiSidebarOpen(false)} />
      </div>
    </div>
  );
}

export default App;
