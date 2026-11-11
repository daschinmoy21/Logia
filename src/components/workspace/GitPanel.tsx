import { useEffect, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { invoke } from '@tauri-apps/api/core';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleArrowUp,
  Check,
  ChevronRight,
  CircleMinus,
  CirclePlus,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  ListTodo,
  Minus,
  PenTool,
  Plus,
  RefreshCw,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { useNotesStore } from '../../store/notesStore';
import { useGitStore, type GitFileChange } from '../../store/gitStore';
import { IconButton, Tip } from '../ui/kit';
import { openNote } from './actions';
import { ConfirmDialog } from './WorkspaceMenus';

const DEFAULT_MESSAGE = 'logia backup: {{date}}';
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** `{{date}}` becomes local time, like Obsidian Git's default message. */
function fillMessage(template: string) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return template.split('{{date}}').join(date);
}

const STATUS_STYLE: Record<string, { text: string; title: string }> = {
  U: { text: 'text-emerald-400', title: 'Untracked' },
  A: { text: 'text-emerald-400', title: 'Added' },
  M: { text: 'text-amber-300', title: 'Modified' },
  D: { text: 'text-red-400', title: 'Deleted' },
  R: { text: 'text-sky-400', title: 'Renamed' },
  C: { text: 'text-sky-400', title: 'Copied' },
  T: { text: 'text-amber-300', title: 'Type changed' },
};

interface Described {
  label: string;
  detail?: string;
  icon: ReactNode;
  noteId?: string;
}

/** Files are named by uuid on disk, so show what each one is in the app instead. */
function useDescribe() {
  const notes = useNotesStore((s) => s.notes);
  const folders = useNotesStore((s) => s.folders);
  return (path: string): Described => {
    const [dir, file = ''] = path.split('/');
    const id = file.replace(/\.json$/, '');
    if (dir === 'notes' && file) {
      const note = notes.find((n) => n.id === id);
      return {
        label: note ? note.title || 'Untitled' : `Removed note`,
        detail: note ? undefined : id.slice(0, 8),
        icon: note?.note_type === 'canvas' ? <PenTool size={12} /> : <FileText size={12} />,
        noteId: note?.id,
      };
    }
    if (dir === 'folders' && file) {
      const folder = folders.find((f) => f.id === id);
      return { label: folder?.name ?? 'Removed folder', detail: folder ? 'folder' : id.slice(0, 8), icon: <Folder size={12} /> };
    }
    if (dir === 'trash') return { label: 'Trash', detail: file.slice(0, 8), icon: <Trash2 size={12} /> };
    if (dir === 'kanban') return { label: 'Tasks board', detail: file, icon: <ListTodo size={12} /> };
    return { label: path, icon: <FileText size={12} /> };
  };
}

/** Write any pending edit to disk first, so a commit includes what's on screen. */
async function flushSaves() {
  const store = useNotesStore.getState();
  if (store.saveTimeout || store.isSaving) await store.saveCurrentNote();
}

/**
 * Notes changed on disk underneath the app. Reload the lists, and remount the open note
 * from its file so autosave doesn't write the old text back.
 */
async function reloadFromDisk(paths: string[] | 'all') {
  const store = useNotesStore.getState();
  await Promise.all([store.loadNotes(), store.loadFolders()]);
  const current = store.currentNote;
  if (!current) return;
  if (paths !== 'all' && !paths.includes(`notes/${current.id}.json`)) return;
  const fresh = useNotesStore.getState().notes.find((n) => n.id === current.id) ?? null;
  useNotesStore.setState({ currentNote: null });
  await new Promise((resolve) => requestAnimationFrame(resolve));
  if (fresh) useNotesStore.setState({ currentNote: fresh });
}


