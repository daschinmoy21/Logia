import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, Check, ChevronDown, ListTodo, Pencil, Plus, Trash2 } from 'lucide-react';
import { placeTask, taskProgress, type KanbanTask } from '../lib/tasks';
import { cn } from '../lib/utils';
import { loadTasks, saveTasks } from './tasksRepository';
import { ActionSheet, useEscape } from './ui';
import { useBackLayer } from './backStack';
import { useSnackbar, showSnackbar } from './snackbar';
import { describeError } from './noteActions';

function TaskRow({
  task,
  onToggle,
  onMenu,
}: {
  task: KanbanTask;
  onToggle: (task: KanbanTask) => void;
  onMenu: (task: KanbanTask) => void;
}) {
  const done = task.column === 'done';
  return (
    <li className="m-chrome relative flex min-h-14 items-center" aria-label={`${task.name}${done ? ', done' : task.column === 'in-progress' ? ', in progress' : ''}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark “${task.name}” as not done` : `Mark “${task.name}” as done`}
        onClick={() => onToggle(task)}
        className="flex size-14 flex-shrink-0 items-center justify-center pl-[var(--m-safe-left)]"
      >
        <span
          className={cn(
            'flex size-[22px] items-center justify-center rounded-full border-2 transition-colors duration-150 motion-reduce:transition-none',
            done ? 'border-m-accent bg-m-accent text-m-on-accent' : 'border-m-faint',
          )}
          aria-hidden="true"
        >
          {done && <Check size={14} strokeWidth={3} />}
        </span>
      </button>
      <button
        type="button"
        aria-label={`${task.name}, options`}
        onClick={() => onMenu(task)}
        onContextMenu={(event) => {
          event.preventDefault();
          onMenu(task);
        }}
        className="m-press flex min-h-14 min-w-0 flex-1 items-center gap-2 py-3 pr-[calc(16px+var(--m-safe-right))] text-left"
      >
        <span className={cn('min-w-0 flex-1 break-words text-base leading-snug', done ? 'text-m-faint line-through decoration-m-faint/60' : 'text-m-text')}>
          {task.name}
        </span>
        {task.column === 'in-progress' && (
          <span className="flex-shrink-0 rounded-full bg-m-accent-soft px-2.5 py-0.5 text-[12.5px] font-semibold text-m-accent">Doing</span>
        )}
      </button>
    </li>
  );
}

function RenameSheet({ task, onClose, onSave }: { task: KanbanTask | null; onClose: () => void; onSave: (name: string) => void }) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useBackLayer(!!task, onClose);
  useEscape(!!task, onClose);
  useEffect(() => {
    if (!task) return;
    setValue(task.name);
    const id = window.setTimeout(() => inputRef.current?.select(), 30);
    return () => window.clearTimeout(id);
  }, [task]);
  if (!task) return null;
  const submit = () => {
    const name = value.trim();
    if (name) onSave(name);
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[60]" data-mobile-layer>
      <div className="m-anim-fade absolute inset-0 bg-(--m-scrim)" onClick={onClose} aria-hidden="true" />
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Rename task"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="m-anim-sheet absolute inset-x-0 bottom-0 rounded-t-[28px] bg-m-raised px-5 pb-[calc(16px+var(--m-safe-bottom))] pt-5 shadow-(--m-shadow)"
      >
        <h2 className="m-chrome text-[17px] font-semibold">Rename task</h2>
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label="Task name"
          enterKeyHint="done"
          className="mt-4 h-12 w-full rounded-2xl bg-m-fill px-4 text-base text-m-text outline-none focus:ring-2 focus:ring-m-accent"
        />
        <div className="m-chrome mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="m-press h-11 rounded-full px-5 text-[15px] font-semibold text-m-muted">Cancel</button>
          <button type="submit" disabled={!value.trim()} className="m-press-scale h-11 rounded-full bg-m-accent px-5 text-[15px] font-semibold text-m-on-accent disabled:opacity-40">Save</button>
        </div>
      </form>
    </div>
  );
}

