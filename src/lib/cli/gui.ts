import { useNotesStore } from '../../store/notesStore.ts';
import useUiStore from '../../store/UiStore.ts';
import { dailyNoteTitle, findWikiLinkCandidates, getBacklinks, getNoteTags, getWikiLinks, notePath, parseNoteBlocks, resolveWikiLink, searchWorkspaceNotes } from '../workspace.ts';
import { noteToMarkdown } from '../note-markdown.ts';
import { CliError, noteRevision, revisionInput, type CliParams, type GuiRequest, type GuiResponse } from './protocol.ts';
import type { Note } from '../../types/Note.ts';

let queue: Promise<unknown> = Promise.resolve();
const store = useNotesStore;
function fail(code: string, message: string): never { throw new CliError(code, message); }
const text = (params: CliParams, key: string) => typeof params[key] === 'string' ? params[key] as string : undefined;
const enabled = (params: CliParams, key: string) => params[key] === true || params[key] === 'true';
const fresh = (id: string) => store.getState().notes.find(note => note.id === id) ?? fail('NOT_FOUND', 'Note no longer exists');
const expired = (request: GuiRequest) => { if (request.deadline !== undefined && Date.now() >= request.deadline) fail('TIMEOUT', 'Request expired before execution; it was not applied.'); };

function target(params: CliParams): Note {
  const { notes, folders, currentNote } = store.getState();
  const selectors = ['id', 'file', 'path'].filter(key => text(params, key) !== undefined);
  if (selectors.length > 1) fail('INVALID_REQUEST', 'Choose one of id, file, or path');
  if (text(params, 'id') !== undefined) return fresh(text(params, 'id')!);
  let candidates: Note[];
  if (text(params, 'path') !== undefined) {
    const path = cleanPath(text(params, 'path')!).replace(/\.md$/i, '');
    candidates = notes.filter(note => notePath(note, folders) === path);
  } else if (text(params, 'file') !== undefined) candidates = findWikiLinkCandidates(text(params, 'file')!, notes, folders);
  else return currentNote ? fresh(currentNote.id) : fail('NO_ACTIVE_NOTE', 'No note is open; use id, file, or path');
  if (candidates.length > 1) fail('AMBIGUOUS_TARGET', 'Multiple notes match. Use a note ID or exact path.');
  return candidates[0] ?? fail('NOT_FOUND', 'No note matches the target');
}

function cleanPath(value: string): string {
  const path = value.replace(/\\/g, '/');
  if (!path || path.startsWith('/') || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) fail('INVALID_REQUEST', 'Use a relative note path without traversal or empty segments');
  return path;
}

