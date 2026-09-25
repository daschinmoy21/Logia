/** Documentation for vim-mode bindings, shared by the which-key popup and Settings. */

export interface KeyDoc {
  keys: string;
  label: string;
}

export type LeaderAction =
  | 'explorer'
  | 'find'
  | 'ai'
  | 'newNote'
  | 'newCanvas'
  | 'toggleSidebar'
  | 'home'
  | 'settings'
  | 'todo';

export const LEADER_BINDINGS: Array<{ key: string; action: LeaderAction; label: string }> = [
  { key: 'e', action: 'explorer', label: 'File explorer' },
  { key: 'f', action: 'find', label: 'Find note' },
  { key: ' ', action: 'find', label: 'Find note' },
  { key: 'a', action: 'ai', label: 'AI chat' },
  { key: 'n', action: 'newNote', label: 'New note' },
  { key: 'c', action: 'newCanvas', label: 'New canvas' },
  { key: 'b', action: 'toggleSidebar', label: 'Pin / auto-hide sidebar' },
  { key: 't', action: 'todo', label: 'To-do board' },
  { key: 'h', action: 'home', label: 'Home' },
  { key: 's', action: 'settings', label: 'Settings' },
];

export const EDITOR_KEYS: KeyDoc[] = [
  { keys: 'i a I A o O', label: 'Insert mode (before, after, line start/end, new block below/above)' },
  { keys: 'Esc / Ctrl-[', label: 'Back to normal mode' },
  { keys: 'h j k l', label: 'Move left, down, up, right' },
  { keys: 'w b e  W B E', label: 'Word motions' },
  { keys: '0 ^ $', label: 'Line start, first character, line end' },
  { keys: 'gg G  { }', label: 'First / last block, previous / next block' },
  { keys: 'x X r~', label: 'Delete char, backspace, replace char, toggle case' },
  { keys: 'dd yy cc  D C', label: 'Delete / yank / change block, to end of block' },
  { keys: 'd c y + motion', label: 'Operators, e.g. dw, cw, y$, diw, ci"' },
  { keys: 'p P', label: 'Paste after / before' },
  { keys: 'v V', label: 'Visual / visual-block mode' },
  { keys: '>> <<', label: 'Indent / outdent block' },
  { keys: 'J', label: 'Join with next block' },
  { keys: 'u Ctrl-r', label: 'Undo / redo' },
  { keys: '/ n N', label: 'Search in note, next / previous match' },
  { keys: 'Ctrl-d Ctrl-u', label: 'Half page down / up' },
  { keys: 'Count prefix', label: 'e.g. 3j, 2dd, 5x' },
];

export const EXPLORER_KEYS: KeyDoc[] = [
  { keys: 'j k', label: 'Next / previous item' },
  { keys: 'gg G', label: 'First / last item' },
  { keys: 'l Enter o', label: 'Open note / expand folder' },
  { keys: 'h', label: 'Collapse folder / go to parent' },
  { keys: 'a A', label: 'New note / new folder here' },
  { keys: 'r', label: 'Rename' },
  { keys: 'd', label: 'Delete (asks to confirm)' },
  { keys: 's', label: 'Star / unstar' },
  { keys: 'Esc q i', label: 'Back to the editor' },
];

export const EX_COMMANDS: KeyDoc[] = [
  { keys: ':w', label: 'Save the note now' },
  { keys: ':q', label: 'Close the note (go home)' },
  { keys: ':wq  :x', label: 'Save and close' },
  { keys: ':e <name>', label: 'Open note by name' },
  { keys: ':new [title]', label: 'New note' },
  { keys: ':canvas', label: 'New canvas' },
  { keys: ':ai [prompt]', label: 'Open AI chat (and send prompt)' },
  { keys: ':provider <id>', label: 'Switch AI provider' },
  { keys: ':set novim', label: 'Turn vim mode off' },
  { keys: ':sidebar', label: 'Pin / auto-hide sidebar' },
  { keys: ':settings  :help', label: 'Settings / this cheat sheet' },
];

export const GLOBAL_KEYS: KeyDoc[] = [
  { keys: 'Space', label: 'Leader (see popup)' },
  { keys: ':', label: 'Command line' },
  { keys: 'Ctrl-h / Ctrl-l', label: 'Focus explorer / editor' },
  { keys: 'Ctrl-j Ctrl-k', label: 'Move in the command palette' },
];
