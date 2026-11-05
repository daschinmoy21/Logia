import { Suspense, lazy } from 'react';
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { useNotesStore } from "../store/notesStore";
import { NoteEditor } from "./NoteEditor";
import { EditorProvider } from "./EditorProvider";
import { WorkspaceHome } from "./workspace/WorkspaceHome";
import './styles.css';
import { useEditorAiModel } from '../hooks/useEditorAiModel';

// Lazy load Canvas to prevent huge bundle load on startup
const Canvas = lazy(() => import("./Canvas"));

function Editor() {
  const {
    currentNote,
    updateCurrentNoteContent,
    updateCurrentNoteTitle,
  } = useNotesStore();
  const { model: aiModel, signature: aiSignature } = useEditorAiModel();

  // Show the workspace home when no note is selected
  if (!currentNote) {
    return <WorkspaceHome />;
  }

  // Conditional rendering based on note_type
  if (currentNote.note_type === 'canvas') {
    return (
      <div className="h-full w-full">
        <Suspense fallback={
          <div className="h-full w-full flex items-center justify-center bg-zinc-950">
            <div className="size-5 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300"></div>
          </div>
        }>
          <Canvas key={currentNote.id} />
        </Suspense>
      </div>
    );
  }

  // Key based on AI model + note ID ensures the editor remounts when:
  // 1. The user switches notes
  // 2. The AI provider/model changes (the AI extension is set at creation)
  const editorKey = `${currentNote.id}-${aiSignature}`;

  return (
    <EditorProvider
      key={editorKey}
      currentNote={currentNote}
      aiModel={aiModel}
      updateCurrentNoteContent={updateCurrentNoteContent}
      updateCurrentNoteTitle={updateCurrentNoteTitle}
    >
      <NoteEditor />
    </EditorProvider>
  );
}

export default Editor;