import { getNoteTags, notePreview } from '../lib/workspace';
import type { Note } from '../types/Note';

/** Row text is derived from the note object, so only the note being edited is re-read while typing. */
const rowCache = new WeakMap<Note, { preview: string; tags: string[] }>();

export function rowInfo(note: Note) {
  let info = rowCache.get(note);
  if (!info) {
    const canvas = note.note_type === 'canvas';
    info = { preview: canvas ? 'Canvas. Open it on the desktop app to edit.' : notePreview(note, 200), tags: canvas ? [] : getNoteTags(note.content) };
    rowCache.set(note, info);
  }
  return info;
}

const dayStart = (time: number) => {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

/** Like a mail list: minutes, then a time today, a weekday this week, then a date. */
export function shortDate(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((now - then) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const days = Math.round((dayStart(now) - dayStart(then)) / 86400000);
  const date = new Date(then);
  if (days <= 0) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}

export type Section = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Previous 30 days' | 'Earlier';

export function sectionFor(iso: string, now = Date.now()): Section {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'Earlier';
  const days = Math.round((dayStart(now) - dayStart(then)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 days';
  if (days < 30) return 'Previous 30 days';
  return 'Earlier';
}

/** The editor's "edited" line: relative and short. */
export function editedLabel(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((now - then) / 60000);
  if (minutes < 1) return 'Edited just now';
  if (minutes < 60) return `Edited ${minutes} min ago`;
  const days = Math.round((dayStart(now) - dayStart(then)) / 86400000);
  if (days <= 0) return `Edited at ${shortDate(iso, now)}`;
  if (days === 1) return 'Edited yesterday';
  return `Edited ${shortDate(iso, now)}`;
}
