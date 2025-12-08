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
import PreflightModal from "./components/PrereflightModal";
import { useNotesStore } from "./store/notesStore";
import { Toaster } from 'react-hot-toast';

function App() {
  const { openCommandPalette, isAiSidebarOpen, setIsAiSidebarOpen, loadApiKey } = useUiStore();
  const { currentNote, saveTimeout } = useNotesStore();

  const wordCount = currentNote ? currentNote.content.split(/\s+/).filter(word => word.length > 0).length : 0;
  const isSaved = !saveTimeout;

  useEffect(() => {
    // Load API key immediately on app startup
    loadApiKey();

    const handleKeyDown = (event: KeyboardEvent) => {
      console.log('Key pressed:', event.key, 'metaKey:', event.metaKey, 'altKey:', event.altKey, 'ctrlKey:', event.ctrlKey);
      if ((event.metaKey || event.altKey) && event.key === 'p') {
        event.preventDefault();
        openCommandPalette();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openCommandPalette, loadApiKey]);

  return (
    <div className="bg-zinc-950 flex flex-col h-screen overflow-hidden">
      <CommandPalette />
      <PreflightModal />
      <div className="flex flex-1 overflow-hidden">
        <div className="h-full flex-shrink-0">
          <Sidebar />
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex-1 overflow-y-auto">
            <Editor />
          </div>
          {currentNote && currentNote.note_type !== 'canvas' && <Footer wordCount={wordCount} isSaved={isSaved}/>}
        </div>
        <AiSidebar isOpen={isAiSidebarOpen} onClose={() => setIsAiSidebarOpen(false)} />
      </div>
      <Toaster 
        position="bottom-center"
        reverseOrder={false}
        toastOptions={{
          style: {
            background: '#333',
            color: '#fff',
            borderRadius: '10px',
          },
        }}
      />
    </div>
  );
}

export default App;
