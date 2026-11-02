import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import {
  AlertTriangle,
  CalendarDays,
  FileText,
  FileUp,
  Layout,
  Plus,
  Search,
  SearchX,
  Star,
  X,
} from 'lucide-react';
import { useNotesStore } from '../../store/notesStore';
import { getNoteTags, notePreview, searchWorkspaceNotes } from '../../lib/workspace';
import type { Note } from '../../types/Note';
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
import { useWorkspaceStore, type HomeFilter, type HomeSort } from './workspaceStore';
import { isBlockingModalOpen, isEditableTarget, Kbd, SHORTCUTS, shortcutAria, shortcutText, type Shortcut } from './shortcuts';

const PAGE_SIZE = 100;
const TAG_LIMIT = 14;
const focusRing = 'outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70';

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
  return (
    <button
      type="button"
      onClick={onClick}
      aria-keyshortcuts={shortcut ? shortcutAria(shortcut) : undefined}
      title={shortcut ? `${label} (${shortcutText(shortcut)})` : label}
      className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-[13px] font-medium transition-colors ${focusRing} ${
        primary
          ? 'border-blue-500 bg-blue-600 text-white hover:bg-blue-500'
          : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function NoteRow({ note, path, tags }: { note: Note; path: string; tags: string[] }) {
  const title = note.title || 'Untitled';
  const preview = notePreview(note, 170);
  const when = relativeTime(note.updated_at);
  const isCanvas = note.note_type === 'canvas';
  const updated = new Date(note.updated_at);

  return (
    <li className="group relative flex items-start border-b border-zinc-900 last:border-b-0">
      <button
        type="button"
        data-note-row
        onClick={() => openNote(note)}
        className={`flex min-w-0 flex-1 items-start gap-3 rounded-md px-2 py-3 text-left transition-colors hover:bg-zinc-900/70 ${focusRing} focus-visible:ring-inset`}
      >
        <span className="mt-0.5 flex-shrink-0" aria-hidden="true">
          {isCanvas ? <Layout size={15} className="text-purple-400/90" /> : <FileText size={15} className="text-zinc-500" />}
        </span>
        <span className="min-w-0 flex-1 pr-7">
          <span className="block truncate text-sm font-medium text-zinc-100">{title}</span>
          {preview && <span className="mt-0.5 line-clamp-2 block text-[13px] leading-5 text-zinc-400">{preview}</span>}
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
            {when && (
              <time dateTime={note.updated_at} title={Number.isNaN(updated.getTime()) ? undefined : updated.toLocaleString()}>
                {when}
              </time>
            )}
            {isCanvas && <span className="text-purple-400/80">Canvas</span>}
            {path && <span className="max-w-[16rem] truncate">{path}</span>}
            {tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-blue-300/70">#{tag}</span>
            ))}
            {tags.length > 3 && <span>+{tags.length - 3}</span>}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => toggleStar(note)}
        aria-pressed={!!note.starred}
        aria-label={note.starred ? `Unstar ${title}` : `Star ${title}`}
        title={note.starred ? 'Unstar' : 'Star'}
        className={`absolute right-1.5 top-2.5 rounded-md p-1 transition-colors hover:bg-zinc-800 ${focusRing} ${
          note.starred ? 'text-yellow-400' : 'text-zinc-600 hover:text-yellow-400 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
        }`}
      >
        <Star size={14} className={note.starred ? 'fill-yellow-400' : ''} />
      </button>
    </li>
  );
}

