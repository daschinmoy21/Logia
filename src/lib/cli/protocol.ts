import type { Note } from '../../types/Note.ts';
export type CliParams = Record<string, string | boolean>;
export interface GuiRequest { id?: string; command: string; params?: CliParams; deadline?: number }
export type GuiResponse = { schemaVersion: 1; data: unknown } | { schemaVersion: 1; error: { code: string; message: string } };
export class CliError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export const revisionInput = (note: Note) => JSON.stringify([note.id, note.title, note.content, note.folder_id ?? null, note.starred ?? false, note.note_type ?? 'text']);
export async function noteRevision(note: Note): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(revisionInput(note)));
  return 'sha256-' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