function FileRow({
  change,
  staged,
  describe,
  disabled,
  onStage,
  onUnstage,
  onDiscard,
}: {
  change: GitFileChange;
  staged: boolean;
  describe: (path: string) => Described;
  disabled: boolean;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
}) {
  const info = describe(change.path);
  const style = STATUS_STYLE[change.status] ?? { text: 'text-zinc-400', title: change.status };
  const open = () => {
    const note = info.noteId ? useNotesStore.getState().notes.find((n) => n.id === info.noteId) : undefined;
    if (note) void openNote(note);
  };
  const action = 'flex size-5 items-center justify-center rounded text-zinc-400 hover:bg-white/10 hover:text-zinc-100 disabled:opacity-40';

  return (
    <div className="group flex h-7 items-center gap-1.5 rounded-[5px] pl-5 pr-1 text-[13px] text-zinc-300 hover:bg-white/[0.06]">
      <button
        type="button"
        onClick={open}
        disabled={!info.noteId}
        title={change.path}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:cursor-default"
      >
        <span className="flex-shrink-0 text-zinc-500" aria-hidden="true">{info.icon}</span>
        <span className={`min-w-0 truncate ${change.status === 'D' ? 'line-through decoration-zinc-600' : ''}`}>{info.label}</span>
        {info.detail && <span className="flex-shrink-0 font-mono text-[10px] text-zinc-600">{info.detail}</span>}
      </button>
      <div className="flex items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
        {staged ? (
          <Tip label="Unstage"><button type="button" aria-label={`Unstage ${info.label}`} disabled={disabled} onClick={onUnstage} className={action}><Minus size={13} /></button></Tip>
        ) : (
          <>
            <Tip label="Discard changes"><button type="button" aria-label={`Discard changes to ${info.label}`} disabled={disabled} onClick={onDiscard} className={action}><Undo2 size={13} /></button></Tip>
            <Tip label="Stage"><button type="button" aria-label={`Stage ${info.label}`} disabled={disabled} onClick={onStage} className={action}><Plus size={13} /></button></Tip>
          </>
        )}
      </div>
      <span className={`w-3 flex-shrink-0 text-center font-mono text-[11px] ${style.text}`} title={style.title}>{change.status}</span>
    </div>
  );
}