function FirstRun() {
  const cards = [
    { icon: <FileText size={18} className="text-blue-400" />, title: 'Write a note', body: 'Headings, lists, code and [[links]] between notes.', onClick: () => createTextNote() },
    { icon: <CalendarDays size={18} className="text-emerald-400" />, title: "Start today's note", body: 'A dated page with space for intentions and notes.', onClick: openToday },
    { icon: <FileUp size={18} className="text-amber-400" />, title: 'Import Markdown', body: 'Bring in .md files. Your originals are not changed.', onClick: importMarkdown },
    { icon: <Layout size={18} className="text-purple-400" />, title: 'Open a canvas', body: 'A freeform space for sketches and diagrams.', onClick: () => createCanvas() },
  ];
  return (
    <section aria-labelledby="first-run-title" className="mx-auto max-w-2xl pt-6 sm:pt-14">
      <h2 id="first-run-title" className="text-xl font-semibold tracking-tight text-zinc-100">Nothing here yet</h2>
      <p className="mt-1.5 text-sm text-zinc-400">Pick a starting point. Everything you add will be listed and searchable here.</p>
      <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
        {cards.map((card) => (
          <button
            key={card.title}
            type="button"
            onClick={card.onClick}
            className={`flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900 ${focusRing}`}
          >
            <span className="mt-0.5 flex-shrink-0" aria-hidden="true">{card.icon}</span>
            <span>
              <span className="block text-sm font-medium text-zinc-100">{card.title}</span>
              <span className="mt-0.5 block text-[13px] leading-5 text-zinc-400">{card.body}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="mt-6 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
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
      <SearchX size={22} className="text-zinc-600" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-zinc-200">{title}</p>
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
    <div aria-busy="true" aria-label="Loading notes" role="status" className="mt-8 space-y-5">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="animate-pulse space-y-2 motion-reduce:animate-none">
          <div className="h-3.5 w-1/3 rounded bg-zinc-800/80" />
          <div className="h-3 w-3/4 rounded bg-zinc-900" />
        </div>
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
    <div role="alert" className="mt-4 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border border-red-500/25 bg-red-500/5 px-3 py-2.5">
      <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-red-300" aria-hidden="true" />
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-medium text-red-100">{title}</p>
        <p className="mt-0.5 text-[13px] leading-5 text-zinc-400">{body}</p>
        <p className="mt-1 break-words font-mono text-xs leading-5 text-zinc-500">{detail}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        className={`h-8 flex-shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-[13px] font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-60 ${focusRing}`}
      >
        {busy ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}

function BrowserNote() {
  return (
    <p className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-amber-200/80">
      This is a browser workspace. Notes are kept only in this browser. Trash, audio capture, to-dos, Git sync and saved AI keys need the desktop app.
    </p>
  );
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

  const countLabel = `${results.length} ${results.length === 1 ? 'note' : 'notes'}`;

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-zinc-950">
      <main className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-8 sm:pt-10">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Home</h1>
            {!loading && notes.length > 0 && (
              <p className="mt-0.5 text-[13px] text-zinc-500">
                {counts.all - counts.canvas} {counts.all - counts.canvas === 1 ? 'note' : 'notes'}
                {counts.canvas > 0 && ` · ${counts.canvas} ${counts.canvas === 1 ? 'canvas' : 'canvases'}`}
              </p>
            )}
          </div>
          {!isEmptyWorkspace && !notesUnavailable && (
            <div className="flex flex-wrap gap-1.5">
              <ActionButton primary icon={<Plus size={14} />} label="New note" onClick={() => createTextNote()} shortcut={native ? SHORTCUTS.newNote : undefined} />
              <ActionButton icon={<Layout size={14} />} label="New canvas" onClick={() => createCanvas()} />
              <ActionButton icon={<CalendarDays size={14} />} label="Today" onClick={openToday} shortcut={SHORTCUTS.dailyNote} />
              <ActionButton icon={<FileUp size={14} />} label="Import" onClick={importMarkdown} />
            </div>
          )}
        </header>

        {!native && <BrowserNote />}

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
            <div className="sticky top-0 z-10 -mx-1 mt-5 bg-zinc-950 px-1 pb-3 pt-2">
              <div className="relative">
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
                  className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-900/70 pl-9 pr-9 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-blue-500/70 focus:ring-1 focus:ring-blue-500/40 [&::-webkit-search-cancel-button]:hidden"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => {
                      setHome({ query: '' });
                      searchRef.current?.focus();
                    }}
                    aria-label="Clear search"
                    className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 hover:text-zinc-200 ${focusRing}`}
                  >
                    <X size={14} />
                  </button>
                ) : (
                  <kbd aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-zinc-700/80 bg-zinc-800/70 px-1.5 font-mono text-[10px] leading-4 text-zinc-500 sm:block">/</kbd>
                )}
              </div>

              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                <div role="group" aria-label="Filter by type" className="flex rounded-md border border-zinc-800 p-0.5">
                  {FILTERS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setHome({ filter: f.id })}
                      aria-pressed={filter === f.id}
                      className={`rounded px-2.5 py-0.5 text-xs font-medium transition-colors ${focusRing} ${
                        filter === f.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {f.label}
                      <span className={`ml-1.5 tabular-nums ${filter === f.id ? 'text-zinc-400' : 'text-zinc-600'}`}>{counts[f.id]}</span>
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                  Sort
                  <select
                    value={effectiveSort}
                    onChange={(e) => setHome({ sort: e.target.value as HomeSort })}
                    className={`rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-xs text-zinc-300 ${focusRing}`}
                  >
                    {searching && <option value="relevance">Best match</option>}
                    <option value="updated">Recently edited</option>
                    <option value="created">Recently created</option>
                    <option value="title">Title A–Z</option>
                  </select>
                </label>
              </div>
            </div>

            {/* Outside the sticky header: a long tag list shouldn't eat a small screen. */}
            {tagChips.length > 0 && (
                <div role="group" aria-label="Filter by tag" className="mb-3 flex flex-wrap items-center gap-1">
                  {tagChips.map(([t, count]) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setHome({ tag: tag === t ? null : t })}
                      aria-pressed={tag === t}
                      className={`max-w-[14rem] truncate rounded-full border px-2 py-px text-xs transition-colors ${focusRing} ${
                        tag === t
                          ? 'border-blue-500/60 bg-blue-500/15 text-blue-200'
                          : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                      }`}
                    >
                      #{t} <span className="tabular-nums text-zinc-500">{count}</span>
                    </button>
                  ))}
                  {tagCounts.length > TAG_LIMIT && (
                    <button
                      type="button"
                      onClick={() => setShowAllTags(!showAllTags)}
                      aria-expanded={showAllTags}
                      className={`rounded px-1.5 py-px text-xs text-zinc-500 hover:text-zinc-200 ${focusRing}`}
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
                <ul ref={listRef} onKeyDown={onListKeyDown} aria-label="Notes">
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
                  <div className="mt-4 flex justify-center">
                    <ActionButton
                      icon={null}
                      label={`Show more (${results.length - visibleCount} left)`}
                      onClick={() => setVisibleCount(visibleCount + PAGE_SIZE)}
                    />
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
