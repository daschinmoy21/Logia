const devLog = (...args: unknown[]) => { if (import.meta.env.DEV) console.log(...args); };

import { useCallback } from 'react';
import { Tldraw, getSnapshot, loadSnapshot, setUserPreferences, type Editor } from 'tldraw';
import 'tldraw/tldraw.css';
import { useNotesStore } from '../store/notesStore';

/** New canvas notes start with text-note content, which isn't a drawing to load. */
function parseSnapshot(content: string | undefined) {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content);
    return parsed && !Array.isArray(parsed) && ('document' in parsed || 'store' in parsed) ? parsed : null;
  } catch (e) {
    console.error('Failed to parse backend content', e);
    return null;
  }
}

function Canvas() {
  const noteId = useNotesStore((s) => s.currentNote?.id);

  const handleMount = useCallback((editor: Editor) => {
    if (!noteId) return;
    devLog('Tldraw editor mounted');
    setUserPreferences({ id: 'logia-user', colorScheme: 'dark' });

    // Pending work is written by ID: by the time it runs, another note may be open.
    let saveTimeout: ReturnType<typeof setTimeout> | null = null;
    const save = () => {
      saveTimeout = null;
      const content = JSON.stringify(getSnapshot(editor.store));
      const notes = useNotesStore.getState();
      if (notes.currentNote?.id === noteId) notes.updateCurrentNoteContent(content);
      else void notes.applyExternalNote(noteId, { content }).catch((e) => console.error('Failed to save canvas', e));
    };

    // The note is the source of truth, so a canvas synced from elsewhere wins over the local cache.
    const saved = parseSnapshot(useNotesStore.getState().notes.find((note) => note.id === noteId)?.content);
    if (saved) {
      try {
        loadSnapshot(editor.store, saved);
      } catch (e) {
        console.error('Failed to load canvas', e);
      }
    } else if (editor.getCurrentPageShapeIds().size > 0) {
      // Earlier builds kept drawings only in the webview's cache. Move them into the note.
      save();
    }

    const unsubscribe = editor.store.listen(
      () => {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(save, 300);
      },
      { source: 'user', scope: 'document' }
    );

    return () => {
      unsubscribe();
      if (saveTimeout) {
        clearTimeout(saveTimeout);
        save();
      }
    };
  }, [noteId]);

  if (!noteId) return null;

  return (
    <div style={{ height: "100%" }}>
      <Tldraw
        persistenceKey={`note-${noteId}`}
        onMount={handleMount}
      />
    </div>
  );
}

export default Canvas;
