import type { Note, Folder } from '../types/Note';

/** Merge a newly created note into the list and open it as current. */
export function openCreatedNote(
  notes: Note[],
  newNote: Note,
): { notes: Note[]; currentNote: Note; saveTimeout: null } {
  return {
    notes: [newNote, ...notes.filter((n) => n.id !== newNote.id)],
    currentNote: newNote,
    saveTimeout: null,
  };
}

type BlockContent =
  | string
  | Array<{ type?: string; text?: string; content?: BlockContent }>
  | null
  | undefined;

type BlockLike = {
  content?: BlockContent;
  children?: BlockLike[];
};

function textFromContent(content: BlockContent): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        if (typeof item.text === 'string') return item.text;
        if (item.content != null) return textFromContent(item.content);
      }
      return '';
    })
    .join('');
}

function textFromBlocks(blocks: BlockLike[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    const own = textFromContent(block.content);
    if (own) parts.push(own);
    if (Array.isArray(block.children) && block.children.length > 0) {
      const child = textFromBlocks(block.children);
      if (child) parts.push(child);
    }
  }
  return parts.join(' ');
}

/**
 * Count words in note content. BlockNote stores JSON block trees; fall back to plain text.
 */
export function countWordsInNoteContent(content: string | null | undefined): number {
  if (!content || !content.trim()) return 0;

  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      const text = textFromBlocks(parsed as BlockLike[]);
      return text.split(/\s+/).filter((w) => w.length > 0).length;
    }
  } catch {
    // plain text / non-JSON
  }

  return content.split(/\s+/).filter((w) => w.length > 0).length;
}

/** Recent notes for empty command palette (newest first). */
export function recentNotes(notes: Note[], limit = 10): Note[] {
  return [...notes]
    .sort((a, b) => {
      const tb = Date.parse(b.updated_at || '') || 0;
      const ta = Date.parse(a.updated_at || '') || 0;
      return tb - ta;
    })
    .slice(0, limit);
}

/**
 * Results to show in the command palette: Fuse matches when querying,
 * otherwise the most recently updated notes.
 */
export function commandPaletteResults(
  query: string,
  notes: Note[],
  fuseMatches: Note[],
  recentLimit = 10,
): Note[] {
  if (query.trim()) return fuseMatches;
  return recentNotes(notes, recentLimit);
}

/** Safe circular index for arrow-key selection (no-op on empty lists). */
export function cycleIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (current + delta + length) % length;
}

/** Footer save indicator label from pending-autosave state. */
export function footerSaveLabel(isSaved: boolean): string {
  return isSaved ? 'Saved' : 'Saving…';
}

type TreeNote = Pick<Note, 'id' | 'title' | 'folder_id'>;

export type TreeItem<N extends TreeNote = Note> =
  | { kind: 'folder'; id: string; parentId: string | null; depth: number; folder: Folder }
  | { kind: 'note'; id: string; parentId: string | null; depth: number; note: N };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Visible tree rows in display order: within each level, folders then notes,
 * each sorted by name the way an IDE's explorer does. A folder's contents are
 * included only when it's expanded. Items whose parent is missing show at the
 * root rather than disappear.
 */
export function flattenVisibleTree<N extends TreeNote>(
  folders: Folder[],
  notes: N[],
  expanded: Set<string>,
): TreeItem<N>[] {
  const folderIds = new Set(folders.map((folder) => folder.id));
  const foldersIn = new Map<string | null, Folder[]>();
  const notesIn = new Map<string | null, N[]>();
  const add = <T,>(groups: Map<string | null, T[]>, key: string | null, item: T) => {
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  };
  for (const folder of folders) add(foldersIn, folder.parent_id && folderIds.has(folder.parent_id) ? folder.parent_id : null, folder);
  for (const note of notes) add(notesIn, note.folder_id && folderIds.has(note.folder_id) ? note.folder_id : null, note);
  for (const group of foldersIn.values()) group.sort((a, b) => collator.compare(a.name, b.name));
  for (const group of notesIn.values()) group.sort((a, b) => collator.compare(a.title || 'Untitled', b.title || 'Untitled'));

  const out: TreeItem<N>[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of foldersIn.get(parentId) ?? []) {
      out.push({ kind: 'folder', id: folder.id, parentId, depth, folder });
      if (expanded.has(folder.id)) walk(folder.id, depth + 1);
    }
    for (const note of notesIn.get(parentId) ?? []) {
      out.push({ kind: 'note', id: note.id, parentId, depth, note });
    }
  };
  walk(null, 0);
  return out;
}
