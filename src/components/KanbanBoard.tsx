import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { invoke } from "@tauri-apps/api/core";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Check, ChevronLeft, ChevronRight, Plus, Trash2, X } from "lucide-react";
import {
  adjacentColumn,
  placeTask,
  TASK_COLUMNS,
  taskProgress,
  tasksIn,
  type KanbanTask,
} from "../lib/tasks";
import { relativeTime } from "./workspace/actions";
import { isEditableTarget } from "./workspace/shortcuts";
import { Button, Tip } from "./ui/kit";

interface KanbanBoardContainerProps {
  isOpen: boolean;
  onClose: () => void;
}

type Deleted = { task: KanbanTask; index: number };

const UNDO_MS = 6000;
const columnName = (id: string) => TASK_COLUMNS.find((column) => column.id === id)?.name ?? id;

function StatusMark({ column, name, onToggle }: { column: string; name: string; onToggle: () => void }) {
  const done = column === "done";
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={done ? `Reopen ${name}` : `Mark ${name} done`}
      onClick={onToggle}
      className={`mt-px flex size-4 flex-shrink-0 items-center justify-center rounded-full border transition-colors ${
        done
          ? "border-zinc-600 bg-zinc-600 text-zinc-950 hover:border-zinc-500 hover:bg-zinc-500"
          : column === "in-progress"
            ? "border-blue-500 hover:bg-blue-500/20"
            : "border-zinc-600 hover:border-blue-400 hover:bg-blue-500/10"
      }`}
    >
      {done && <Check size={11} strokeWidth={3} />}
      {column === "in-progress" && <span className="size-2 rounded-full bg-blue-500" />}
    </button>
  );
}

function ColumnMark({ column }: { column: string }) {
  if (column === "done") {
    return <span className="flex size-3.5 items-center justify-center rounded-full bg-zinc-600 text-zinc-950"><Check size={10} strokeWidth={3} /></span>;
  }
  return (
    <span className={`flex size-3.5 items-center justify-center rounded-full border ${column === "in-progress" ? "border-blue-500" : "border-zinc-600"}`}>
      {column === "in-progress" && <span className="size-1.5 rounded-full bg-blue-500" />}
    </span>
  );
}

function TaskBody({ task }: { task: KanbanTask }) {
  const done = task.column === "done";
  return (
    <>
      <span className={`block break-words text-[13px] leading-[18px] ${done ? "text-zinc-500 line-through decoration-zinc-600" : "text-zinc-100"}`}>{task.name}</span>
      <span className="mt-1 block font-mono text-[10.5px] leading-none text-zinc-500">{relativeTime(task.updated_at)}</span>
    </>
  );
}

function TaskCard({
  task,
  editing,
  onEdit,
  onRename,
  onCancelEdit,
  onMove,
  onToggle,
  onDelete,
  onKeyDown,
}: {
  task: KanbanTask;
  editing: boolean;
  onEdit: () => void;
  onRename: (name: string) => void;
  onCancelEdit: () => void;
  onMove: (delta: number) => void;
  onToggle: () => void;
  onDelete: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLLIElement>) => void;
}) {
  const { setNodeRef: setDragRef, listeners, isDragging, active } = useDraggable({ id: task.id, disabled: editing });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `task:${task.id}`, disabled: editing });
  const previous = adjacentColumn(task.column, -1);
  const next = adjacentColumn(task.column, 1);
  const actionClass = "flex size-6 items-center justify-center rounded text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100";

  return (
    <li
      ref={(node) => { setDragRef(node); setDropRef(node); }}
      {...listeners}
      tabIndex={0}
      data-task-id={task.id}
      aria-label={`${task.name}, ${columnName(task.column)}`}
      onKeyDown={onKeyDown}
      className={`group relative flex cursor-grab touch-none gap-2.5 rounded-lg border bg-zinc-925 p-2.5 outline-none transition-colors hover:border-zinc-700 focus-visible:border-blue-500 active:cursor-grabbing ${
        isDragging ? "border-dashed border-zinc-700 opacity-40" : "border-zinc-800/80"
      }`}
    >
      {isOver && active?.id !== task.id && <span aria-hidden="true" className="absolute inset-x-1 -top-[5px] h-0.5 rounded-full bg-blue-500" />}
      <StatusMark column={task.column} name={task.name} onToggle={onToggle} />
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            aria-label="Task name"
            defaultValue={task.name}
            onFocus={(event) => event.currentTarget.select()}
            onPointerDown={(event) => event.stopPropagation()}
            onBlur={(event) => onRename(event.currentTarget.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") { event.preventDefault(); onCancelEdit(); }
            }}
            className="w-full rounded bg-zinc-900 px-1 text-[13px] leading-[18px] text-zinc-100 outline-none ring-1 ring-blue-500"
          />
        ) : (
          <button type="button" tabIndex={-1} onClick={onEdit} aria-label={`Rename ${task.name}`} className="block w-full cursor-text text-left">
            <TaskBody task={task} />
          </button>
        )}
      </div>
      {!editing && (
        <div className="absolute right-1.5 top-1.5 hidden items-center rounded-md border border-zinc-800 bg-zinc-900 group-hover:flex group-focus-within:flex group-focus-visible:flex">
          {previous && <Tip label={`Move to ${columnName(previous)}`}><button type="button" tabIndex={-1} aria-label={`Move ${task.name} to ${columnName(previous)}`} onClick={() => onMove(-1)} className={actionClass}><ChevronLeft size={13} /></button></Tip>}
          {next && <Tip label={`Move to ${columnName(next)}`}><button type="button" tabIndex={-1} aria-label={`Move ${task.name} to ${columnName(next)}`} onClick={() => onMove(1)} className={actionClass}><ChevronRight size={13} /></button></Tip>}
          <Tip label="Delete"><button type="button" tabIndex={-1} aria-label={`Delete ${task.name}`} onClick={onDelete} className={`${actionClass} hover:text-red-300`}><Trash2 size={12} /></button></Tip>
        </div>
      )}
    </li>
  );
}