function summary(note: Note) {
  return { id: note.id, title: note.title, path: notePath(note, store.getState().folders) + (note.note_type === 'canvas' ? '.canvas' : '.md'), type: note.note_type ?? 'text', starred: !!note.starred, tags: note.note_type === 'canvas' ? [] : getNoteTags(note.content), updated_at: note.updated_at };
}
async function read(note: Note) {
  const dirty = !!store.getState().externalSaveErrors[note.id] || (store.getState().currentNote?.id === note.id && !!(store.getState().saveTimeout || store.getState().isSaving || store.getState().saveError));
  return { ...summary(note), revision: await noteRevision(note), content: note.content, markdown: note.note_type === 'canvas' ? null : noteToMarkdown(note.content), dirty };
}
function editorFor(note: Note) {
  const ui = useUiStore.getState();
  return store.getState().currentNote?.id === note.id && ui.editorNoteId === note.id && ui.editor?.domElement?.isConnected ? ui.editor : null;
}
let normalizationEngine: import('@blocknote/core').BlockNoteEditor | undefined;
let parserPromise: ReturnType<typeof buildParser> | undefined;
function parser() { return parserPromise ??= buildParser().catch(error => { parserPromise = undefined; throw error; }); }
async function buildParser() {
  const [{ BlockNoteEditor }, { codeBlock }] = await Promise.all([import('@blocknote/core'), import('@blocknote/code-block')]);
  const engine = BlockNoteEditor.create({ codeBlock, tables: { splitCells: true, cellBackgroundColor: true, cellTextColor: true, headers: true } });
  normalizationEngine = engine;
  return engine;
}
async function parseContent(params: CliParams, title?: string): Promise<unknown[]> {
  if (text(params, 'content') !== undefined && text(params, 'blocks') !== undefined) fail('INVALID_REQUEST', 'Choose content or blocks');
  const input = text(params, 'blocks') ?? text(params, 'content');
  if (input === undefined) fail('INVALID_REQUEST', 'Provide content, blocks, or --stdin');
  if (new TextEncoder().encode(input).length > 1024 * 1024) fail('INVALID_REQUEST', 'Content exceeds 1 MiB');
  if (text(params, 'blocks') !== undefined) {
    let blocks: unknown;
    try { blocks = JSON.parse(input); } catch { fail('INVALID_REQUEST', 'blocks must be a JSON array'); }
    if (!Array.isArray(blocks) || !blocks.every(block => block && typeof block === 'object' && typeof block.type === 'string')) fail('INVALID_REQUEST', 'blocks must contain BlockNote blocks');
    const engine = await parser();
    engine.transact(tr => { tr.setMeta('addToHistory', false); engine.replaceBlocks(engine.document, blocks as Parameters<typeof engine.replaceBlocks>[1]); });
    return [...engine.document];
  }
  const source = input.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const yaml = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  const engine = await parser();
  const blocks: import('@blocknote/core').PartialBlock[] = await engine.tryParseMarkdownToBlocks(yaml ? source.slice(yaml[0].length) : source);
  if (title && (blocks[0]?.type !== 'heading' || blocks[0]?.props?.level !== 1)) {
    blocks.unshift({ id: crypto.randomUUID(), type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: title, styles: {} }], children: [] });
  }
  if (yaml) {
    if (!title) fail('INVALID_REQUEST', 'Frontmatter is supported by create/write; append/prepend should contain body Markdown');
    blocks.splice(1, 0, { id: crypto.randomUUID(), type: 'codeBlock', props: { language: 'yaml' }, content: [{ type: 'text', text: yaml[1], styles: {} }], children: [] });
  }
  return blocks;
}

async function checkRevision(id: string, expected: string | undefined): Promise<Note> {
  if (!expected) return fresh(id);
  const note = fresh(id);
  const actual = await noteRevision(note);
  if (actual !== expected || revisionInput(fresh(id)) !== revisionInput(note)) fail('REVISION_CONFLICT', 'Note changed. Read it again before editing.');
  return fresh(id);
}

async function apply(note: Note, blocks: unknown[], title?: string) {
  const editor = editorFor(note);
  if (store.getState().currentNote?.id === note.id && !editor) fail('EDITOR_NOT_READY', 'The active editor is mounting; retry after it is ready.');
  let content: string;
  if (editor) {
    editor.transact(() => editor.replaceBlocks(editor.document, blocks));
    content = JSON.stringify(editor.document);
  } else {
    const engine = normalizationEngine ?? fail('EDITOR_NOT_READY', 'Markdown parser is not ready');
    // Match the GUI schema before saving an inactive note, and keep this hidden
    // parser's undo history from retaining copies of every agent-edited note.
    engine.transact(tr => { tr.setMeta('addToHistory', false); engine.replaceBlocks(engine.document, blocks as Parameters<typeof engine.replaceBlocks>[1]); });
    content = JSON.stringify(engine.document);
  }
  try { await store.getState().applyExternalNote(note.id, { content, title: title ?? note.title }); }
  catch (error) { fail('SAVE_FAILED', `The edit is visible but could not be saved: ${String(error)}. Use save to retry; do not append again.`); }
  return read(fresh(note.id));
}

