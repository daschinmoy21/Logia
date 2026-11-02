#!/usr/bin/env node
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { getBacklinks, getNoteTags, getWikiLinks, notePath, resolveWikiLink, searchWorkspaceNotes } from '../src/lib/workspace.ts';
import { noteToMarkdown } from '../src/lib/note-markdown.ts';
import type { Note, Folder } from '../src/types/Note.ts';

type Warning = { file: string; message: string };
const envelope = (data: unknown, warnings: Warning[] = []) => ({ schemaVersion: 1, data, ...(warnings.length ? { warnings } : {}) });
const emit = (data: unknown) => process.stdout.write(JSON.stringify(data, null, 2) + '\n');

async function loadCollection<T>(directory: string, validate: (value: unknown) => value is T, warnings: Warning[]): Promise<T[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const items: T[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const item: unknown = JSON.parse(await readFile(path.join(directory, entry.name), 'utf8'));
      if (!validate(item)) throw new Error('Invalid record shape');
      items.push(item);
    } catch (error) {
      warnings.push({ file: entry.name, message: String(error) });
    }
  }
  return items;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const isNote = (v: unknown): v is Note => isRecord(v) && ['id', 'title', 'content', 'created_at', 'updated_at'].every((k) => typeof v[k] === 'string');
const isFolder = (v: unknown): v is Folder => isRecord(v) && ['id', 'name', 'created_at', 'updated_at'].every((k) => typeof v[k] === 'string');

function segment(value: string): string {
  let safe = value.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').slice(0, 100).replace(/[. ]+$/g, '');
  if (!safe || /^\.+$/.test(safe)) safe = 'Untitled';
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(safe)) safe = `_${safe}`;
  return safe;
}

async function main() {
  const { values, positionals } = parseArgs({ options: {
    'data-dir': { type: 'string' }, format: { type: 'string', default: 'json' },
    output: { type: 'string' }, help: { type: 'boolean' },
  }, allowPositionals: true });
  if (values.help || !positionals.length) {
    emit(envelope({
      commands: ['list', 'read <id>', 'search <query>', 'links <id>', 'export --output <new-directory>'],
      options: { '--data-dir': 'Logia root containing notes/ and folders/. Defaults to ~/Documents/Logia; respects LOGIA_DATA_DIR.', '--format': 'json (default) or markdown (read only)', '--output': 'A NEW directory for a Markdown + raw JSON snapshot' },
      writes: 'Export creates a separate snapshot. Source notes are always read-only.',
    }));
    return;
  }
  const [command, ...args] = positionals;
  if (!['list', 'read', 'search', 'links', 'export'].includes(command)) throw new Error(`Unknown command: ${command}`);
  if (!['json', 'markdown'].includes(values.format)) throw new Error('Format must be json or markdown');
  if (values.format === 'markdown' && command !== 'read') throw new Error('Markdown format is supported by read only');
  if (['read', 'links'].includes(command) && args.length !== 1) throw new Error(`${command} requires exactly one note ID`);
  if (command === 'search' && !args.join(' ').trim()) throw new Error('search requires a query');
  if (['list', 'export'].includes(command) && args.length) throw new Error(`${command} does not accept positional arguments`);
  const dataDir = path.resolve(values['data-dir'] || process.env.LOGIA_DATA_DIR || path.join(os.homedir(), 'Documents', 'Logia'));
  const warnings: Warning[] = [];
  const notes = await loadCollection(path.join(dataDir, 'notes'), isNote, warnings);
  let folders: Folder[] = [];
  try {
    folders = await loadCollection(path.join(dataDir, 'folders'), isFolder, warnings);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const summary = (note: Note) => ({ id: note.id, title: note.title, path: notePath(note, folders), type: note.note_type || 'text', starred: Boolean(note.starred), tags: note.note_type === 'canvas' ? [] : getNoteTags(note.content), updated_at: note.updated_at });
  const requireNote = () => {
    const note = notes.find((n) => n.id === args[0]);
    if (!note) throw new Error(`Note not found: ${args[0]}`);
    return note;
  };
  if (command === 'list') emit(envelope(notes.map(summary), warnings));
  if (command === 'search') emit(envelope(searchWorkspaceNotes(args.join(' '), notes).map(summary), warnings));
  if (command === 'read') {
    const note = requireNote();
    if (values.format === 'markdown') {
      if (note.note_type === 'canvas') throw new Error('Canvas notes have no Markdown representation; use --format json');
      if (warnings.length) process.stderr.write(JSON.stringify({ warnings }) + '\n');
      process.stdout.write(noteToMarkdown(note.content));
    } else emit(envelope({ ...note, tags: getNoteTags(note.content), markdown: note.note_type === 'canvas' ? null : noteToMarkdown(note.content) }, warnings));
  }
  if (command === 'links') {
    const note = requireNote();
    emit(envelope({ outgoing: getWikiLinks(note.content).map((link) => ({ ...link, resolvedId: resolveWikiLink(link.target, notes, folders)?.id || null })), backlinks: getBacklinks(note, notes, folders).map(summary) }, warnings));
  }
  if (command === 'export') {
    if (!values.output) throw new Error('export requires --output <new-directory>');
    const output = path.resolve(values.output);
    // Refuse existing destinations, including symlinks. No overwriting someone else's vault.
    await mkdir(output);
    await mkdir(path.join(output, '.logia'));
    const used = new Set<string>();
    const manifest: Array<ReturnType<typeof summary> & { markdownFile: string | null; sourceFile: string }> = [];
    for (const [index, note] of notes.entries()) {
      const sourceFile = `.logia/${index + 1}.json`;
      await writeFile(path.join(output, sourceFile), JSON.stringify(note, null, 2) + '\n', { flag: 'wx' });
      let markdownFile: string | null = null;
      if (note.note_type !== 'canvas') {
        const base = segment(note.title || 'Untitled');
        markdownFile = `${base}.md`;
        let suffix = 2;
        while (used.has(markdownFile.toLowerCase())) markdownFile = `${base} (${suffix++}).md`;
        used.add(markdownFile.toLowerCase());
        await writeFile(path.join(output, markdownFile), noteToMarkdown(note.content), { flag: 'wx' });
      }
      manifest.push({ ...summary(note), markdownFile, sourceFile });
    }
    await writeFile(path.join(output, '.logia', 'folders.json'), JSON.stringify(folders, null, 2) + '\n', { flag: 'wx' });
    const snapshot = envelope({ exported_at: new Date().toISOString(), notes: manifest, limitations: ['Markdown conversion is best-effort; raw note JSON is lossless.', 'Snapshot is flat. Folder paths are in this manifest; path-qualified wikilinks may need updating.', 'Linked local attachments are not copied. Embedded data URLs remain in Markdown.'] }, warnings);
    await writeFile(path.join(output, 'manifest.json'), JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
    emit(envelope({ output, count: manifest.length, manifest: 'manifest.json' }, warnings));
  }
}

main().catch((error: unknown) => {
  emit({ schemaVersion: 1, error: { code: (error as NodeJS.ErrnoException).code || 'INVALID_REQUEST', message: String(error instanceof Error ? error.message : error) } });
  process.exitCode = 1;
});
