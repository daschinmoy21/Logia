import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Note, Folder } from '../types/Note';

const STORAGE_KEY = 'logia.browser-workspace.v1';
type BrowserWorkspace = { notes: Note[]; folders: Folder[] };

/** Native notes stay on disk. Browser development has its own, clearly labelled workspace. */
export async function notesInvoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri()) return invoke<T>(command, args);
  const raw = localStorage.getItem(STORAGE_KEY);
  const data: BrowserWorkspace = raw ? JSON.parse(raw) : { notes: [], folders: [] };
  if (!Array.isArray(data.notes) || !Array.isArray(data.folders)) throw new Error('Invalid browser workspace data');
  let result: unknown;
  const now = new Date().toISOString();
  switch (command) {
    case 'get_all_notes': return data.notes as T;
    case 'get_all_folders': return data.folders as T;
    case 'create_note': {
      const note: Note = {
        id: crypto.randomUUID(), title: String(args.title || 'Untitled'),
        content: String(args.content || '[]'), note_type: args.noteType === 'canvas' ? 'canvas' : 'text',
        folder_id: args.folderId as string | undefined, starred: false,
        created_at: now, updated_at: now,
      };
      data.notes.unshift(note);
      result = note;
      break;
    }
    case 'save_note': {
      const note = { ...args.note as Note, updated_at: now };
      const index = data.notes.findIndex((n) => n.id === note.id);
      if (index < 0) throw new Error('Note no longer exists');
      data.notes[index] = note;
      break;
    }
    case 'create_folder': {
      const folder: Folder = { id: crypto.randomUUID(), name: String(args.name), parent_id: args.parentId as string | undefined, created_at: now, updated_at: now };
      data.folders.push(folder);
      result = folder;
      break;
    }
    case 'update_folder': {
      const folder = { ...args.folder as Folder, updated_at: now };
      data.folders = data.folders.map((f) => f.id === folder.id ? folder : f);
      break;
    }
    case 'toggle_star_note': {
      const note = data.notes.find((n) => n.id === args.noteId);
      if (!note) throw new Error('Note no longer exists');
      note.starred = !note.starred;
      note.updated_at = now;
      result = note.starred;
      break;
    }
    // Trash/recovery needs native storage. Never turn a soft-delete into a hard-delete.
    default: throw new Error('This action requires the Logia desktop app.');
  }
  // localStorage failures propagate: never claim a quota-limited write was saved.
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return result as T;
}
