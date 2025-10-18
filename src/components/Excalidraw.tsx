import { useState, useEffect } from 'react';
import { Excalidraw, MainMenu, WelcomeScreen } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { useNotesStore } from '../store/notesStore';

function Canvas() {
  const { currentNote, updateCurrentNoteContent } = useNotesStore();

  const [elements, setElements] = useState<any[]>([]);
  const [appState, setAppState] = useState<any>(null);

  useEffect(() => {
    if (currentNote && currentNote.content) {
      try {
        const scene = JSON.parse(currentNote.content);
        setElements(scene.elements || []);
        setAppState({ ...scene.appState, collaborators: new Map() });
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
    elements: any,
    appState: any
  ) => {
    if (!currentNote) return;

    const appStateForSaving = { ...appState };
    delete appStateForSaving.collaborators;

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
          },
          tools: {
            image: false,
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
  );
}

export default Canvas;
