import React from 'react';
import { useState, useEffect } from 'react';
import { Excalidraw, MainMenu, WelcomeScreen } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { useNotesStore } from '../store/notesStore';
import { ExcalidrawElement } from '@excalidraw/excalidraw/types/element/types';
import { AppState } from '@excalidraw/excalidraw/types/types';

function Canvas() {
  const { currentNote, updateCurrentNoteContent } = useNotesStore();

  const [elements, setElements] = useState<readonly ExcalidrawElement[]>([]);
  const [appState, setAppState] = useState<AppState | null>(null);

  useEffect(() => {
    if (currentNote && currentNote.content) {
      try {
        const scene = JSON.parse(currentNote.content);
        setElements(scene.elements || []);
        setAppState({ ...scene.appState, collaborators: new Map() }); // Always set collaborators to a new Map
      } catch (e) {
        console.error("Error parsing excalidraw content", e);
        setElements([]);
        setAppState({ collaborators: new Map() });
      }
    } else {
      setElements([]);
      setAppState({ collaborators: new Map() });
    }
  }, [currentNote]);

  const handleExcalidrawChange = (
    elements: readonly ExcalidrawElement[],
    appState: AppState
  ) => {
    if (!currentNote) return;

    const appStateForSaving = { ...appState };
    delete appStateForSaving.collaborators; // Don't save collaborators

    const scene = {
      elements,
      appState: appStateForSaving,
    };
    const newContent = JSON.stringify(scene);

    if (newContent !== currentNote.content) {
      updateCurrentNoteContent(newContent);
    }
  };

  return (
    <div style={{ height: "100%" }}>
      <Excalidraw
        key={currentNote?.id}
        initialData={{
          elements: elements,
          appState: appState
        }}
        onChange={handleExcalidrawChange}
        UIOptions={{
          canvasActions: {
            changeViewBackgroundColor: true,
          }
        }}
      >
        <MainMenu>
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.DefaultItems.ToggleTheme />
        </MainMenu>
        <WelcomeScreen>
          <WelcomeScreen.Hints.MenuHint />
          <WelcomeScreen.Hints.ToolbarHint />
        </WelcomeScreen>
      </Excalidraw>
    </div>
  )
}

export default Canvas;
