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
      [{ backgroundColor: 'rgb(232 116 59 / 0.22)' }, { backgroundColor: 'rgb(232 116 59 / 0)' }],
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
    // A new note's placeholder title goes away, so the first thing typed names the note.
    const text = Array.isArray(first?.content) ? first.content.map((c: { text?: string }) => c.text ?? '').join('') : '';
    if (first && text === 'Untitled') editor.updateBlock(first, { content: [] });
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

function expandFolder(id: string) {
  const ui = useUiStore.getState();
  if (!ui.expandedFolders.has(id)) ui.setExpandedFolders(new Set([...ui.expandedFolders, id]));
}

/** New note or canvas in a folder, opened with the folder visible. */
export function createIn(type: 'text' | 'canvas', folderId?: string) {
  if (folderId) expandFolder(folderId);
  return createAndFocus(type, folderId);
}

/** New folder with its name ready to type over. */
export async function createFolderIn(parentId?: string) {
  try {
    if (parentId) expandFolder(parentId);
    const folder = await useNotesStore.getState().createFolder('New Folder', parentId);
    useUiStore.getState().setFolderRenameRequest({ id: folder.id, name: folder.name });
    return folder;
  } catch (error) {
    toast.error(`Couldn't create the folder: ${errorText(error)}`);
    return null;
  }
}

export async function moveNote(id: string, folderId: string | undefined) {
  try {
    if (folderId) expandFolder(folderId);
    await useNotesStore.getState().updateNote(id, { folder_id: folderId });
  } catch (error) {
    toast.error(`Couldn't move the note: ${errorText(error)}`);
  }
}

export async function moveFolder(id: string, parentId: string | undefined) {
  try {
    if (parentId) expandFolder(parentId);
    await useNotesStore.getState().updateFolder(id, { parent_id: parentId });
  } catch (error) {
    toast.error(`Couldn't move the folder: ${errorText(error)}`);
  }
}

export async function duplicateNote(note: Note) {
  try {
    await useNotesStore.getState().saveCurrentNote();
    const latest = useNotesStore.getState().notes.find((n) => n.id === note.id) ?? note;
    await useNotesStore.getState().createNote(latest.note_type === 'canvas' ? 'canvas' : 'text', latest.folder_id, {
      title: `${latest.title || 'Untitled'} copy`,
      content: latest.content,
    });
  } catch (error) {
    toast.error(`Couldn't duplicate the note: ${errorText(error)}`);
  }
}

export async function copyWikiLink(note: Note) {
  try {
    await navigator.clipboard.writeText(`[[${note.title || 'Untitled'}]]`);
    toast.success('Link copied');
  } catch (error) {
    toast.error(`Couldn't copy the link: ${errorText(error)}`);
  }
}

/** Open without moving focus, as a tree click does. False if the current note couldn't save. */
export async function selectNoteQuietly(note: Note) {
  try {
    await useNotesStore.getState().selectNote(note);
    return true;
  } catch (error) {
    toast.error(`Couldn't save the current note, so it stayed open: ${errorText(error)}`);
    return false;
  }
}

/** Close tabs; closing the active one moves to its neighbor, or Home when none are left. */
export async function closeTabs(ids: string[]) {
  const { tabs, removeTabs } = useWorkspaceStore.getState();
  const store = useNotesStore.getState();
  const currentId = store.currentNote?.id;
  if (currentId && ids.includes(currentId)) {
    const index = tabs.indexOf(currentId);
    const nextId = [...tabs.slice(index + 1), ...tabs.slice(0, index).reverse()].find((id) => !ids.includes(id));
    const next = nextId ? store.notes.find((note) => note.id === nextId) : undefined;
    try {
      await store.selectNote(next ?? null);
    } catch (error) {
      toast.error(`Couldn't save the current note, so it stayed open: ${errorText(error)}`);
      return;
    }
  }
  removeTabs(ids);
}

export function cycleTab(delta: number) {
  const { tabs } = useWorkspaceStore.getState();
  const store = useNotesStore.getState();
  if (!tabs.length) return;
  const index = store.currentNote ? tabs.indexOf(store.currentNote.id) : -1;
  const nextId = tabs[(index + delta + tabs.length) % tabs.length];
  const next = store.notes.find((note) => note.id === nextId);
  if (next) void openNote(next);
}

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