function TaskComposer({ onAdd, onDismiss }: { onAdd: (name: string) => void; onDismiss: () => void }) {
  const [value, setValue] = useState("");
  return (
    <input
      autoFocus
      data-autofocus
      value={value}
      aria-label="New task"
      placeholder="What needs doing?"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => { if (!value.trim()) onDismiss(); }}
      onKeyDown={(event) => {
        // Escape clears what's typed first. With nothing typed it closes the panel as usual.
        if (event.key === "Escape" && !value) return;
        event.stopPropagation();
        if (event.key === "Enter" && value.trim()) {
          onAdd(value.trim());
          setValue("");
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setValue("");
        }
      }}
      className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-925 px-2.5 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-blue-500"
    />
  );
}

function TaskColumn({
  column,
  tasks,
  composing,
  onCompose,
  renderCard,
  composer,
}: {
  column: (typeof TASK_COLUMNS)[number];
  tasks: KanbanTask[];
  composing: boolean;
  onCompose: () => void;
  renderCard: (task: KanbanTask) => React.ReactNode;
  composer: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${column.id}` });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${column.name}, ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`}
      className={`flex min-h-48 min-w-0 flex-col transition-colors md:min-h-0 ${isOver ? "bg-white/[0.025]" : ""}`}
    >
      <header className="flex h-10 flex-shrink-0 items-center gap-2 px-3">
        <ColumnMark column={column.id} />
        <h3 className="text-xs font-medium text-zinc-200">{column.name}</h3>
        <span className="font-mono text-[11px] tabular-nums text-zinc-500">{tasks.length}</span>
      </header>
      <div className="min-h-0 flex-1 px-2 pb-2 md:overflow-y-auto">
        <ul className="space-y-1.5">{tasks.map(renderCard)}</ul>
        {!tasks.length && column.hint && !composing && <p className="px-1 pb-1 pt-0.5 text-xs leading-5 text-zinc-500">{column.hint}</p>}
        <div className={tasks.length ? "mt-1.5" : ""}>
          {composing ? composer : (
            <button type="button" onClick={onCompose} aria-label={`Add task to ${column.name}`} className="flex h-8 w-full items-center gap-1.5 rounded-md px-1.5 text-xs text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-200">
              <Plus size={13} /> Add task
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function KeyHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd className="rounded-[4px] bg-white/[0.07] px-1 font-mono text-[10px] leading-4 text-zinc-400">{keys}</kbd>
      {label}
    </span>
  );
}

export default function KanbanBoardContainer({ isOpen, onClose }: KanbanBoardContainerProps) {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [saveFailed, setSaveFailed] = useState(false);
  const [composing, setComposing] = useState<string | null>("todo");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<Deleted | null>(null);
  const latest = useRef<KanbanTask[]>([]);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const panel = useRef<HTMLDivElement>(null);
  const focusAfterRender = useRef<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const justDragged = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const load = async () => {
    setStatus("loading");
    try {
      const loaded = await invoke<KanbanTask[]>("get_kanban_data");
      latest.current = loaded;
      setTasks(loaded);
      setStatus("ready");
    } catch (error) {
      console.error("Failed to load tasks:", error);
      setStatus("failed");
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setComposing("todo");
    setEditingId(null);
    setDeleted(null);
    setSaveFailed(false);
    void load();
  }, [isOpen]);

  useEffect(() => {
    const id = focusAfterRender.current;
    if (!id) return;
    focusAfterRender.current = null;
    panel.current?.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"]`)?.focus();
  });

  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  // Saves run in order, each with the whole board, so an older write can't land after a newer one.
  const save = (data: KanbanTask[]) => {
    saveQueue.current = saveQueue.current.then(() => invoke("save_kanban_data", { tasks: data })).then(
      () => { if (data === latest.current) setSaveFailed(false); },
      (error) => { console.error("Failed to save tasks:", error); setSaveFailed(true); },
    );
  };

  const commit = (update: (current: KanbanTask[]) => KanbanTask[]) => {
    // A board that failed to load must never be written back over the real one.
    if (status !== "ready") return;
    const next = update(latest.current);
    if (next === latest.current) return;
    latest.current = next;
    setTasks(next);
    save(next);
  };

  const addTask = (column: string, name: string) => {
    const now = new Date().toISOString();
    commit((current) => [...current, { id: crypto.randomUUID(), name, column, created_at: now, updated_at: now }]);
  };

  const moveTask = (id: string, column: string, beforeId?: string, keepFocus = false) => {
    if (keepFocus) focusAfterRender.current = id;
    commit((current) => placeTask(current, id, column, beforeId));
  };

  const toggleDone = (task: KanbanTask, keepFocus = false) => moveTask(task.id, task.column === "done" ? "todo" : "done", undefined, keepFocus);

  const renameTask = (id: string, name: string) => {
    setEditingId(null);
    focusAfterRender.current = id;
    const trimmed = name.trim();
    if (!trimmed) return;
    commit((current) => current.some((task) => task.id === id && task.name !== trimmed)
      ? current.map((task) => (task.id === id ? { ...task, name: trimmed, updated_at: new Date().toISOString() } : task))
      : current);
  };

  const deleteTask = (task: KanbanTask) => {
    const index = latest.current.findIndex((item) => item.id === task.id);
    if (index < 0) return;
    const siblings = tasksIn(latest.current, task.column);
    const position = siblings.findIndex((item) => item.id === task.id);
    focusAfterRender.current = (siblings[position + 1] ?? siblings[position - 1])?.id ?? null;
    commit((current) => current.filter((item) => item.id !== task.id));
    setDeleted({ task, index });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setDeleted(null), UNDO_MS);
  };

  const undoDelete = () => {
    if (!deleted) return;
    const { task, index } = deleted;
    focusAfterRender.current = task.id;
    commit((current) => [...current.slice(0, index), task, ...current.slice(index)]);
    setDeleted(null);
  };

  const handleCardKey = (event: KeyboardEvent<HTMLLIElement>, task: KanbanTask) => {
    if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey) return;
    const siblings = tasksIn(latest.current, task.column);
    const position = siblings.findIndex((item) => item.id === task.id);
    const focusSibling = (delta: number) => {
      const sibling = siblings[position + delta];
      if (sibling) panel.current?.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(sibling.id)}"]`)?.focus();
    };
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const actions: Record<string, () => void> = {
      Enter: () => setEditingId(task.id),
      " ": () => toggleDone(task, true),
      Delete: () => deleteTask(task),
      Backspace: () => deleteTask(task),
      ArrowUp: () => focusSibling(-1),
      k: () => focusSibling(-1),
      ArrowDown: () => focusSibling(1),
      j: () => focusSibling(1),
      ArrowLeft: () => { const to = adjacentColumn(task.column, -1); if (to) moveTask(task.id, to, undefined, true); },
      h: () => { const to = adjacentColumn(task.column, -1); if (to) moveTask(task.id, to, undefined, true); },
      ArrowRight: () => { const to = adjacentColumn(task.column, 1); if (to) moveTask(task.id, to, undefined, true); },
      l: () => { const to = adjacentColumn(task.column, 1); if (to) moveTask(task.id, to, undefined, true); },
      n: () => setComposing(task.column),
    };
    const action = actions[key];
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setDraggingId(null);
    justDragged.current = true;
    setTimeout(() => { justDragged.current = false; }, 100);
    if (!over) return;
    const id = String(active.id);
    const target = String(over.id);
    if (target.startsWith("column:")) {
      moveTask(id, target.slice("column:".length));
    } else {
      const beforeId = target.slice("task:".length);
      const before = latest.current.find((task) => task.id === beforeId);
      if (before) moveTask(id, before.column, beforeId);
    }
  };

  if (!isOpen) return null;

  const { done, total, percent } = taskProgress(tasks);
  const dragging = tasks.find((task) => task.id === draggingId);

  return (
    <Dialog open={isOpen} onClose={() => { if (!draggingId && !justDragged.current) onClose(); }} className="relative z-[99999]">
      <div className="fixed inset-0 bg-black/60" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel
          ref={panel}
          onKeyDown={(event) => {
            if (event.key === "n" && !isEditableTarget(event.target) && !event.ctrlKey && !event.metaKey && !event.altKey) {
              event.preventDefault();
              setComposing("todo");
            }
          }}
          className="flex h-[min(680px,85dvh)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60"
        >
          <header className="flex h-12 flex-shrink-0 items-center gap-4 border-b border-zinc-800 pl-4 pr-2">
            <DialogTitle as="h2" className="text-sm font-semibold tracking-tight text-zinc-100">Tasks</DialogTitle>
            {total > 0 && (
              <div className="flex min-w-0 items-center gap-2.5">
                <div role="progressbar" aria-label="Tasks done" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="h-1 w-20 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full rounded-full bg-blue-500 transition-[width] duration-200" style={{ width: `${percent}%` }} />
                </div>
                <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-zinc-500">{done} of {total} done</span>
              </div>
            )}
            <button type="button" onClick={onClose} aria-label="Close tasks" className="ml-auto flex size-7 items-center justify-center rounded-md text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-100">
              <X size={15} />
            </button>
          </header>

          {status === "failed" ? (
            <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-[13px] text-zinc-300">Your tasks couldn't be loaded. Nothing has changed.</p>
              <Button onClick={() => void load()}>Try again</Button>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={pointerWithin}
              onDragStart={({ active }) => setDraggingId(String(active.id))}
              onDragEnd={handleDragEnd}
              onDragCancel={() => setDraggingId(null)}
            >
              <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-1 divide-y divide-zinc-800 overflow-y-auto md:auto-rows-auto md:grid-cols-3 md:divide-x md:divide-y-0 md:overflow-hidden">
                {TASK_COLUMNS.map((column) => (
                  <TaskColumn
                    key={column.id}
                    column={column}
                    tasks={tasksIn(tasks, column.id)}
                    composing={composing === column.id}
                    onCompose={() => setComposing(column.id)}
                    composer={<TaskComposer onAdd={(name) => addTask(column.id, name)} onDismiss={() => setComposing((current) => (current === column.id ? null : current))} />}
                    renderCard={(task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        editing={editingId === task.id}
                        onEdit={() => setEditingId(task.id)}
                        onRename={(name) => renameTask(task.id, name)}
                        onCancelEdit={() => { focusAfterRender.current = task.id; setEditingId(null); }}
                        onMove={(delta) => { const to = adjacentColumn(task.column, delta); if (to) moveTask(task.id, to); }}
                        onToggle={() => toggleDone(task)}
                        onDelete={() => deleteTask(task)}
                        onKeyDown={(event) => handleCardKey(event, task)}
                      />
                    )}
                  />
                ))}
              </div>
              <DragOverlay dropAnimation={null}>
                {dragging && (
                  <div className="flex cursor-grabbing gap-2.5 rounded-lg border border-zinc-600 bg-zinc-900 p-2.5 shadow-xl shadow-black/50">
                    <StatusMark column={dragging.column} name={dragging.name} onToggle={() => {}} />
                    <div className="min-w-0 flex-1"><TaskBody task={dragging} /></div>
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          )}

          <footer className="flex h-8 flex-shrink-0 items-center gap-4 border-t border-zinc-800 bg-zinc-925 px-3 text-[11px] text-zinc-500">
            {saveFailed ? (
              <span role="alert" className="flex items-center gap-2 text-red-300">
                Your last change wasn't saved.
                <button type="button" onClick={() => save(latest.current)} className="font-medium underline underline-offset-2 hover:text-red-200">Try again</button>
              </span>
            ) : deleted ? (
              <span role="status" className="flex min-w-0 items-center gap-2 text-zinc-300">
                <span className="truncate">Deleted “{deleted.task.name}”</span>
                <button type="button" onClick={undoDelete} className="flex-shrink-0 font-medium text-blue-300 hover:text-blue-200">Undo</button>
              </span>
            ) : (
              <div className="hidden flex-wrap items-center gap-x-4 md:flex">
                <KeyHint keys="n" label="New task" />
                <KeyHint keys="← →" label="Move" />
                <KeyHint keys="Space" label="Done" />
                <KeyHint keys="Enter" label="Rename" />
                <KeyHint keys="Del" label="Delete" />
              </div>
            )}
          </footer>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
