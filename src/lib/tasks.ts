export type KanbanTask = {
  id: string;
  name: string;
  column: string;
  created_at: string;
  updated_at: string;
};

export const TASK_COLUMNS = [
  { id: 'todo', name: 'Todo', hint: '' },
  { id: 'in-progress', name: 'Doing', hint: 'Drag a task here when you start it.' },
  { id: 'done', name: 'Done', hint: 'Finished tasks end up here.' },
] as const;

export type TaskColumnId = (typeof TASK_COLUMNS)[number]['id'];

export const tasksIn = (tasks: KanbanTask[], column: string) => tasks.filter((task) => task.column === column);

/** The column `delta` steps from this one, or null at either end of the board. */
export function adjacentColumn(column: string, delta: number): TaskColumnId | null {
  const index = TASK_COLUMNS.findIndex((candidate) => candidate.id === column);
  return index < 0 ? null : TASK_COLUMNS[index + delta]?.id ?? null;
}

/** Moves a task into a column, before `beforeId` or at the end. Order on the board is array order. */
export function placeTask(tasks: KanbanTask[], id: string, column: string, beforeId?: string, now = new Date().toISOString()): KanbanTask[] {
  const task = tasks.find((candidate) => candidate.id === id);
  if (!task || beforeId === id) return tasks;
  const moved = task.column === column ? { ...task } : { ...task, column, updated_at: now };
  const rest = tasks.filter((candidate) => candidate.id !== id);
  const before = beforeId ? rest.findIndex((candidate) => candidate.id === beforeId) : -1;
  return before < 0 ? [...rest, moved] : [...rest.slice(0, before), moved, ...rest.slice(before)];
}

export function taskProgress(tasks: KanbanTask[]) {
  const done = tasks.filter((task) => task.column === 'done').length;
  return { done, total: tasks.length, percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
}