async function create(params: CliParams) {
  const path = text(params, 'path');
  if (path && text(params, 'name')) fail('INVALID_REQUEST', 'Use name or path, not both');
  const parts = path ? cleanPath(path).split('/') : [];
  const title = (parts.pop() ?? text(params, 'name') ?? 'Untitled').replace(/\.md$/i, '').trim();
  if (!title || /[\/\\\r\n\0]/.test(title)) fail('INVALID_REQUEST', 'Invalid note name');
  const blocks = await parseContent({ ...params, ...(text(params, 'content') === undefined && text(params, 'blocks') === undefined ? { content: '' } : {}) }, title);
  let folderId = text(params, 'folderId');
  if (folderId && parts.length) fail('INVALID_REQUEST', 'Use folderId or a folder path');
  if (folderId && !store.getState().folders.some(folder => folder.id === folderId)) fail('NOT_FOUND', 'Folder not found');
  for (const name of parts) {
    const matches = store.getState().folders.filter(folder => folder.name === name && (folder.parent_id ?? undefined) === folderId);
    if (matches.length > 1) fail('AMBIGUOUS_TARGET', 'Duplicate folder path; use folderId');
    folderId = matches[0]?.id ?? (await store.getState().createFolder(name, folderId)).id;
  }
  if (store.getState().notes.some(note => note.title === title && (note.folder_id ?? undefined) === folderId)) fail('ALREADY_EXISTS', 'A note with this name exists in that folder');
  const open = enabled(params, 'open') && !enabled(params, 'silent');
  const note = await store.getState().createNote('text', folderId, { title, content: JSON.stringify(blocks), open });
  return read(note);
}

