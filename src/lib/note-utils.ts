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

export type TreeItem =
  | { kind: 'folder'; id: string; parentId: string | null; depth: number; folder: Folder }
  | { kind: 'note'; id: string; parentId: string | null; depth: number; note: Note };

/**
 * Visible sidebar rows in display order: root folders (recursively — child
 * folders, then notes, only when expanded), then root notes. Matches the
 * order AnimatedFileTree renders.
 */
export function flattenVisibleTree(
  folders: Folder[],
  notes: Note[],
  expanded: Set<string>,
): TreeItem[] {
  const out: TreeItem[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of folders.filter((f) => (f.parent_id ?? null) === parentId)) {
      out.push({ kind: 'folder', id: folder.id, parentId, depth, folder });
      if (expanded.has(folder.id)) {
        walk(folder.id, depth + 1);
        for (const note of notes.filter((n) => n.folder_id === folder.id)) {
          out.push({ kind: 'note', id: note.id, parentId: folder.id, depth: depth + 1, note });
        }
      }
    }
  };
  walk(null, 0);
  for (const note of notes.filter((n) => n.folder_id == null)) {
    out.push({ kind: 'note', id: note.id, parentId: null, depth: 0, note });
  }
  return out;
}
