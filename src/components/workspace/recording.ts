import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import { processTranscription } from '../../lib/aiTranscription';
import { useNotesStore } from '../../store/notesStore';
import useUiStore from '../../store/UiStore';

const devLog = (...args: unknown[]) => { if (import.meta.env.DEV) console.log(...args); };

export async function startRecording() {
  try {
    await invoke('start_recording');
    useUiStore.getState().setIsRecording(true);
  } catch (error) {
    console.error('Recording start failed:', error);
    toast.error(`Recording failed: ${error}`);
  }
}

export async function stopRecording() {
  const { setIsProcessingRecording, setIsRecording } = useUiStore.getState();
  setIsProcessingRecording(true);
  setIsRecording(false); // Stop the recording UI immediately

  try {
    // 1. Stop recording and get transcript
    devLog('[Logia] Stopping recording...');
    let transcriptionResult: string;
    try {
      transcriptionResult = await invoke<string>('stop_recording');
    } catch (stopErr) {
      console.error('[Logia] stop_recording invoke failed:', stopErr);
      throw new Error(`Stop recording failed: ${stopErr}`);
    }

    let transcriptText = '';
    try {
      const parsed = JSON.parse(transcriptionResult);
      transcriptText = parsed.text || transcriptionResult;
    } catch {
      transcriptText = transcriptionResult;
    }

    if (!transcriptText || transcriptText.trim() === '') {
      throw new Error('No transcript generated - empty result');
    }

    // 2. Ensure we have a note
    const store = useNotesStore.getState();
    let noteToUpdate = store.currentNote;
    if (!noteToUpdate) {
      try {
        await store.createNote('text');
        noteToUpdate = useNotesStore.getState().currentNote;
      } catch (e) {
        console.error('Failed to create note', e);
        toast.error('Could not create new note');
        return;
      }
    }

    if (!noteToUpdate) {
      toast.error('No active note found.');
      return;
    }

    // 3. Process with AI Utility
    const editor = useUiStore.getState().editor;
    const currentContent = JSON.parse(noteToUpdate.content || '[]') || [];

    await processTranscription({
      transcriptionText: transcriptText,
      editor,
      updateCurrentNoteContent: store.updateCurrentNoteContent,
      saveCurrentNote: store.saveCurrentNote,
      currentContent,
    });
  } catch (e) {
    console.error('Audio capture process failed', e);
    const errorMsg = e instanceof Error ? e.message : String(e);
    toast.error(`Recording process failed: ${errorMsg}`);
  } finally {
    setIsProcessingRecording(false);
  }
}
