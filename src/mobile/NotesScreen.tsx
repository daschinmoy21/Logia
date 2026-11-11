import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  Folder as FolderIcon,
  Hash,
  NotebookPen,
  Pencil,
  RefreshCw,
  Search,
  SearchX,
  Smartphone,
  Star,
  StarOff,
  Trash2,
  X,
  FileText,
} from 'lucide-react';
import { useNotesStore } from '../store/notesStore';
import { searchWorkspaceNotes } from '../lib/workspace';
import type { Folder, Note } from '../types/Note';
import { cn } from '../lib/utils';
import { rowInfo, sectionFor, shortDate, type Section } from './format';
import { createMobileNote, deleteWithUndo, toggleFavorite, usePendingDeletes } from './noteActions';
import { ActionSheet } from './ui';
import { showSnackbar, useSnackbar } from './snackbar';

type Filter = { kind: 'all' } | { kind: 'favorites' } | { kind: 'folder'; id: string } | { kind: 'tag'; tag: string };

const sameFilter = (a: Filter, b: Filter) =>
  a.kind === b.kind && (a.kind !== 'folder' || a.id === (b as typeof a).id) && (a.kind !== 'tag' || a.tag === (b as typeof a).tag);

const TAG_CHIPS = 8;
const PULL_TRIGGER = 72;

const vibrate = (ms: number) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Haptics are a nicety.
  }
};

/** A folder and everything under it. */
function folderAndDescendants(rootId: string, folders: Folder[]) {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parent_id && ids.has(folder.parent_id) && !ids.has(folder.id)) {
        ids.add(folder.id);
        grew = true;
      }
    }
  }
  return ids;
}

/**
 * Pull down at the top of the list to refresh. Notes are reloaded from the store today;
 * this is also where sync will hook in.
 */
function usePullToRefresh(scrollRef: React.RefObject<HTMLDivElement | null>, onRefresh: () => Promise<void>) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<{ y: number; x: number } | null>(null);
  const pullRef = useRef(0);
  const armedRef = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onStart = (event: TouchEvent) => {
      if (refreshing || el.scrollTop > 0 || event.touches.length !== 1) return;
      start.current = { y: event.touches[0].clientY, x: event.touches[0].clientX };
    };
    const onMove = (event: TouchEvent) => {
      if (!start.current) return;
      const dy = event.touches[0].clientY - start.current.y;
      const dx = event.touches[0].clientX - start.current.x;
      if (dy <= 0 || el.scrollTop > 0 || Math.abs(dx) > dy) {
        if (pullRef.current) setPull((pullRef.current = 0));
        if (dy < 0 || Math.abs(dx) > 12) start.current = null;
        return;
      }
      // Resistance: the indicator follows the finger at a falling rate.
      const distance = Math.min(140, dy * 0.5);
      pullRef.current = distance;
      const armed = distance >= PULL_TRIGGER;
      if (armed && !armedRef.current) vibrate(8);
      armedRef.current = armed;
      setPull(distance);
    };
    const onEnd = () => {
      if (!start.current) return;
      start.current = null;
      const trigger = pullRef.current >= PULL_TRIGGER;
      pullRef.current = 0;
      armedRef.current = false;
      setPull(0);
      if (!trigger) return;
      setRefreshing(true);
      const minimum = new Promise((resolve) => setTimeout(resolve, 600));
      void Promise.allSettled([onRefresh(), minimum]).finally(() => setRefreshing(false));
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [scrollRef, onRefresh, refreshing]);

  return { pull, refreshing };
}

/**
 * Sync status slot. There's no sync yet, so it says where notes live.
 * TODO(sync): show syncing / synced / offline / error here once the sync daemon exists.
 */
function SyncStatus() {
  return (
    <button
      type="button"
      onClick={() => showSnackbar('Notes are saved on this phone. Sync between devices is coming soon.')}
      aria-label="Storage: on this device. Sync is coming soon."
      className="m-press flex h-8 items-center gap-1.5 rounded-full bg-m-fill px-2.5 text-[12px] font-medium text-m-muted"
    >
      <Smartphone size={13} aria-hidden="true" />
      On device
    </button>
  );
}

