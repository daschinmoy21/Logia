import { useEffect, useMemo, type ReactNode } from 'react';
import { AlertTriangle, ArrowUpRight, ChevronRight, FileText, FilePlus2, X } from 'lucide-react';
import { findWikiLinkCandidates, getBacklinks, getNoteHeadings, getNoteTags, getWikiLinks, notePreview, resolveWikiLink } from '../../lib/workspace';
import type { Folder, Note } from '../../types/Note';
import { createNoteFromLink, folderPath, openNote, openPalette, revealBlock } from './actions';
import { shortcutAria, SHORTCUTS } from './shortcuts';
import { IconButton } from '../ui/kit';

const rowClass = 'flex w-full min-w-0 items-start gap-2 rounded-[5px] px-2 py-1 text-left text-[13px] leading-5 text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-100';

let backlinkCache: { noteId: string; notes: Note[] | null; folders: Folder[] | null; value: Note[] } = {
  noteId: '',
  notes: null,
  folders: null,
  value: [],
};

/** Backlinks parse every note. `notes` comes from useLinkNotes, so typing keeps this cached. */
export function cachedBacklinks(note: Note, notes: Note[], folders: Folder[]): Note[] {
  if (backlinkCache.noteId !== note.id || backlinkCache.notes !== notes || backlinkCache.folders !== folders) {
    backlinkCache = { noteId: note.id, notes, folders, value: getBacklinks(note, notes, folders) };
  }
  return backlinkCache.value;
}

function Section({
  id,
  title,
  count,
  children,
}: {
  id?: string;
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <details id={id} open className="group/section">
      <summary className="flex h-7 cursor-default select-none list-none items-center gap-1 px-3 font-mono text-[11px] text-zinc-500 hover:text-zinc-300 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={11} aria-hidden="true" className="group-open/section:rotate-90" />
        <span>{title}</span>
        {count !== undefined && count > 0 && <span className="ml-auto tabular-nums font-normal text-zinc-500">{count}</span>}
      </summary>
      <div className="px-1.5 pb-3">{children}</div>
    </details>
  );
}

const Hint = ({ children }: { children: ReactNode }) => (
  <p className="px-2 py-1 text-xs leading-5 text-zinc-500">{children}</p>
);

const noteTitle = (note: Note) => note.title || 'Untitled';

function NoteLinkRow({ note, folders, heading, onNavigate }: { note: Note; folders: Folder[]; heading?: string; onNavigate: () => void }) {
  const path = folderPath(note.folder_id, folders, ' / ');
  return (
    <button
      type="button"
      className={rowClass}
      onClick={() => {
        onNavigate();
        openNote(note, heading);
      }}
    >
      <FileText size={13} className="mt-1 flex-shrink-0 text-zinc-500" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{noteTitle(note)}</span>
        {path && <span className="block truncate text-xs text-zinc-500">{path}</span>}
      </span>
    </button>
  );
}

