import type { Note, Folder } from '../types/Note.ts';

export type NoteBlock = {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: NoteBlock[];
};

function inlineText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(inlineText).join('');
  if (!value || typeof value !== 'object') return '';
  const item = value as Record<string, unknown>;
  if (typeof item.text === 'string') return item.text;
  if (item.type === 'tableContent' && Array.isArray(item.rows)) {
    return item.rows.map((row) => {
      const cells = row && typeof row === 'object' && Array.isArray((row as { cells?: unknown }).cells)
        ? (row as { cells: unknown[] }).cells : [];
      return cells.map(inlineText).join(' | ');
    }).join('\n');
  }
  return inlineText(item.content);
}

const blockCache = new Map<string, NoteBlock[]>();
let cachedCharacters = 0;

/** Cached trees are shared; callers must treat them as read-only. */
export function parseNoteBlocks(content: string): NoteBlock[] | null {
  const cached = blockCache.get(content);
  if (cached) return cached;
  try {
    const value = JSON.parse(content);
    if (!Array.isArray(value)) return null;
    const blocks: NoteBlock[] = value.filter((b) => b && typeof b === 'object');
    // Do not retain giant embedded attachments just to speed up indexing.
    if (content.length <= 256_000) {
      while (blockCache.size >= 2048 || cachedCharacters + content.length > 4_000_000) {
        const oldest = blockCache.keys().next().value;
        if (oldest === undefined) break;
        blockCache.delete(oldest);
        cachedCharacters -= oldest.length;
      }
      blockCache.set(content, blocks);
      cachedCharacters += content.length;
    }
    return blocks;
  } catch {
    return null;
  }
}

function flattenBlocks(blocks: NoteBlock[]): NoteBlock[] {
  const out: NoteBlock[] = [];
  const pending = [...blocks].reverse();
  while (pending.length) {
    const block = pending.pop();
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    out.push(block);
    if (Array.isArray(block.children)) {
      for (let i = block.children.length - 1; i >= 0; i -= 1) pending.push(block.children[i]);
    }
  }
  return out;
}

/** Readable text only: never index block IDs, styling props, or base64 images. */
export function getNoteText(content: string): string {
  const blocks = parseNoteBlocks(content);
  if (!blocks) return content;
  return flattenBlocks(blocks).map((block) => inlineText(block.content)).filter(Boolean).join('\n');
}

export function notePreview(note: Note, length = 160): string {
  if (note.note_type === 'canvas') return 'A space for sketches, diagrams, and ideas.';
  const lines = getNoteText(note.content).split('\n');
  if (lines[0]?.replace(/^#+\s*/, '').trim() === note.title.trim()) lines.shift();
  const text = lines.join(' ').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, Math.max(0, length - 1))}…` : text;
}

export function getNoteHeadings(content: string): Array<{ id: string; text: string; level: number }> {
  const blocks = parseNoteBlocks(content);
  if (!blocks) return [];
  return flattenBlocks(blocks)
    .filter((block) => block.type === 'heading' && block.id)
    .map((block) => ({ id: block.id!, text: inlineText(block.content), level: Number(block.props?.level) || 1 }))
    .filter((heading) => heading.text.trim());
}

/** Exclude code from semantic links/tags, including fenced/inline Markdown code. */
function semanticText(content: string): string {
  const blocks = parseNoteBlocks(content);
  const withoutInlineCode = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(withoutInlineCode);
    if (!value || typeof value !== 'object') return value;
    const item = value as Record<string, unknown>;
    if ((item.styles as Record<string, unknown> | undefined)?.code) return ' ';
    return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, withoutInlineCode(child)]));
  };
  const text = blocks
    ? flattenBlocks(blocks).filter((b) => b.type !== 'codeBlock').map((b) => inlineText(withoutInlineCode(b.content))).join('\n')
    : content;
  return text.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1/g, '').replace(/`[^`\n]*`/g, '');
}