function Chip({ selected, onClick, children, label }: { selected: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'm-press flex h-8 flex-shrink-0 snap-start items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors duration-150 motion-reduce:transition-none',
        selected ? 'border-transparent bg-m-text text-m-bg' : 'border-m-line bg-transparent text-m-muted',
      )}
    >
      {children}
    </button>
  );
}

type RowProps = {
  note: Note;
  folderName?: string;
  onOpen: (note: Note) => void;
  onMenu: (note: Note) => void;
};

/**
 * Tap opens. Swipe left deletes, swipe right toggles favorite; long-press opens the action sheet.
 * Vertical scrolling stays with the browser (touch-action: pan-y).
 */
const NoteRow = memo(function NoteRow({ note, folderName, onOpen, onMenu }: RowProps) {
  const { preview, tags } = rowInfo(note);
  const title = note.title?.trim() && note.title !== 'Untitled' ? note.title : 'Untitled';
  const untitled = title === 'Untitled';
  const slideRef = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  const [swipe, setSwipe] = useState<{ side: 'left' | 'right'; armed: boolean } | null>(null);
  const gesture = useRef<{ x: number; y: number; id: number; dir: 'h' | 'v' | null; dx: number; timer: number; width: number } | null>(null);
  const suppressClick = useRef(false);

  const setX = (x: number, animate: boolean) => {
    const el = slideRef.current;
    if (!el) return;
    el.style.transition = animate ? 'transform 220ms var(--m-ease)' : 'none';
    el.style.transform = x ? `translateX(${x}px)` : '';
  };

  const endGesture = (commit: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    window.clearTimeout(g.timer);
    if (g.dir !== 'h') return;
    suppressClick.current = true;
    const armed = Math.abs(g.dx) > g.width * 0.3;
    if (commit && armed && g.dx < 0) {
      setX(-g.width, true);
      window.setTimeout(() => void deleteWithUndo(note), 180);
      return;
    }
    setX(0, true);
    window.setTimeout(() => setSwipe(null), 220);
    if (commit && armed && g.dx > 0) void toggleFavorite(note);
  };

  return (
    <li ref={rowRef} className="m-note-row relative overflow-hidden" data-note-id={note.id}>
      {swipe && (
        <div
          aria-hidden="true"
          className={cn(
            'absolute inset-0 flex items-center px-7 transition-colors duration-150',
            swipe.side === 'left' ? 'justify-end' : 'justify-start',
            swipe.side === 'left'
              ? swipe.armed ? 'bg-m-danger text-white' : 'bg-m-fill text-m-danger'
              : swipe.armed ? 'bg-m-star text-white' : 'bg-m-fill text-m-star',
          )}
        >
          <span className={cn('transition-transform duration-150', swipe.armed && 'scale-125')}>
            {swipe.side === 'left' ? <Trash2 size={22} /> : note.starred ? <StarOff size={22} /> : <Star size={22} />}
          </span>
        </div>
      )}
      <button
        ref={slideRef}
        type="button"
        data-note-row
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          onOpen(note);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          if (gesture.current?.dir === 'h') return;
          // A finger still down will lift and click; that click belongs to the long press.
          if (gesture.current) {
            window.clearTimeout(gesture.current.timer);
            gesture.current = null;
            suppressClick.current = true;
          }
          onMenu(note);
        }}
        onPointerDown={(event) => {
          suppressClick.current = false;
          if (event.pointerType === 'mouse') return;
          const width = rowRef.current?.offsetWidth ?? 400;
          const timer = window.setTimeout(() => {
            const g = gesture.current;
            if (!g || g.dir) return;
            gesture.current = null;
            suppressClick.current = true;
            vibrate(12);
            onMenu(note);
          }, 480);
          gesture.current = { x: event.clientX, y: event.clientY, id: event.pointerId, dir: null, dx: 0, timer, width };
        }}
        onPointerMove={(event) => {
          const g = gesture.current;
          if (!g || g.id !== event.pointerId) return;
          const dx = event.clientX - g.x;
          const dy = event.clientY - g.y;
          if (!g.dir) {
            if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) {
              g.dir = 'h';
              window.clearTimeout(g.timer);
              event.currentTarget.setPointerCapture(event.pointerId);
            } else if (Math.abs(dy) > 10) {
              g.dir = 'v';
              window.clearTimeout(g.timer);
              return;
            } else return;
          }
          if (g.dir !== 'h') return;
          // Past the trigger point the row follows more slowly.
          const limit = g.width * 0.3;
          const eased = Math.abs(dx) > limit ? Math.sign(dx) * (limit + (Math.abs(dx) - limit) * 0.35) : dx;
          g.dx = dx;
          setX(eased, false);
          const armed = Math.abs(dx) > limit;
          const side = dx < 0 ? 'left' : 'right';
          setSwipe((current) => {
            if (current?.armed !== armed && armed) vibrate(10);
            return current?.side === side && current.armed === armed ? current : { side, armed };
          });
        }}
        onPointerUp={() => endGesture(true)}
        onPointerCancel={() => endGesture(false)}
        className="m-chrome relative flex w-full flex-col gap-0.5 bg-m-bg px-[calc(16px+var(--m-safe-left))] py-2.5 text-left active:bg-[color-mix(in_srgb,var(--m-bg),var(--m-text)_5%)]"
      >
        <span className="flex w-full items-baseline gap-3">
          <span className={cn('min-w-0 flex-1 truncate text-[15px] font-semibold leading-snug', untitled ? 'text-m-muted' : 'text-m-text')}>
            {title}
          </span>
          {note.starred && <Star size={14} className="flex-shrink-0 translate-y-[1px] fill-current text-m-star" aria-label="Favorite" />}
          <time dateTime={note.updated_at} className="flex-shrink-0 text-[12px] tabular-nums text-m-faint">
            {shortDate(note.updated_at)}
          </time>
        </span>
        <span className={cn('m-line-clamp-2 text-[13.5px] leading-[1.45]', preview ? 'text-m-muted' : 'italic text-m-faint')}>
          {preview || 'No additional text'}
        </span>
        {(folderName || tags.length > 0) && (
          <span className="mt-0.5 flex min-w-0 items-center gap-2 overflow-hidden text-[12px] text-m-faint">
            {folderName && (
              <span className="flex min-w-0 flex-shrink-0 items-center gap-1">
                <FolderIcon size={12} aria-hidden="true" />
                <span className="max-w-[9rem] truncate">{folderName}</span>
              </span>
            )}
            {tags.slice(0, 3).map((tag) => (
              <span key={tag} className="flex-shrink-0 text-m-accent">#{tag}</span>
            ))}
          </span>
        )}
      </button>
    </li>
  );
});

