import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { useNotesStore } from "../store/notesStore";
import { NoteEditor } from "./NoteEditor";
import { EditorProvider } from "./EditorProvider";
import { EmptyState } from "./EmptyState";
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

  return (
    <EditorProvider
      currentNote={currentNote}
      updateCurrentNoteContent={updateCurrentNoteContent}
      updateCurrentNoteTitle={updateCurrentNoteTitle}
    >
      <NoteEditor 
        currentNote={currentNote}
        updateCurrentNoteTitle={updateCurrentNoteTitle}
      />
    </EditorProvider>
  );
}

export default Editor;