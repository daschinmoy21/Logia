import { invoke, isTauri } from '@tauri-apps/api/core';
import type { KanbanTask } from '../lib/tasks';

const STORAGE_KEY = 'logia.browser-tasks.v1';

/** The same task board the desktop opens. Browser development keeps its own copy. */
export async function loadTasks(): Promise<KanbanTask[]> {
  if (isTauri()) return invoke<KanbanTask[]>('get_kanban_data');
  const raw = localStorage.getItem(STORAGE_KEY);
  const tasks: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(tasks)) throw new Error('Invalid browser task data');
  return tasks as KanbanTask[];
}

let queue: Promise<unknown> = Promise.resolve();

/** Writes run in order, so a slow save can't land after a newer one. */
export function saveTasks(tasks: KanbanTask[]): Promise<void> {
  const next = queue.catch(() => {}).then(async () => {
    if (isTauri()) await invoke('save_kanban_data', { tasks });
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  });
  queue = next;
  return next;
}