function EmptyNotes({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center px-8 pb-10 pt-16 text-center">
      <div className="flex size-20 items-center justify-center rounded-[28px] bg-m-accent-soft text-m-accent">
        <NotebookPen size={34} strokeWidth={1.6} aria-hidden="true" />
      </div>
      <h2 className="mt-6 text-xl font-semibold text-m-text">No notes yet</h2>
      <p className="mt-2 max-w-[18rem] text-[15px] leading-relaxed text-m-muted">
        Capture an idea, a list, or a plan. Everything you write stays on this device.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="m-press-scale mt-7 flex h-12 items-center gap-2 rounded-full bg-m-accent px-6 text-[15px] font-semibold text-m-on-accent transition-transform"
      >
        <Pencil size={18} aria-hidden="true" />
        Write your first note
      </button>
    </div>
  );
}

function NoMatches({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center px-8 pb-10 pt-14 text-center">
      <SearchX size={32} strokeWidth={1.6} className="text-m-faint" aria-hidden="true" />
      <p className="mt-4 text-[17px] font-semibold text-m-text">
        {query ? `No results for “${query}”` : 'Nothing here'}
      </p>
      <p className="mt-1.5 max-w-[18rem] text-[15px] leading-relaxed text-m-muted">
        {query ? 'Search looks through titles and note text.' : 'No notes match this filter yet.'}
      </p>
      <button type="button" onClick={onClear} className="m-press mt-5 h-11 rounded-full px-5 text-[15px] font-semibold text-m-accent">
        {query ? 'Clear search' : 'Show all notes'}
      </button>
    </div>
  );
}