export function TasksScreen() {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState('');
  const [menuTask, setMenuTask] = useState<KanbanTask | null>(null);
  const [renaming, setRenaming] = useState<KanbanTask | null>(null);
  const [showDone, setShowDone] = useState(true);
  const latest = useRef<KanbanTask[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const loaded = await loadTasks();
      latest.current = loaded;
      setTasks(loaded);
      setStatus('ready');
    } catch (error) {
      setLoadError(describeError(error));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Optimistic: the list changes now, and a failed write says so. */
  const commit = (next: KanbanTask[]) => {
    latest.current = next;
    setTasks(next);
    saveTasks(next).catch((error) => showSnackbar(`Tasks weren't saved: ${describeError(error)}`));
  };

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    const now = new Date().toISOString();
    commit([...latest.current, { id: crypto.randomUUID(), name, column: 'todo', created_at: now, updated_at: now }]);
    setDraft('');
  };

  const toggle = (task: KanbanTask) => {
    const next = task.column === 'done' ? 'todo' : 'done';
    commit(placeTask(latest.current, task.id, next));
  };

  const remove = (task: KanbanTask) => {
    const before = latest.current;
    const index = before.findIndex((t) => t.id === task.id);
    commit(before.filter((t) => t.id !== task.id));
    useSnackbar.getState().show({
      message: 'Task deleted',
      actionLabel: 'Undo',
      onClose: (reason) => {
        if (reason !== 'action' || latest.current.some((t) => t.id === task.id)) return;
        const restored = [...latest.current];
        restored.splice(Math.min(index, restored.length), 0, task);
        commit(restored);
      },
    });
  };

  const open = tasks.filter((t) => t.column !== 'done');
  const done = tasks.filter((t) => t.column === 'done');
  const { total, percent } = taskProgress(tasks);

  return (
    <div className="flex h-full flex-col">
      <header className="m-chrome flex-shrink-0 pt-(--m-safe-top)">
        <div className="flex h-12 items-center px-[calc(16px+var(--m-safe-left))]">
          <h1 className="text-[22px] font-bold tracking-[-0.015em]">Tasks</h1>
        </div>
      </header>
      <div className="m-scroll min-h-0 flex-1" style={{ paddingBottom: 'calc(var(--m-nav-h) + var(--m-safe-bottom) + 24px)' }}>
        <div className="m-chrome px-[calc(16px+var(--m-safe-left))] pb-2 pt-1">
          {status === 'ready' && total > 0 && (
            <div className="flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-m-fill" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Tasks done">
                <div className="h-full rounded-full bg-m-accent transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
              </div>
              <span className="text-[13px] tabular-nums text-m-faint">{done.length} of {total} done</span>
            </div>
          )}
        </div>

        <form
          className="px-[calc(12px+var(--m-safe-left))] pb-2 pt-1"
          onSubmit={(event) => {
            event.preventDefault();
            add();
            inputRef.current?.focus();
          }}
        >
          <label className="relative flex h-11 items-center rounded-xl bg-m-fill">
            <Plus size={18} className="pointer-events-none absolute left-3.5 text-m-faint" aria-hidden="true" />
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add a task"
              aria-label="New task"
              enterKeyHint="done"
              disabled={status !== 'ready'}
              className="h-full w-full min-w-0 rounded-xl bg-transparent pl-10 pr-24 text-base text-m-text outline-none placeholder:text-m-faint"
            />
            {draft.trim() && (
              <button type="submit" className="m-press-scale absolute right-1.5 h-11 rounded-xl bg-m-accent px-4 text-[15px] font-semibold text-m-on-accent">
                Add
              </button>
            )}
          </label>
        </form>

        {status === 'loading' && (
          <div role="status" aria-label="Loading tasks" className="space-y-5 px-5 pt-5">
            {[0, 1, 2].map((i) => <div key={i} className="h-4 animate-pulse rounded-full bg-m-fill motion-reduce:animate-none" style={{ width: `${70 - i * 12}%` }} />)}
          </div>
        )}

        {status === 'error' && (
          <div role="alert" className="mx-4 mt-3 flex items-start gap-3 rounded-2xl bg-m-fill p-4">
            <AlertTriangle size={20} className="mt-0.5 flex-shrink-0 text-m-danger" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold">Tasks couldn't be loaded</p>
              <p className="mt-0.5 break-words text-[13px] text-m-muted">{loadError}</p>
            </div>
            <button type="button" onClick={() => void load()} className="m-press -my-1 h-10 rounded-full px-3 text-[15px] font-semibold text-m-accent">Retry</button>
          </div>
        )}

        {status === 'ready' && total === 0 && (
          <div className="m-chrome flex flex-col items-center px-8 pt-14 text-center">
            <div className="flex size-20 items-center justify-center rounded-[28px] bg-m-accent-soft text-m-accent">
              <ListTodo size={34} strokeWidth={1.6} aria-hidden="true" />
            </div>
            <p className="mt-6 text-xl font-semibold">Nothing to do</p>
            <p className="mt-2 max-w-[18rem] text-[15px] leading-relaxed text-m-muted">Add a task above. It shows up on the desktop board too.</p>
          </div>
        )}

        {status === 'ready' && open.length > 0 && (
          <ul aria-label="To do" className="m-divided mt-1 [--m-divider-start:56px]">
            {open.map((task) => <TaskRow key={task.id} task={task} onToggle={toggle} onMenu={setMenuTask} />)}
          </ul>
        )}

        {status === 'ready' && open.length === 0 && done.length > 0 && (
          <p className="m-chrome px-5 pb-2 pt-6 text-center text-[15px] text-m-muted">All done. Nice work.</p>
        )}

        {status === 'ready' && done.length > 0 && (
          <section className="mt-4">
            <button
              type="button"
              aria-expanded={showDone}
              onClick={() => setShowDone((v) => !v)}
              className="m-chrome m-press flex h-12 w-full items-center gap-2 px-[calc(20px+var(--m-safe-left))] text-left text-[13px] font-semibold uppercase tracking-[0.06em] text-m-faint"
            >
              Completed · {done.length}
              <ChevronDown size={16} className={cn('transition-transform duration-200 motion-reduce:transition-none', !showDone && '-rotate-90')} aria-hidden="true" />
            </button>
            {showDone && (
              <ul aria-label="Completed" className="m-divided [--m-divider-start:56px]">
                {done.map((task) => <TaskRow key={task.id} task={task} onToggle={toggle} onMenu={setMenuTask} />)}
              </ul>
            )}
          </section>
        )}
      </div>

      <ActionSheet
        open={!!menuTask}
        title={menuTask?.name}
        onClose={() => setMenuTask(null)}
        actions={menuTask ? [
          { label: 'Rename', icon: <Pencil size={20} />, onSelect: () => setRenaming(menuTask) },
          ...(menuTask.column !== 'done' ? [{
            label: menuTask.column === 'in-progress' ? 'Move back to To do' : 'Mark as doing',
            icon: <ArrowRightLeft size={20} />,
            onSelect: () => commit(placeTask(latest.current, menuTask.id, menuTask.column === 'in-progress' ? 'todo' : 'in-progress')),
          }] : []),
          { label: 'Delete', icon: <Trash2 size={20} />, danger: true, onSelect: () => remove(menuTask) },
        ] : []}
      />
      <RenameSheet
        task={renaming}
        onClose={() => setRenaming(null)}
        onSave={(name) => {
          if (!renaming) return;
          const now = new Date().toISOString();
          commit(latest.current.map((t) => (t.id === renaming.id ? { ...t, name, updated_at: now } : t)));
        }}
      />
    </div>
  );
}
