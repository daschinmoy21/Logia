import toast from 'react-hot-toast';
import useUiStore from '../../store/UiStore';
import { useNotesStore } from '../../store/notesStore';
import { chooseMarkdownFiles } from '../../lib/markdown-import';
import { getNoteHeadings } from '../../lib/workspace';
import { prefersReducedMotion } from '../../lib/utils';
import type { Folder, Note } from '../../types/Note';
import { useWorkspaceStore } from './workspaceStore';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The live editor, but only once it belongs to this note (the editor remounts per note). */
function editorForNote(noteId: string) {
  const editor = useUiStore.getState().editor;
  const dom = editor?.domElement as HTMLElement | undefined;
  if (!dom?.isConnected) return null;
  return dom.closest(`[data-note-editor="${CSS.escape(noteId)}"]`) ? editor : null;
}

function whenNoteEditorReady(noteId: string, fn: (editor: any) => void, timeoutMs = 2000) {
  const started = performance.now();
  const tick = () => {
    const editor = editorForNote(noteId);
    if (editor) fn(editor);
    else if (performance.now() - started < timeoutMs) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Put the caret on a block, bring it into view, and briefly mark where the reader landed. */
export function revealBlock(editor: any, blockId: string) {
  const reduceMotion = prefersReducedMotion();
  try {
    editor.setTextCursorPosition(blockId, 'start');
    editor.focus();
  } catch (error) {
    // The block was removed since the outline last updated.
    console.warn('Could not move to block', blockId, error);
    return;
  }
  const dom = (editor.domElement as HTMLElement).querySelector<HTMLElement>(`[data-id="${CSS.escape(blockId)}"]`);
  if (!dom) return;
  dom.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  // Web Animations leave the DOM attributes alone, so ProseMirror doesn't re-parse the node.
  if (!reduceMotion) {
    dom.animate(
      [{ backgroundColor: 'rgb(59 130 246 / 0.22)' }, { backgroundColor: 'rgb(59 130 246 / 0)' }],
      { duration: 1100, easing: 'ease-out' },
    );
  }
}

/** Open a note and move focus into it, optionally landing on a heading (by text). */
export async function openNote(note: Note, heading?: string) {
  const store = useNotesStore.getState();
  try {
    await store.selectNote(note);
  } catch (error) {
    toast.error(`Couldn't save the current note, so it stayed open: ${errorText(error)}`);
    return;
  }
  if (note.note_type === 'canvas') return;

  const latest = useNotesStore.getState().currentNote ?? note;
  const wanted = heading?.trim().toLowerCase();
  const target = wanted ? getNoteHeadings(latest.content).find((h) => h.text.trim().toLowerCase() === wanted) : undefined;
  if (wanted && !target) toast(`Heading “${heading}” isn't in this note`);

  whenNoteEditorReady(note.id, (editor) => {
    if (target) revealBlock(editor, target.id);
    else editor.focus();
  });
}

function focusNewNote(note: Note) {
  if (note.note_type === 'canvas') return;
  whenNoteEditorReady(note.id, (editor) => {
    const first = editor.document[0];
    if (first) editor.setTextCursorPosition(first, 'end');
    editor.focus();
  });
}

async function createAndFocus(type: 'text' | 'canvas', folderId?: string, title?: string) {
  try {
    const note = await useNotesStore.getState().createNote(type, folderId, title ? { title } : undefined);
    focusNewNote(note);
    return note;
  } catch (error) {
    toast.error(`Couldn't create the ${type === 'canvas' ? 'canvas' : 'note'}: ${errorText(error)}`);
    return null;
  }
}

export const createTextNote = (title?: string) => createAndFocus('text', undefined, title);
export const createCanvas = () => createAndFocus('canvas');

export async function openToday() {
  try {
    const note = await useNotesStore.getState().openDailyNote();
    whenNoteEditorReady(note.id, (editor) => editor.focus());
  } catch (error) {
    toast.error(`Couldn't open today's note: ${errorText(error)}`);
  }
}

export async function importMarkdown() {
  try {
    await chooseMarkdownFiles();
  } catch (error) {
    toast.error(`Import failed: ${errorText(error)}`);
  }
}

export async function goHome() {
  try {
    await useNotesStore.getState().selectNote(null);
  } catch (error) {
    toast.error(`Couldn't save the current note: ${errorText(error)}`);
  }
}

export async function toggleStar(note: Note) {
  try {
    await useNotesStore.getState().toggleStar(note.id);
  } catch (error) {
    toast.error(`Couldn't update the star: ${errorText(error)}`);
  }
}

export function openPalette(mode: 'notes' | 'commands', query?: string) {
  const ui = useUiStore.getState();
  const value = query ?? (mode === 'commands' ? '>' : '');
  ui.openCommandPalette();
  ui.setSearchQuery(value, value.startsWith('>') ? [] : useNotesStore.getState().notes);
}

/** Create the note an unresolved link points at, including folders named by its path. */
export async function createNoteFromLink(target: string) {
  const segments = target.replace(/\\/g, '/').replace(/\.md$/i, '').split('/').map((s) => s.trim()).filter(Boolean);
  const title = segments.pop();
  if (!title) return;
  try {
    let parentId: string | undefined;
    for (const name of segments) {
      const { folders, createFolder } = useNotesStore.getState();
      const existing = folders.find(
        (f) => (f.parent_id ?? undefined) === parentId && f.name.trim().toLowerCase() === name.toLowerCase(),
      );
      parentId = (existing ?? (await createFolder(name, parentId))).id;
    }
    await createAndFocus('text', parentId, title);
  } catch (error) {
    toast.error(`Couldn't create “${title}”: ${errorText(error)}`);
  }
}

/** "Projects / Logia" style path for a folder id; '' for the workspace root. */
export function folderPath(folderId: string | undefined, folders: Folder[], separator = '/'): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let id = folderId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = folders.find((f) => f.id === id);
    if (!folder) break;
    names.unshift(folder.name);
    id = folder.parent_id;
  }
  return names.join(separator);
}

const relative = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null;

export function relativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((then - now) / 60000);
  if (Math.abs(minutes) < 1) return 'just now';
  if (!relative) return new Date(then).toLocaleDateString();
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return relative.format(days, 'day');
  const date = new Date(then);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}

/** Open the context panel on its backlinks section and move focus there. */
export function revealBacklinks() {
  useWorkspaceStore.getState().setContextVisible(true);
  requestAnimationFrame(() => {
    const section = document.getElementById('note-context-backlinks') as HTMLDetailsElement | null;
    if (!section) return;
    section.open = true;
    section.scrollIntoView({ block: 'nearest' });
    section.querySelector('summary')?.focus();
  });
}