function frontmatterValues(content: string, key: string): string[] {
  const blocks = parseNoteBlocks(content);
  const yaml = blocks?.[0]?.type === 'heading' && blocks?.[1]?.type === 'codeBlock' && blocks[1].props?.language === 'yaml'
    ? blocks[1] : undefined;
  const source = yaml ? inlineText(yaml.content) : content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!source) return [];
  const lines = source.split('\n');
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index < 0) return [];
  let value = lines[index].slice(key.length + 1).trim();
  if (!value) {
    const items: string[] = [];
    for (const line of lines.slice(index + 1)) {
      if (!/^[ \t]+-\s/.test(line)) break;
      items.push(line.trim().replace(/^-\s*/, ''));
    }
    value = items.join(',');
  }
  return value.replace(/^\[|\]$/g, '').split(/,|\n/)
    .map((v) => v.trim().replace(/^-\s*/, '').replace(/^["']|["']$/g, '').replace(/^#/, '').trim())
    .filter(Boolean);
}

export function getNoteTags(content: string): string[] {
  const tags = Array.from(semanticText(content).matchAll(/(?:^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu), (m) => m[1]);
  return [...new Set([...frontmatterValues(content, 'tags'), ...tags].map((tag) => tag.toLowerCase()))].sort();
}

export function getWikiLinks(content: string): Array<{ target: string; alias?: string; heading?: string }> {
  const found = new Map<string, { target: string; alias?: string; heading?: string }>();
  for (const match of semanticText(content).matchAll(/(?<!!)\[\[([^\]\n]+)\]\]/g)) {
    const [destination, ...aliases] = match[1].split('|');
    const [target, ...headings] = destination.split('#');
    if (!target.trim()) continue;
    const link = { target: target.trim(), alias: aliases.join('|').trim() || undefined, heading: headings.join('#').trim() || undefined };
    found.set(destination.trim().toLowerCase(), link);
  }
  return [...found.values()];
}

const normalized = (value: string) => value.normalize('NFC').replace(/\\/g, '/').replace(/\.md$/i, '').trim().toLowerCase();

export function notePath(note: Note, folders: Folder[] = []): string {
  const path = [note.title];
  const seen = new Set<string>();
  let id = note.folder_id;
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = folders.find((f) => f.id === id);
    if (!folder) break;
    path.unshift(folder.name);
    id = folder.parent_id;
  }
  return path.join('/');
}

const noFolders: Folder[] = [];
const linkIndexes = new WeakMap<Note[], { folders: Folder[]; byKey: Map<string, Note[]> }>();

/** Build once per immutable workspace snapshot, instead of parsing a vault per link. */
export function findWikiLinkCandidates(target: string, notes: Note[], folders: Folder[] = noFolders): Note[] {
  let index = linkIndexes.get(notes);
  if (!index || index.folders !== folders) {
    const byKey = new Map<string, Note[]>();
    for (const note of notes) {
      if (note.note_type === 'canvas') continue;
      const keys = new Set([note.id, note.title, notePath(note, folders), ...frontmatterValues(note.content, 'aliases')].map(normalized));
      for (const key of keys) byKey.set(key, [...(byKey.get(key) || []), note]);
    }
    index = { folders, byKey };
    linkIndexes.set(notes, index);
  }
  return index.byKey.get(normalized(target)) || [];
}

/** Ambiguous names stay unresolved; never silently navigate to the wrong note. */
export function resolveWikiLink(target: string, notes: Note[], folders: Folder[] = noFolders): Note | undefined {
  const matches = findWikiLinkCandidates(target, notes, folders);
  return matches.length === 1 ? matches[0] : undefined;
}

export function getBacklinks(note: Note, notes: Note[], folders: Folder[] = noFolders): Note[] {
  return notes.filter((source) => source.id !== note.id && source.note_type !== 'canvas' &&
    getWikiLinks(source.content).some((link) => resolveWikiLink(link.target, notes, folders)?.id === note.id));
}

export function searchWorkspaceNotes(query: string, notes: Note[]): Note[] {
  const tokens = query.toLowerCase().match(/"[^"]+"|\S+/g) || [];
  const terms = tokens.map((t) => t.replace(/^"|"$/g, ''));
  return notes.map((note) => {
    const title = note.title.toLowerCase();
    const text = note.note_type === 'canvas' ? '' : getNoteText(note.content).toLowerCase();
    const tags = getNoteTags(note.note_type === 'canvas' ? '' : note.content);
    const matches = terms.every((term) => {
      if (term === 'is:starred') return Boolean(note.starred);
      if (term === 'is:canvas') return note.note_type === 'canvas';
      if (term === 'is:text') return note.note_type !== 'canvas';
      if (term.startsWith('#')) return tags.some((tag) => tag === term.slice(1) || tag.startsWith(`${term.slice(1)}/`));
      return title.includes(term) || text.includes(term);
    });
    return { note, matches, score: terms.reduce((score, term) => score + (title === term ? 3 : title.includes(term) ? 1 : 0), 0) };
  }).filter((entry) => entry.matches)
    .sort((a, b) => b.score - a.score || b.note.updated_at.localeCompare(a.note.updated_at))
    .map((entry) => entry.note);
}

/** Date names use the user's local calendar, not UTC's possibly different day. */
export function dailyNoteTitle(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
