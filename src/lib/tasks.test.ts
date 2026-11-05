import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjacentColumn, placeTask, taskProgress, tasksIn, type KanbanTask } from './tasks.ts';

const task = (id: string, column = 'todo'): KanbanTask => ({ id, name: id, column, created_at: 'then', updated_at: 'then' });
const ids = (tasks: KanbanTask[]) => tasks.map((item) => item.id);

test('placing a task in another column appends it and stamps the move', () => {
  const next = placeTask([task('a'), task('b'), task('c', 'done')], 'a', 'done', undefined, 'now');
  assert.deepEqual(ids(tasksIn(next, 'done')), ['c', 'a']);
  assert.equal(next.find((item) => item.id === 'a')!.updated_at, 'now');
});

test('placing before a task reorders within a column without counting as an update', () => {
  const next = placeTask([task('a'), task('b'), task('c')], 'c', 'todo', 'a', 'now');
  assert.deepEqual(ids(next), ['c', 'a', 'b']);
  assert.equal(next[0].updated_at, 'then');
});

test('dropping a task on itself or moving an unknown task changes nothing', () => {
  const tasks = [task('a'), task('b')];
  assert.equal(placeTask(tasks, 'a', 'todo', 'a'), tasks);
  assert.equal(placeTask(tasks, 'missing', 'done'), tasks);
});

test('adjacent columns stop at the ends of the board', () => {
  assert.equal(adjacentColumn('todo', 1), 'in-progress');
  assert.equal(adjacentColumn('todo', -1), null);
  assert.equal(adjacentColumn('done', 1), null);
  assert.equal(adjacentColumn('unknown', 1), null);
});

test('progress handles an empty board', () => {
  assert.deepEqual(taskProgress([]), { done: 0, total: 0, percent: 0 });
  assert.deepEqual(taskProgress([task('a'), task('b', 'done')]), { done: 1, total: 2, percent: 50 });
});
