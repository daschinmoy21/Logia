import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import {
  AlertTriangle,
  CalendarDays,
  FileText,
  FileUp,
  PenTool,
  Plus,
  Search,
  SearchX,
  Star,
  X,
} from 'lucide-react';
import { useNotesStore } from '../../store/notesStore';
import { getNoteTags, notePreview, searchWorkspaceNotes } from '../../lib/workspace';
import type { Note } from '../../types/Note';
import useUiStore from '../../store/UiStore';
import { Button, Tip } from '../ui/kit';
import { PillSelect } from '../ui/menu';
import {
  createCanvas,
  createTextNote,
  folderPath,
  importMarkdown,
  openNote,
  openToday,
  relativeTime,
  toggleStar,
} from './actions';
import { DitherScene } from './DitherScene';
import { useWorkspaceStore, type HomeFilter, type HomeSort } from './workspaceStore';
import { isBlockingModalOpen, isEditableTarget, Kbd, SHORTCUTS, shortcutAria, type Shortcut } from './shortcuts';

const PAGE_SIZE = 100;
const TAG_LIMIT = 14;
const RECENT_LIMIT = 4;

const FILTERS: Array<{ id: HomeFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'starred', label: 'Starred' },
  { id: 'canvas', label: 'Canvas' },
];

function ActionButton({
  icon,
  label,
  onClick,
  primary,
  shortcut,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
  shortcut?: Shortcut;
}) {
  const button = (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      onClick={onClick}
      aria-keyshortcuts={shortcut ? shortcutAria(shortcut) : undefined}
    >
      {icon}
      {label}
    </Button>
  );
  return shortcut ? <Tip label={label} shortcut={shortcut}>{button}</Tip> : button;
}

const openNoteMenu = (event: { preventDefault: () => void; clientX: number; clientY: number }, note: Note) => {
  event.preventDefault();
  useUiStore.getState().setContextMenu({ x: event.clientX, y: event.clientY, note });
};

function NoteRow({ note, path, tags }: { note: Note; path: string; tags: string[] }) {
  const title = note.title || 'Untitled';
  const preview = notePreview(note, 170);
  const when = relativeTime(note.updated_at);
  const isCanvas = note.note_type === 'canvas';
  const updated = new Date(note.updated_at);

  return (
    <li className="group relative">
      <button
        type="button"
        data-note-row
        onClick={() => openNote(note)}
        onContextMenu={(event) => openNoteMenu(event, note)}
        className="flex h-9 w-full min-w-0 items-center gap-2.5 rounded-md pl-2 pr-9 text-left hover:bg-white/[0.04]"
      >
        <span className="flex-shrink-0 text-zinc-500" aria-hidden="true">
          {isCanvas ? <PenTool size={14} /> : <FileText size={15} />}
        </span>
        <span className="max-w-[55%] flex-shrink-0 truncate text-[13px] text-zinc-100">{title}</span>
        <span className="hidden min-w-0 flex-1 truncate text-[13px] text-zinc-500 sm:block">{preview}</span>
        <span className="ml-auto flex flex-shrink-0 items-center gap-2.5 text-xs text-zinc-500">
          {tags.slice(0, 2).map((tag) => (
            <span key={tag} className="hidden text-zinc-400 lg:inline">#{tag}</span>
          ))}
          {path && <span className="hidden max-w-[9rem] truncate md:inline">{path}</span>}
          {when && (
            <time dateTime={note.updated_at} title={Number.isNaN(updated.getTime()) ? undefined : updated.toLocaleString()} className="whitespace-nowrap font-mono text-[11px]">
              {when}
            </time>
          )}
        </span>
      </button>
      <button
        type="button"
        onClick={() => toggleStar(note)}
        aria-pressed={!!note.starred}
        aria-label={note.starred ? `Unstar ${title}` : `Star ${title}`}
        className={`absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded hover:bg-white/10 ${
          note.starred ? 'text-amber-300' : 'text-zinc-500 hover:text-zinc-100 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
        }`}
      >
        <Star size={13} className={note.starred ? 'fill-current' : ''} />
      </button>
    </li>
  );
}