function Section({
  title,
  count,
  actions,
  children,
}: {
  title: string;
  count: number;
  actions: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section aria-label={title}>
      <div className="group flex h-7 items-center gap-1 rounded-[5px] pl-1 pr-1 text-[12px] text-zinc-400 hover:bg-white/[0.04]">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1 text-left">
          <ChevronRight size={13} className={`flex-shrink-0 text-zinc-500 ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
          <span className="truncate">{title}</span>
        </button>
        <div className="flex items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">{actions}</div>
        <span className="min-w-5 rounded-full bg-white/[0.06] px-1.5 text-center font-mono text-[10px] text-zinc-400">{count}</span>
      </div>
      {open && children}
    </section>
  );
}

export function GitPanel() {
  const status = useGitStore((s) => s.status);
  const error = useGitStore((s) => s.error);
  const busy = useGitStore((s) => s.busy);
  const refresh = useGitStore((s) => s.refresh);
  const run = useGitStore((s) => s.run);
  const describe = useDescribe();
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [pendingDiscard, setPendingDiscard] = useState<string[] | null>(null);

  useEffect(() => { void refresh(); }, [refresh]);

  const attempt = async <T,>(label: string, action: () => Promise<T>) => {
    try {
      return await run(label, action);
    } catch (err) {
      toast.error(errorText(err));
      return undefined;
    }
  };

  if (!status) {
    return <div className="px-3 py-4 text-[12px] text-zinc-500">{error ?? 'Reading git status…'}</div>;
  }
  if (!status.git_available) {
    return <div className="px-3 py-4 text-[12px] text-zinc-500">git isn’t installed or isn’t on PATH.</div>;
  }
  if (!status.repo) {
    return (
      <div className="space-y-3 px-3 py-4 text-[12px] text-zinc-400">
        <p>Your notes folder isn’t tracked by git yet. Start a repository to keep version history, and add a remote in Settings → Sync to back it up.</p>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void attempt('init', () => invoke('git_panel_init'))}
          className="flex h-7 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-[12px] text-zinc-200 hover:border-zinc-700 hover:bg-zinc-800 disabled:opacity-50"
        >
          <GitBranch size={13} aria-hidden="true" /> Start a repository
        </button>
      </div>
    );
  }

  const { staged, unstaged, remote } = status;
  const anyChanges = staged.length + unstaged.length > 0;
  const isBusy = !!busy;

  const commit = async () => {
    await flushSaves();
    await useGitStore.getState().refresh();
    const sha = await attempt('commit', () =>
      invoke<string>('git_panel_commit', { message: fillMessage(message), stageAll: true }),
    );
    if (sha) toast.success(`Committed ${sha}`);
    return !!sha;
  };

  const pull = async (quiet = false) => {
    const result = await attempt('pull', () => invoke<{ message: string; needs_reload: boolean }>('git_panel_pull'));
    if (!result) return false;
    if (result.needs_reload) await reloadFromDisk('all');
    if (!quiet) toast.success(result.message);
    return true;
  };

  const push = async () => {
    const result = await attempt('push', () => invoke<string>('git_panel_push'));
    if (result) toast.success(result);
    return !!result;
  };

  const commitAndSync = async () => {
    await flushSaves();
    await useGitStore.getState().refresh();
    const latest = useGitStore.getState().status;
    if (latest && latest.staged.length + latest.unstaged.length > 0 && !(await commit())) return;
    if (!remote) {
      toast('Committed locally. Add a remote in Settings → Sync to back it up.');
      return;
    }
    if (!(await pull(true))) return;
    if (await push()) toast.success('Synced');
  };

  const discard = async (paths: string[]) => {
    setPendingDiscard(null);
    await flushSaves();
    const done = await attempt('discard', async () => { await invoke('git_panel_discard', { paths }); return true; });
    if (done) await reloadFromDisk(paths);
  };

  const sync = remote ? (status.ahead || status.behind ? ` · ↑${status.ahead} ↓${status.behind}` : '') : ' · no remote';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-shrink-0 items-center justify-between gap-0.5 px-1.5 pb-1.5">
        <IconButton label="Commit and sync" hint={remote ? 'Commit all, pull, then push' : 'Commit all (no remote set)'} disabled={isBusy} onClick={() => void commitAndSync()}>
          <CircleArrowUp size={15} />
        </IconButton>
        <IconButton label="Commit" hint={staged.length ? 'Commit staged changes' : 'Commit all changes'} disabled={isBusy || !anyChanges} onClick={() => void commit()}>
          <Check size={15} />
        </IconButton>
        <IconButton label="Stage all" disabled={isBusy || !unstaged.length} onClick={() => void attempt('stage', () => invoke('git_panel_stage_all'))}>
          <CirclePlus size={15} />
        </IconButton>
        <IconButton label="Unstage all" disabled={isBusy || !staged.length} onClick={() => void attempt('unstage', () => invoke('git_panel_unstage_all'))}>
          <CircleMinus size={15} />
        </IconButton>
        <IconButton label="Push" disabled={isBusy || !remote} onClick={() => void push()}>
          <ArrowUpFromLine size={15} />
        </IconButton>
        <IconButton label="Pull" disabled={isBusy || !remote} onClick={() => void pull()}>
          <ArrowDownToLine size={15} />
        </IconButton>
        <IconButton label="Show notes folder" onClick={() => void revealItemInDir(status.root).catch((err) => toast.error(errorText(err)))}>
          <FolderOpen size={15} />
        </IconButton>
        <IconButton label="Refresh" disabled={isBusy} onClick={() => void refresh()}>
          <RefreshCw size={15} className={isBusy ? 'animate-spin' : ''} />
        </IconButton>
      </div>

      <div className="flex-shrink-0 px-1.5 pb-1">
        <div className="flex h-8 items-center gap-1 rounded-md border border-zinc-800 bg-white/[0.02] pl-2 pr-1 focus-within:border-zinc-600">
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !isBusy && anyChanges) void commit();
            }}
            aria-label="Commit message"
            placeholder="Commit message"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600"
          />
          {message !== DEFAULT_MESSAGE && (
            <Tip label="Reset message"><button type="button" aria-label="Reset commit message" onClick={() => setMessage(DEFAULT_MESSAGE)} className="flex size-5 items-center justify-center rounded text-zinc-500 hover:bg-white/10 hover:text-zinc-200"><X size={12} /></button></Tip>
          )}
        </div>
        <div className="truncate px-1 pt-1 font-mono text-[10px] text-zinc-600">
          <GitBranch size={10} className="mr-1 inline" aria-hidden="true" />
          {status.branch}{sync}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        <Section
          title="Staged Changes"
          count={staged.length}
          actions={staged.length > 0 && (
            <Tip label="Unstage all"><button type="button" aria-label="Unstage all" disabled={isBusy} onClick={() => void attempt('unstage', () => invoke('git_panel_unstage_all'))} className="flex size-5 items-center justify-center rounded hover:bg-white/10 hover:text-zinc-100"><Minus size={13} /></button></Tip>
          )}
        >
          {staged.map((change) => (
            <FileRow
              key={`s:${change.path}`}
              change={change}
              staged
              describe={describe}
              disabled={isBusy}
              onStage={() => {}}
              onUnstage={() => void attempt('unstage', () => invoke('git_panel_unstage', { paths: [change.path] }))}
              onDiscard={() => {}}
            />
          ))}
        </Section>
        <Section
          title="Changes"
          count={unstaged.length}
          actions={unstaged.length > 0 && (
            <>
              <Tip label="Discard all"><button type="button" aria-label="Discard all changes" disabled={isBusy} onClick={() => setPendingDiscard(unstaged.map((c) => c.path))} className="flex size-5 items-center justify-center rounded hover:bg-white/10 hover:text-zinc-100"><Undo2 size={13} /></button></Tip>
              <Tip label="Stage all"><button type="button" aria-label="Stage all" disabled={isBusy} onClick={() => void attempt('stage', () => invoke('git_panel_stage_all'))} className="flex size-5 items-center justify-center rounded hover:bg-white/10 hover:text-zinc-100"><Plus size={13} /></button></Tip>
            </>
          )}
        >
          {unstaged.map((change) => (
            <FileRow
              key={`u:${change.path}`}
              change={change}
              staged={false}
              describe={describe}
              disabled={isBusy}
              onStage={() => void attempt('stage', () => invoke('git_panel_stage', { paths: [change.path] }))}
              onUnstage={() => {}}
              onDiscard={() => setPendingDiscard([change.path])}
            />
          ))}
        </Section>
        {!anyChanges && <p className="px-3 py-3 text-[12px] text-zinc-600">No changes. Everything is committed.</p>}
      </div>
      <ConfirmDialog
        open={!!pendingDiscard}
        title={pendingDiscard?.length === 1 ? 'Discard changes to this file?' : `Discard changes to ${pendingDiscard?.length ?? 0} files?`}
        body="Changed files go back to their last committed or staged version, and new files are deleted. This can’t be undone."
        confirmLabel="Discard"
        onConfirm={() => { if (pendingDiscard) void discard(pendingDiscard); }}
        onClose={() => setPendingDiscard(null)}
      />
    </div>
  );
}

/** Keep the change count fresh while the app is visible: on focus, after saves, and on a slow timer. */
export function useGitPolling(enabled: boolean) {
  const refresh = useGitStore((s) => s.refresh);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const tick = () => { if (!document.hidden) void refresh(); };
    const timer = window.setInterval(tick, 8000);
    window.addEventListener('focus', tick);
    const unsubscribe = useNotesStore.subscribe((state, previous) => {
      if (previous.isSaving && !state.isSaving) tick();
    });
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
      unsubscribe();
    };
  }, [enabled, refresh]);
}