function OutgoingLink({
  link,
  notes,
  folders,
  onNavigate,
}: {
  link: { target: string; alias?: string; heading?: string };
  notes: Note[];
  folders: Folder[];
  onNavigate: () => void;
}) {
  const label = link.alias || link.target;
  const headingLabel = link.heading ? `# ${link.heading}` : null;
  const resolved = resolveWikiLink(link.target, notes, folders);

  if (resolved) {
    return (
      <li>
        <button
          type="button"
          className={rowClass}
          title={`Open ${noteTitle(resolved)}${link.heading ? ` at ${link.heading}` : ''}`}
          onClick={() => {
            onNavigate();
            openNote(resolved, link.heading);
          }}
        >
          <ArrowUpRight size={13} className="mt-1 flex-shrink-0 text-zinc-500" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{label}</span>
            {(headingLabel || label !== noteTitle(resolved)) && (
              <span className="block truncate text-xs text-zinc-500">
                {label !== noteTitle(resolved) ? noteTitle(resolved) : ''} {headingLabel}
              </span>
            )}
          </span>
        </button>
      </li>
    );
  }

  const candidates = findWikiLinkCandidates(link.target, notes, folders);
  if (candidates.length > 1) {
    return (
      <li className="rounded-md px-2 py-1.5">
        <p className="flex items-center gap-1.5 text-[13px] text-amber-200/90">
          <AlertTriangle size={13} className="flex-shrink-0" aria-hidden="true" />
          <span className="truncate">{label}</span>
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">{candidates.length} notes share this name. Choose one:</p>
        <div className="-mx-2 mt-1">
          {candidates.map((note) => (
            <NoteLinkRow key={note.id} note={note} folders={folders} heading={link.heading} onNavigate={onNavigate} />
          ))}
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2 rounded-md px-2 py-1">
      <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-500 underline decoration-dashed decoration-zinc-600 underline-offset-2" title={`No note named ${link.target}`}>
        {label}
        <span className="sr-only"> (note doesn't exist yet)</span>
      </span>
      <button
        type="button"
        onClick={() => {
          onNavigate();
          createNoteFromLink(link.target);
        }}
        aria-label={`Create note ${link.target}`}
        className={`inline-flex flex-shrink-0 items-center gap-1 rounded border border-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800`}
      >
        <FilePlus2 size={12} aria-hidden="true" />
        Create
      </button>
    </li>
  );
}

export function NoteContextPanel({
  note,
  notes,
  folders,
  editor,
  backlinks,
  compact,
  onClose,
}: {
  note: Note;
  notes: Note[];
  folders: Folder[];
  editor: any;
  backlinks: Note[];
  compact: boolean;
  onClose: () => void;
}) {
  const headings = useMemo(() => getNoteHeadings(note.content), [note.content]);
  const tags = useMemo(() => getNoteTags(note.content), [note.content]);
  const links = useMemo(() => getWikiLinks(note.content), [note.content]);
  const minLevel = headings.length ? Math.min(...headings.map((h) => h.level)) : 1;

  // As an overlay the panel hides the text it's pointing at, so get out of the way.
  const afterNavigate = () => {
    if (compact) onClose();
  };

  useEffect(() => {
    if (!compact) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (e.target as Element | null)?.closest?.('[data-note-context-panel]')) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [compact, onClose]);

  return (
    <aside
      data-note-context-panel
      aria-label="Note context"
      className={`flex h-full flex-shrink-0 flex-col border-l border-zinc-800 bg-zinc-950 ${
        compact ? 'absolute right-0 top-0 z-30 w-[min(20rem,88%)] shadow-2xl shadow-black/60' : 'w-60'
      }`}
    >
      {compact && (
        <div className="flex h-9 flex-shrink-0 items-center justify-between pl-3 pr-1.5">
          <h2 className="text-xs font-medium text-zinc-300">Note context</h2>
          <IconButton label="Close note context" hint="Close" shortcut={SHORTCUTS.contextPanel} aria-keyshortcuts={shortcutAria(SHORTCUTS.contextPanel)} onClick={onClose}>
            <X size={14} />
          </IconButton>
        </div>
      )}

      <div className={`min-h-0 flex-1 overflow-y-auto ${compact ? '' : 'pt-1.5'}`}>
        <Section title="Outline" count={headings.length}>
          {headings.length === 0 ? (
            <Hint>Headings you add will appear here so you can jump between them.</Hint>
          ) : (
            <nav aria-label="Note outline">
              <ul>
                {headings.map((heading) => (
                  <li key={heading.id}>
                    <button
                      type="button"
                      onClick={() => {
                        afterNavigate();
                        revealBlock(editor, heading.id);
                      }}
                      style={{ paddingLeft: `${0.5 + (heading.level - minLevel) * 0.75}rem` }}
                      title={heading.text}
                      className={`block w-full truncate rounded-[5px] py-1 pr-2 text-left text-[13px] text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-100`}
                    >
                      {heading.text}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </Section>

        <Section title="Tags" count={tags.length}>
          {tags.length === 0 ? (
            <Hint>Type #topic in this note to tag it.</Hint>
          ) : (
            <div className="flex flex-wrap gap-1 px-1.5 py-0.5">
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => openPalette('notes', `#${tag}`)}
                  title={`Find notes tagged #${tag}`}
                  className={`max-w-full truncate rounded-[5px] bg-white/[0.06] px-1.5 py-0.5 text-xs text-zinc-300 hover:bg-white/10 hover:text-zinc-100`}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </Section>

        <Section title="Links" count={links.length}>
          {links.length === 0 ? (
            <Hint>Type [[Note title]] to link to another note. Links to notes that don't exist yet can be created here.</Hint>
          ) : (
            <ul>
              {links.map((link) => (
                <OutgoingLink
                  key={`${link.target}#${link.heading ?? ''}`}
                  link={link}
                  notes={notes}
                  folders={folders}
                  onNavigate={afterNavigate}
                />
              ))}
            </ul>
          )}
        </Section>

        <Section id="note-context-backlinks" title="Backlinks" count={backlinks.length}>
          {backlinks.length === 0 ? (
            <Hint>Notes that link here with [[{noteTitle(note)}]] will appear here.</Hint>
          ) : (
            <ul>
              {backlinks.map((source) => {
                const preview = notePreview(source, 90);
                return (
                  <li key={source.id}>
                    <button
                      type="button"
                      className={rowClass}
                      onClick={() => {
                        afterNavigate();
                        openNote(source);
                      }}
                    >
                      <FileText size={13} className="mt-1 flex-shrink-0 text-zinc-500" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{noteTitle(source)}</span>
                        {preview && <span className="line-clamp-2 block text-xs leading-4 text-zinc-500">{preview}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </aside>
  );
}