async function execute(request: GuiRequest): Promise<unknown> {
  expired(request);
  const params = request.params ?? {};
  const selectors = ['id', 'file', 'path'];
  const allowed: Record<string, string[]> = {
    status: [], active: [], files: [], list: [], folders: [], tags: [],
    search: ['query', 'limit'], read: selectors, links: selectors, backlinks: selectors, open: selectors, save: selectors,
    create: ['name', 'path', 'folderId', 'content', 'blocks', 'open', 'silent'],
    append: [...selectors, 'content', 'blocks', 'ifRevision'], prepend: [...selectors, 'content', 'blocks', 'ifRevision'], write: [...selectors, 'content', 'blocks', 'ifRevision'],
    rename: [...selectors, 'name', 'ifRevision'], daily: [], 'daily:read': [], 'daily:append': ['content', 'blocks', 'ifRevision'],
  };
  if (!allowed[request.command] || Object.keys(params).some(key => !allowed[request.command].includes(key))) fail('INVALID_REQUEST', 'Unsupported command or command parameter');
  const state = store.getState();
  if (request.command === 'status') return { connected: true, active: state.currentNote ? summary(state.currentNote) : null, noteCount: state.notes.length, saveError: state.saveError, loadError: state.loadError, commands: ['active', 'files', 'folders', 'search', 'read', 'links', 'backlinks', 'tags', 'open', 'create', 'append', 'prepend', 'write', 'rename', 'save', 'daily', 'daily:read', 'daily:append'] };
  if (state.isLoading || state.loadError || state.folderLoadError) fail('GUI_NOT_READY', state.loadError || state.folderLoadError || 'Workspace is loading');
  if (request.command === 'active') return state.currentNote ? read(state.currentNote) : null;
  if (request.command === 'files' || request.command === 'list') return state.notes.map(summary);
  if (request.command === 'folders') return state.folders;
  if (request.command === 'search') {
    const query = text(params, 'query') ?? fail('INVALID_REQUEST', 'search requires query');
    const limit = Number(text(params, 'limit') ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) fail('INVALID_REQUEST', 'limit must be 1–1000');
    return searchWorkspaceNotes(query, state.notes).slice(0, limit).map(summary);
  }
  if (request.command === 'tags') {
    const counts = new Map<string, number>();
    for (const note of state.notes.filter(note => note.note_type !== 'canvas')) for (const tag of getNoteTags(note.content)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a,b) => a.tag.localeCompare(b.tag));
  }
  if (request.command === 'create') { expired(request); return create(params); }
  let command = request.command;
  const preparedIncoming = command === 'daily:append' ? await parseContent(params) : undefined;
  let note: Note;
  if (command.startsWith('daily')) {
    const title = dailyNoteTitle();
    const matches = state.notes.filter(note => note.title === title && note.note_type !== 'canvas');
    if (matches.length > 1) fail('AMBIGUOUS_TARGET', 'Several daily notes exist; use an explicit note ID');
    note = matches[0]!;
    if (!note && command === 'daily:read') fail('NOT_FOUND', 'Today’s daily note does not exist');
    if (!note) {
      const daily = await create({ name: title, content: `# ${title}\n\n#daily\n\n## Intentions\n\n- \n\n## Notes\n`, ...(command === 'daily' ? { open: true } : {}) }) as { id: string };
      note = fresh(daily.id);
    }
    command = command === 'daily:append' ? 'append' : command === 'daily:read' ? 'read' : 'open';
  } else note = target(params);
  if (command === 'read') return read(note);
  if (command === 'links' || command === 'backlinks') {
    const backlinks = getBacklinks(note, state.notes, state.folders).map(summary);
    return command === 'backlinks' ? backlinks : { outgoing: getWikiLinks(note.content).map(link => ({ ...link, resolvedId: resolveWikiLink(link.target, state.notes, state.folders)?.id ?? null })), backlinks };
  }
  if (command === 'open') { await store.getState().selectNote(note); return read(fresh(note.id)); }
  if (command === 'save') {
    try { await store.getState().applyExternalNote(note.id, {}); } catch (error) { fail('SAVE_FAILED', String(error)); }
    return read(fresh(note.id));
  }
  if (!['append', 'prepend', 'write', 'rename'].includes(command)) fail('INVALID_REQUEST', 'Unsupported command');
  if (note.note_type === 'canvas') fail('UNSUPPORTED_NOTE_TYPE', 'Canvas editing is not supported by the live text CLI');
  if (store.getState().saveError) { try { await store.getState().saveCurrentNote(); } catch (error) { fail('SAVE_FAILED', String(error)); } }
  const id = note.id;
  if (command === 'rename') {
    const name = text(params, 'name')?.trim() ?? fail('INVALID_REQUEST', 'rename requires name');
    if (!name || /[\/\\\r\n\0]/.test(name)) fail('INVALID_REQUEST', 'Invalid note name');
    note = await checkRevision(id, text(params, 'ifRevision')); expired(request);
    try { await store.getState().applyExternalNote(id, { title: name }); } catch (error) { fail('SAVE_FAILED', String(error)); }
    return read(fresh(id));
  }
  if (command === 'write' && !text(params, 'ifRevision')) fail('REVISION_REQUIRED', 'write requires ifRevision from read');
  // Parse first, then re-read: human edits during async Markdown parsing must survive.
  const incoming = preparedIncoming ?? await parseContent(params, command === 'write' ? note.title : undefined);
  note = await checkRevision(id, text(params, 'ifRevision')); expired(request);
  const existing = editorFor(note)?.document ?? parseNoteBlocks(note.content);
  if (!existing) fail('INVALID_NOTE_CONTENT', 'Note content is not a block document');
  let blocks: unknown[] = incoming;
  if (command === 'append') blocks = [...existing, ...incoming];
  if (command === 'prepend') {
    // Keep the title and imported frontmatter ahead of body content.
    const offset = existing[0]?.type === 'heading' && existing[0]?.props?.level === 1 ? (existing[1]?.type === 'codeBlock' && existing[1]?.props?.language === 'yaml' ? 2 : 1) : 0;
    blocks = [...existing.slice(0, offset), ...incoming, ...existing.slice(offset)];
  }
  return apply(note, blocks);
}

/** Serialize external commands; regular typing remains responsive between awaited IO. */
export function executeGuiCommand(request: GuiRequest): Promise<GuiResponse> {
  const next = queue.catch(() => {}).then(async (): Promise<GuiResponse> => {
    try { return { schemaVersion: 1, data: await execute(request) }; }
    catch (error) { return { schemaVersion: 1, error: { code: error instanceof CliError ? error.code : 'COMMAND_FAILED', message: error instanceof Error ? error.message : String(error) } }; }
  });
  queue = next;
  return next;
}
