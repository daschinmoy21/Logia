// import { useState } from "react";
// import reactLogo from "./assets/react.svg";
// import { invoke } from "@tauri-apps/api/core";
import Editor from "./components/Editor.tsx";
import "./App.css";
import { Sidebar } from "./components/Sidebar.tsx";
import { useEffect } from "react";
import useUiStore from "./store/UiStore.ts";
import { CommandPalette } from "./components/CommandPalette.tsx";

function App() {
  const { openCommandPalette } = useUiStore();

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
    <div className="bg-zinc-950 flex h-screen overflow-hidden">
      <CommandPalette />
      <div className="h-full flex-shrink-0">
        <Sidebar />
      </div>
      <div className="flex-1 min-w-0 overflow-y-auto">
        <Editor />
      </div>
    </div>
  );
}

export default App;