function RecentCards({ notes }: { notes: Note[] }) {
  return (
    <section aria-label="Jump back in" className="mt-8">
      <h2 className="mb-2 px-0.5 text-xs font-medium text-zinc-400">Jump back in</h2>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {notes.map((note) => (
          <button
            key={note.id}
            type="button"
            onClick={() => openNote(note)}
            onContextMenu={(event) => openNoteMenu(event, note)}
            className="flex min-w-0 flex-col gap-3 rounded-lg border border-zinc-800/80 bg-zinc-925 p-3 text-left hover:border-zinc-700 hover:bg-zinc-900"
          >
            <span className="text-zinc-500" aria-hidden="true">
              {note.note_type === 'canvas' ? <PenTool size={15} /> : <FileText size={15} />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-zinc-100">{note.title || 'Untitled'}</span>
              <span className="mt-1 block truncate font-mono text-[11px] text-zinc-500">{relativeTime(note.updated_at)}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function FirstRun() {
  const cards = [
    { icon: <FileText size={16} />, title: 'Write a note', body: 'Headings, lists, code and [[links]] between notes.', onClick: () => createTextNote() },
    { icon: <CalendarDays size={16} />, title: "Start today's note", body: 'A dated page with space for intentions and notes.', onClick: openToday },
    { icon: <FileUp size={16} />, title: 'Import Markdown', body: 'Bring in .md files. Your originals are not changed.', onClick: importMarkdown },
    { icon: <PenTool size={16} />, title: 'Open a canvas', body: 'A freeform space for sketches and diagrams.', onClick: () => createCanvas() },
  ];
  return (
    <section aria-labelledby="first-run-title" className="pt-6">
      <h2 id="first-run-title" className="text-center text-sm font-medium text-zinc-100">Nothing here yet</h2>
      <p className="mt-1 text-center text-[13px] text-zinc-400">Pick a starting point. Everything you add will be listed and searchable here.</p>
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {cards.map((card) => (
          <button
            key={card.title}
            type="button"
            onClick={card.onClick}
            className="flex items-start gap-3 rounded-lg border border-zinc-800/80 bg-zinc-925 p-3.5 text-left hover:border-zinc-700 hover:bg-zinc-900"
          >
            <span className="mt-0.5 flex-shrink-0 text-zinc-400" aria-hidden="true">{card.icon}</span>
            <span>
              <span className="block text-[13px] font-medium text-zinc-100">{card.title}</span>
              <span className="mt-0.5 block text-xs leading-5 text-zinc-500">{card.body}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="mt-6 flex flex-wrap items-center justify-center gap-1.5 text-xs text-zinc-500">
        Press <Kbd keys={SHORTCUTS.commands} /> any time to see every command.
      </p>
    </section>
  );
}

function NoResults({
  query,
  filter,
  tag,
  onClear,
}: {
  query: string;
  filter: HomeFilter;
  tag: string | null;
  onClear: () => void;
}) {
  const trimmed = query.trim();
  const isPlainTitle = trimmed && !/(^|\s)(#|is:)/.test(trimmed);
  const filtersOnly = !trimmed && !tag;

  let title = 'No notes match these filters';
  let body = 'Clear the search or filters to see everything again.';
  if (filtersOnly && filter === 'starred') {
    title = 'No starred notes yet';
    body = 'Star a note to keep it within reach. Use the star on any note in this list or at the top of a note.';
  } else if (filtersOnly && filter === 'canvas') {
    title = 'No canvases yet';
    body = 'A canvas is a freeform space for sketches and diagrams.';
  } else if (trimmed) {
    title = `Nothing found for “${trimmed}”`;
    body = 'Search looks through titles and note text. You can also use #tag, is:starred, is:canvas or is:text.';
  }

  return (
    <div className="flex flex-col items-center px-4 py-14 text-center">
      <SearchX size={18} className="text-zinc-600" aria-hidden="true" />
      <p className="mt-3 text-[13px] font-medium text-zinc-200">{title}</p>
      <p className="mt-1 max-w-sm text-[13px] leading-5 text-zinc-400">{body}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {filtersOnly && filter === 'canvas' && (
          <ActionButton primary icon={<Plus size={14} />} label="New canvas" onClick={() => createCanvas()} />
        )}
        {isPlainTitle && (
          <ActionButton primary icon={<Plus size={14} />} label={`Create “${trimmed}”`} onClick={() => createTextNote(trimmed)} />
        )}
        <ActionButton icon={<X size={14} />} label={filtersOnly ? 'Show all notes' : 'Clear search and filters'} onClick={onClear} />
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <div aria-busy="true" aria-label="Loading notes" role="status" className="mt-8 space-y-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-3 animate-pulse rounded bg-zinc-900 motion-reduce:animate-none" style={{ width: `${70 - i * 10}%` }} />
      ))}
    </div>
  );
}

function LoadProblem({
  title,
  body,
  detail,
  busy,
  onRetry,
}: {
  title: string;
  body: string;
  detail: string;
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="mt-4 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-red-500/20 bg-red-500/[0.04] px-3 py-2.5">
      <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-red-300" aria-hidden="true" />
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-[13px] font-medium text-red-200">{title}</p>
        <p className="mt-0.5 text-[13px] leading-5 text-zinc-400">{body}</p>
        <p className="mt-1 break-words font-mono text-xs leading-5 text-zinc-500">{detail}</p>
      </div>
      <Button onClick={onRetry} disabled={busy}>{busy ? 'Retrying…' : 'Retry'}</Button>
    </div>
  );
}

function greeting(hour = new Date().getHours()) {
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function WorkspaceHome() {
  const notes = useNotesStore((s) => s.notes);
  const folders = useNotesStore((s) => s.folders);
  const isLoading = useNotesStore((s) => s.isLoading);
  const loadError = useNotesStore((s) => s.loadError);
  const folderLoadError = useNotesStore((s) => s.folderLoadError);
  const loadNotes = useNotesStore((s) => s.loadNotes);
  const loadFolders = useNotesStore((s) => s.loadFolders);
  const [retryingFolders, setRetryingFolders] = useState(false);
  const ready = useWorkspaceStore((s) => s.ready);
  const { query, filter, tag, sort } = useWorkspaceStore((s) => s.home);
  const setHome = useWorkspaceStore((s) => s.setHome);
  const resetHomeFilters = useWorkspaceStore((s) => s.resetHomeFilters);

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [showAllTags, setShowAllTags] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const searching = deferredQuery.trim().length > 0;

  const tagsById = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const note of notes) map.set(note.id, note.note_type === 'canvas' ? [] : getNoteTags(note.content));
    return map;
  }, [notes]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tags of tagsById.values()) for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [tagsById]);

  const counts = {
    all: notes.length,
    starred: notes.filter((n) => n.starred).length,
    canvas: notes.filter((n) => n.note_type === 'canvas').length,
  };

  // Best match only makes sense while there's a query to match.
  const effectiveSort: HomeSort = sort && (sort !== 'relevance' || searching) ? sort : searching ? 'relevance' : 'updated';

  const results = useMemo(() => {
    const matched = searching ? searchWorkspaceNotes(deferredQuery, notes) : notes;
    const filtered = matched.filter((note) => {
      if (filter === 'starred' && !note.starred) return false;
      if (filter === 'canvas' && note.note_type !== 'canvas') return false;
      if (tag) {
        const tags = tagsById.get(note.id) ?? [];
        if (!tags.some((t) => t === tag || t.startsWith(`${tag}/`))) return false;
      }
      return true;
    });
    if (effectiveSort === 'relevance') return filtered;
    const time = (value: string) => Date.parse(value) || 0;
    return [...filtered].sort((a, b) => {
      if (effectiveSort === 'title') {
        return (a.title || 'Untitled').localeCompare(b.title || 'Untitled', undefined, { numeric: true, sensitivity: 'base' });
      }
      if (effectiveSort === 'created') return time(b.created_at) - time(a.created_at);
      return time(b.updated_at) - time(a.updated_at);
    });
  }, [deferredQuery, searching, notes, filter, tag, tagsById, effectiveSort]);

  useEffect(() => setVisibleCount(PAGE_SIZE), [deferredQuery, filter, tag, effectiveSort]);

  // "/" jumps to search, a familiar convention that can't collide with typing here.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (isEditableTarget(e.target) || isBlockingModalOpen()) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const rows = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-note-row]') ?? []);

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      rows()[0]?.focus();
    } else if (e.key === 'Enter' && searching && results[0]) {
      e.preventDefault();
      void openNote(results[0]);
    } else if (e.key === 'Escape' && query) {
      e.preventDefault();
      setHome({ query: '' });
    }
  };

  const onListKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const all = rows();
    const index = all.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    e.preventDefault();
    if (e.key === 'ArrowUp' && index === 0) searchRef.current?.focus();
    else all[index + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
  };

  const shownTags = showAllTags ? tagCounts : tagCounts.slice(0, TAG_LIMIT);
  // A tag picked from "show all" stays visible after collapsing the list.
  const tagChips = tag && !shownTags.some(([t]) => t === tag)
    ? [...shownTags, [tag, tagCounts.find(([t]) => t === tag)?.[1] ?? 0] as [string, number]]
    : shownTags;
  // Retrying clears the error first, so an empty list isn't proof of an empty workspace yet.
  const loading = !ready || (isLoading && notes.length === 0);
  const notesUnavailable = !loading && !!loadError && notes.length === 0;
  const isEmptyWorkspace = !loading && !loadError && notes.length === 0;
  const retryFolders = () => {
    setRetryingFolders(true);
    void loadFolders().finally(() => setRetryingFolders(false));
  };
  const native = isTauri();
  const showRecents = !searching && filter === 'all' && !tag && notes.length > RECENT_LIMIT;
  const recents = showRecents
    ? [...notes].sort((a, b) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0)).slice(0, RECENT_LIMIT)
    : [];

  const countLabel = `${results.length} ${results.length === 1 ? 'note' : 'notes'}`;

  return (
    <div className="relative h-full min-h-0 bg-zinc-950">
      <DitherScene className="absolute inset-x-0 top-0 h-1/2 w-full [mask-image:linear-gradient(to_bottom,black_60%,transparent)]" />
      <div className="relative h-full min-h-0 overflow-y-auto">
      <div className="relative min-h-full">
      <main className="relative mx-auto w-full max-w-[780px] px-4 pb-16 pt-[140px] sm:px-8 sm:pt-[250px]">
        <header className="text-center">
          <h1 className="text-[24px] font-semibold tracking-tight text-zinc-50 [text-shadow:0_1px_12px_rgb(0_0_0_/_0.7)] sm:text-[28px]">
            {greeting()}. What's on your mind?
          </h1>
        </header>

        {!loading && notes.length > 0 && (
          <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900 p-1.5 shadow-2xl shadow-black/50">
            <div className="relative rounded-lg bg-zinc-950/70 focus-within:ring-1 focus-within:ring-zinc-600">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setHome({ query: e.target.value })}
                onKeyDown={onSearchKeyDown}
                placeholder="Search notes, #tags, is:starred…"
                aria-label="Search notes"
                aria-keyshortcuts="/"
                data-vim-escape-to-editor
                className="h-12 w-full rounded-lg bg-transparent pl-9 pr-10 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setHome({ query: '' });
                    searchRef.current?.focus();
                  }}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 hover:text-zinc-200"
                >
                  <X size={14} />
                </button>
              ) : (
                <kbd aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 hidden min-w-5 -translate-y-1/2 rounded-[4px] border border-zinc-700 px-1 text-center font-mono text-[11px] leading-[18px] text-zinc-400 sm:block">/</kbd>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-1 gap-y-1 pl-1.5 pr-0.5 pt-1.5">
              <span className="mr-2 whitespace-nowrap font-mono text-[11px] text-zinc-500">
                {counts.all - counts.canvas} {counts.all - counts.canvas === 1 ? 'note' : 'notes'}
                {counts.canvas > 0 && ` · ${counts.canvas} ${counts.canvas === 1 ? 'canvas' : 'canvases'}`}
              </span>
              <Tip label="Today's note" shortcut={SHORTCUTS.dailyNote}>
                <Button variant="ghost" size="sm" onClick={openToday} aria-keyshortcuts={shortcutAria(SHORTCUTS.dailyNote)}><CalendarDays size={13} /> Today</Button>
              </Tip>
              <Button variant="ghost" size="sm" onClick={() => createCanvas()}><PenTool size={12} /> New canvas</Button>
              <Button variant="ghost" size="sm" onClick={importMarkdown}><FileUp size={13} /> Import</Button>
              <span className="ml-auto">
                <ActionButton primary icon={<Plus size={14} />} label="New note" onClick={() => createTextNote()} shortcut={native ? SHORTCUTS.newNote : undefined} />
              </span>
            </div>
          </div>
        )}

        {loadError && !loading && (
          <LoadProblem
            title="Couldn't load your notes"
            body={notes.length > 0
              ? 'This list may be out of date. Your notes were not changed.'
              : "This doesn't mean your workspace is empty. Nothing was changed."}
            detail={loadError}
            busy={isLoading}
            onRetry={() => {
              // Both read the same source, so a shared failure needs one retry, not two.
              void loadNotes();
              if (folderLoadError) retryFolders();
            }}
          />
        )}
        {folderLoadError && !notesUnavailable && !loading && (
          <LoadProblem
            title="Couldn't load your folders"
            body="Your notes are still available, but folder names may be missing."
            detail={folderLoadError}
            busy={retryingFolders}
            onRetry={retryFolders}
          />
        )}

        {loading && <LoadingRows />}
        {isEmptyWorkspace && <FirstRun />}

        {!loading && notes.length > 0 && (
          <>
            {recents.length > 0 && <RecentCards notes={recents} />}

            <section aria-label="All notes" className="mt-6 rounded-xl border border-zinc-800 bg-zinc-925">
            <div className="sticky top-0 z-10 rounded-t-xl border-b border-zinc-800 bg-zinc-925 px-2.5 py-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div role="group" aria-label="Filter by type" className="flex h-7 items-center rounded-md p-0.5">
                  {FILTERS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setHome({ filter: f.id })}
                      aria-pressed={filter === f.id}
                      className={`flex h-full items-center gap-1.5 rounded-[4px] px-2 text-xs ${
                        filter === f.id ? 'bg-white/[0.13] text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
                      }`}
                    >
                      {f.label}
                      <span className={`font-mono text-[11px] ${filter === f.id ? 'text-zinc-400' : 'text-zinc-500'}`}>{counts[f.id]}</span>
                    </button>
                  ))}
                </div>
                <PillSelect
                  label="Sort"
                  value={effectiveSort}
                  align="end"
                  onChange={(value) => setHome({ sort: value as HomeSort })}
                  options={[
                    ...(searching ? [{ value: 'relevance', label: 'Best match' }] : []),
                    { value: 'updated', label: 'Recently edited' },
                    { value: 'created', label: 'Recently created' },
                    { value: 'title', label: 'Title A–Z' },
                  ]}
                />
              </div>
            </div>

            {/* Outside the sticky header: a long tag list shouldn't eat a small screen. */}
            {tagChips.length > 0 && (
                <div role="group" aria-label="Filter by tag" className="flex flex-wrap items-center gap-1 px-3 pt-2.5">
                  {tagChips.map(([t, count]) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setHome({ tag: tag === t ? null : t })}
                      aria-pressed={tag === t}
                      className={`max-w-[14rem] truncate rounded-[5px] px-1.5 py-0.5 text-xs ${
                        tag === t
                          ? 'bg-blue-500/20 text-blue-200'
                          : 'bg-white/[0.05] text-zinc-400 hover:bg-white/[0.13] hover:text-zinc-200'
                      }`}
                    >
                      #{t} <span className="font-mono text-[11px] text-zinc-500">{count}</span>
                    </button>
                  ))}
                  {tagCounts.length > TAG_LIMIT && (
                    <button
                      type="button"
                      onClick={() => setShowAllTags(!showAllTags)}
                      aria-expanded={showAllTags}
                      className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:text-zinc-200"
                    >
                      {showAllTags ? 'Fewer' : `${tagCounts.length - TAG_LIMIT} more`}
                    </button>
                  )}
                </div>
            )}

            <p role="status" className="sr-only">{countLabel}</p>

            {results.length === 0 ? (
              <NoResults query={deferredQuery} filter={filter} tag={tag} onClear={resetHomeFilters} />
            ) : (
              <>
                <ul ref={listRef} onKeyDown={onListKeyDown} aria-label="Notes" className="p-1.5">
                  {results.slice(0, visibleCount).map((note) => (
                    <NoteRow
                      key={note.id}
                      note={note}
                      path={folderPath(note.folder_id, folders, ' / ')}
                      tags={tagsById.get(note.id) ?? []}
                    />
                  ))}
                </ul>
                {results.length > visibleCount && (
                  <div className="flex justify-center pb-3 pt-1">
                    <ActionButton
                      icon={null}
                      label={`Show more (${results.length - visibleCount} left)`}
                      onClick={() => setVisibleCount(visibleCount + PAGE_SIZE)}
                    />
                  </div>
                )}
              </>
            )}
            </section>
          </>
        )}
      </main>
      </div>
      </div>
    </div>
  );
}
