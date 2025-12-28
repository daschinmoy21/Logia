import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { useNotesStore } from "../store/notesStore";
import { NoteEditor } from "./NoteEditor";
import { EditorProvider } from "./EditorProvider";
import { EmptyState } from "./EmptyState";
import Canvas from "./Canvas"; // Import Canvas
import './styles.css';

function Editor() {
  const {
    currentNote,
    updateCurrentNoteContent,
    updateCurrentNoteTitle,
  } = useNotesStore();

  // Show empty state when no note is selected
  if (!currentNote) {
    return <EmptyState />;
  }

  // Conditional rendering based on note_type
  if (currentNote.note_type === 'canvas') {
    return <Canvas />;
  }

  return (
    <EditorProvider
      currentNote={currentNote}
      updateCurrentNoteContent={updateCurrentNoteContent}
      updateCurrentNoteTitle={updateCurrentNoteTitle}
    >
      <NoteEditor />
    </EditorProvider>
  );
}

export default Editor;