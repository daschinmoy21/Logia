import type { VimEngine } from './editorVim';

/**
 * Glue between the editor-level vim engine and the app-level VimController.
 * The controller fills in the callbacks; the active editor registers itself.
 */
export const vimBridge: {
  engine: VimEngine | null;
  leader: () => void;
  commandLine: (prefix: ':' | '/' | '?') => void;
  focusExplorer: () => void;
} = {
  engine: null,
  leader: () => {},
  commandLine: () => {},
  focusExplorer: () => {},
};