function LoadingRows() {
  return (
    <div role="status" aria-label="Loading notes" className="space-y-6 px-5 pt-4">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="space-y-2.5">
          <div className="h-4 animate-pulse rounded-full bg-m-fill motion-reduce:animate-none" style={{ width: `${62 - i * 7}%` }} />
          <div className="h-3 w-[88%] animate-pulse rounded-full bg-m-fill/70 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

export function NotesScreen({ onOpen, onRefresh }: { onOpen: (note: Note) => void; onRefresh: () => Promise<void> }) {
  const notes = useNotesStore((s) => s.notes);
  const folders = useNotesStore((s) => s.folders);
  const isLoading = useNotesStore((s) => s.isLoading);
  const loadError = useNotesStore((s) => s.loadError);
  const hidden = usePendingDeletes((s) => s.ids);
  const snackbarUp = useSnackbar((s) => !!s.snack);

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim());
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [menuNote, setMenuNote] = useState<Note | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [fabCompact, setFabCompact] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastScroll = useRef(0);

  useEffect(() => {
    if (!isLoading) setLoadedOnce(true);
  }, [isLoading]);

  const { pull, refreshing } = usePullToRefresh(scrollRef, onRefresh);

  const visible = useMemo(() => {
    const hiddenIds = new Set(hidden);
    return notes.filter((note) => !hiddenIds.has(note.id));
  }, [notes, hidden]);

  const folderNames = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders]);

  const tagChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of visible) for (const tag of rowInfo(note).tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TAG_CHIPS).map(([tag]) => tag);
  }, [visible]);

  const folderChips = useMemo(() => {
    const used = new Set(visible.map((note) => note.folder_id).filter(Boolean));
    // Top-level folders that hold something, directly or below.
    return folders
      .filter((folder) => !folder.parent_id)
      .filter((folder) => [...folderAndDescendants(folder.id, folders)].some((id) => used.has(id)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [folders, visible]);

  const results = useMemo(() => {
    let list = deferredQuery ? searchWorkspaceNotes(deferredQuery, visible) : [...visible].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    if (filter.kind === 'favorites') list = list.filter((note) => note.starred);
    if (filter.kind === 'folder') {
      const ids = folderAndDescendants(filter.id, folders);
      list = list.filter((note) => note.folder_id && ids.has(note.folder_id));
    }
    if (filter.kind === 'tag') list = list.filter((note) => rowInfo(note).tags.some((t) => t === filter.tag || t.startsWith(`${filter.tag}/`)));
    return list;
  }, [deferredQuery, visible, filter, folders]);

  // A filter whose chip disappeared (its last note was deleted) falls back to all.
  useEffect(() => {
    if (filter.kind === 'tag' && !tagChips.includes(filter.tag)) setFilter({ kind: 'all' });
    if (filter.kind === 'folder' && !folderChips.some((f) => f.id === filter.id)) setFilter({ kind: 'all' });
  }, [filter, tagChips, folderChips]);

  const grouped = useMemo(() => {
    if (deferredQuery) return [{ section: null as Section | null, notes: results }];
    const now = Date.now();
    const groups: Array<{ section: Section | null; notes: Note[] }> = [];
    for (const note of results) {
      const section = sectionFor(note.updated_at, now);
      const last = groups[groups.length - 1];
      if (last?.section === section) last.notes.push(note);
      else groups.push({ section, notes: [note] });
    }
    return groups;
  }, [results, deferredQuery]);

  const onMenu = useCallback((note: Note) => setMenuNote(note), []);
  const create = useCallback(() => void createMobileNote(), []);

  const onScroll = () => {
    const top = scrollRef.current?.scrollTop ?? 0;
    setScrolled(top > 44);
    const delta = top - lastScroll.current;
    if (Math.abs(delta) > 6) setFabCompact(delta > 0 && top > 80);
    lastScroll.current = top;
  };

  const chips: Array<{ key: string; filter: Filter; label: ReactNode; aria?: string }> = [
    { key: 'all', filter: { kind: 'all' }, label: 'All' },
    { key: 'fav', filter: { kind: 'favorites' }, label: <><Star size={14} aria-hidden="true" />Favorites</> },
    ...folderChips.map((folder) => ({ key: `f:${folder.id}`, filter: { kind: 'folder', id: folder.id } as Filter, label: <><FolderIcon size={14} aria-hidden="true" />{folder.name}</>, aria: `Folder ${folder.name}` })),
    ...tagChips.map((tag) => ({ key: `t:${tag}`, filter: { kind: 'tag', tag } as Filter, label: <><Hash size={13} aria-hidden="true" />{tag}</>, aria: `Tag ${tag}` })),
  ];

  const showLoading = isLoading && !loadedOnce && notes.length === 0;
  const empty = !showLoading && !loadError && visible.length === 0;
  const pullProgress = Math.min(1, pull / PULL_TRIGGER);

  return (
    <div className="relative flex h-full flex-col">
      <header
        className={cn(
          'm-chrome relative z-20 flex flex-shrink-0 items-end bg-m-bg pt-(--m-safe-top) transition-[box-shadow] duration-200',
          scrolled && 'shadow-[0_1px_0_var(--m-line)]',
        )}
      >
        <div className="flex h-12 w-full items-center gap-2 pl-[calc(16px+var(--m-safe-left))] pr-[calc(12px+var(--m-safe-right))]">
          <h1 className="min-w-0 truncate text-[22px] font-bold tracking-[-0.015em] text-m-text">Notes</h1>
          {!empty && !showLoading && (
            <span className="text-[13px] tabular-nums text-m-faint">{visible.length}</span>
          )}
          <span className="flex-1" />
          <SyncStatus />
        </div>
      </header>

      {/* Pull-to-refresh indicator */}
      <div
        aria-hidden={!refreshing}
        className="pointer-events-none absolute inset-x-0 z-10 flex justify-center"
        style={{ top: 'calc(var(--m-safe-top) + 48px)' }}
      >
        <div
          role={refreshing ? 'status' : undefined}
          aria-label={refreshing ? 'Refreshing notes' : undefined}
          className="flex size-10 items-center justify-center rounded-full bg-m-raised text-m-accent shadow-(--m-shadow)"
          style={{
            opacity: refreshing ? 1 : pullProgress,
            transform: `translateY(${refreshing ? 16 : pull * 0.6 - 24}px) scale(${refreshing ? 1 : 0.6 + pullProgress * 0.4})`,
            transition: pull ? 'none' : 'transform 200ms var(--m-ease), opacity 200ms',
          }}
        >
          {refreshing ? <RefreshCw size={18} className="m-spin" /> : pullProgress >= 1 ? <RefreshCw size={18} /> : <ArrowDown size={18} style={{ transform: `rotate(${pullProgress * 180}deg)` }} />}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="m-scroll min-h-0 flex-1"
        style={{ paddingBottom: 'calc(var(--m-nav-h) + var(--m-safe-bottom) + 96px)' }}
      >
        <div style={{ transform: pull ? `translateY(${pull * 0.35}px)` : undefined, transition: pull ? 'none' : 'transform 200ms var(--m-ease)' }}>
          {!empty && (
            <div className="px-[calc(12px+var(--m-safe-left))] pb-1.5 pt-1">
              <label className="relative flex h-10 items-center rounded-xl bg-m-fill">
                <Search size={17} className="pointer-events-none absolute left-3.5 text-m-faint" aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search notes"
                  aria-label="Search notes"
                  enterKeyHint="search"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                  className="h-full w-full min-w-0 rounded-xl bg-transparent pl-10 pr-10 text-base text-m-text outline-none placeholder:text-m-faint [&::-webkit-search-cancel-button]:hidden"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setQuery('')}
                    className="m-press absolute right-0 flex size-10 items-center justify-center rounded-xl text-m-muted"
                  >
                    <X size={16} />
                  </button>
                )}
              </label>
            </div>
          )}

          {!empty && (
            <div role="group" aria-label="Filter notes" className="m-chips m-chrome flex gap-1.5 overflow-x-auto px-[calc(12px+var(--m-safe-left))] pb-1 pt-0.5">
              {chips.map((chip) => {
                const selected = sameFilter(filter, chip.filter);
                return (
                  <Chip key={chip.key} label={chip.aria} selected={selected} onClick={() => setFilter(selected ? { kind: 'all' } : chip.filter)}>
                    {chip.label}
                  </Chip>
                );
              })}
            </div>
          )}

          {loadError && (
            <div role="alert" className="mx-4 mt-2 flex items-start gap-3 rounded-2xl bg-m-fill p-4">
              <AlertTriangle size={20} className="mt-0.5 flex-shrink-0 text-m-danger" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-m-text">Notes couldn't be loaded</p>
                <p className="mt-0.5 break-words text-[13px] text-m-muted">{loadError}</p>
              </div>
              <button type="button" onClick={() => void onRefresh()} className="m-press -my-1 h-10 rounded-full px-3 text-[15px] font-semibold text-m-accent">
                Retry
              </button>
            </div>
          )}

          {showLoading && <LoadingRows />}
          {empty && <EmptyNotes onCreate={create} />}
          {!empty && !showLoading && results.length === 0 && (
            <NoMatches
              query={deferredQuery}
              onClear={() => {
                setQuery('');
                setFilter({ kind: 'all' });
              }}
            />
          )}

          {results.length > 0 && (
            <div data-notes-list className="pt-1">
              {grouped.map((group) => (
                <section key={group.section ?? 'results'} aria-label={group.section ?? 'Search results'}>
                  {group.section && (
                    <h2 className="m-chrome sticky top-0 z-[5] bg-m-bg px-[calc(16px+var(--m-safe-left))] pb-1 pt-3 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-m-faint">
                      {group.section}
                    </h2>
                  )}
                  <ul className="m-divided">
                    {group.notes.map((note) => (
                      <NoteRow key={note.id} note={note} folderName={note.folder_id ? folderNames.get(note.folder_id) : undefined} onOpen={onOpen} onMenu={onMenu} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      {!empty && (
        <button
          type="button"
          onClick={create}
          aria-label="New note"
          className={cn(
            'm-press-scale absolute right-[calc(16px+var(--m-safe-right))] z-20 flex h-12 items-center justify-center gap-2 rounded-xl bg-m-accent text-m-on-accent shadow-(--m-shadow) transition-[width,transform] duration-200 ease-[var(--m-ease)] motion-reduce:transition-none',
            fabCompact ? 'w-12' : 'w-[120px]',
          )}
          // Moves up out of the snackbar's way, as on Android.
          style={{ bottom: 'calc(var(--m-nav-h) + var(--m-safe-bottom) + 16px)', transform: snackbarUp ? 'translateY(-68px)' : undefined }}
        >
          <Pencil size={18} aria-hidden="true" className="flex-shrink-0" />
          {!fabCompact && <span className="text-[14px] font-semibold">New note</span>}
        </button>
      )}

      <ActionSheet
        open={!!menuNote}
        title={menuNote ? (menuNote.title && menuNote.title !== 'Untitled' ? menuNote.title : 'Untitled') : undefined}
        subtitle={menuNote ? shortDate(menuNote.updated_at) : undefined}
        onClose={() => setMenuNote(null)}
        actions={menuNote ? [
          { label: 'Open', icon: <FileText size={20} />, onSelect: () => onOpen(menuNote) },
          {
            label: menuNote.starred ? 'Remove from favorites' : 'Add to favorites',
            icon: menuNote.starred ? <StarOff size={20} /> : <Star size={20} />,
            onSelect: () => void toggleFavorite(menuNote),
          },
          { label: 'Delete', icon: <Trash2 size={20} />, danger: true, onSelect: () => void deleteWithUndo(menuNote) },
        ] : []}
      />
    </div>
  );
}
