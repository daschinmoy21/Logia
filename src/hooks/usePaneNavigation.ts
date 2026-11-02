import { useEffect, useRef } from 'react';
import useUiStore from '../store/UiStore';
import { useNotesStore } from '../store/notesStore';
import { useSettingsStore } from '../store/settingsStore';
import { useVimStore } from '../store/vimStore';
import { vimBridge } from '../lib/vim/bridge';
import { isBlockingModalOpen } from '../components/workspace/shortcuts';

export const isPaneNavigationKey = (event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key'>) =>
  event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && /^[hjkl]$/i.test(event.key);

type Pane = 'tree' | 'editor' | 'ai';
const order: Pane[] = ['tree', 'editor', 'ai'];

/** A capture listener reserves pane keys before BlockNote or a CLI can consume them. */
export function usePaneNavigation(showTree: () => void, hideTree: () => void) {
  const actions = useRef({ showTree, hideTree });
  actions.current = { showTree, hideTree };
  useEffect(() => {
    let generation = 0;
    const handler = (event: KeyboardEvent) => {
      if (event.isComposing || !isPaneNavigationKey(event) || event.defaultPrevented) return;
      const ui = useUiStore.getState();
      if (ui.isCommandPaletteOpen || isBlockingModalOpen()) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      // Rename fields and other ordinary form controls keep their editing keys.
      if (target?.closest('input, select') || (target?.tagName === 'TEXTAREA' && !target.closest('[data-workspace-pane="ai"]'))) return;
      const current = (target?.closest<HTMLElement>('[data-workspace-pane]')?.dataset.workspacePane ?? 'editor') as Pane;
      const key = event.key.toLowerCase();
      const index = Math.max(0, order.indexOf(current));
      const next = key === 'h' ? Math.max(0, index - 1) : key === 'l' ? Math.min(2, index + 1) : (index + (key === 'j' ? 1 : 2)) % 3;
      const destination = order[next];
      event.preventDefault();
      event.stopImmediatePropagation();
      const thisGeneration = ++generation;
      const vim = useVimStore.getState();
      vim.setLeaderOpen(false);
      if (destination === 'tree') {
        if (window.matchMedia('(max-width: 767px)').matches) ui.setIsAiSidebarOpen(false);
        // Reveal the active note's ancestors before choosing a row.
        const notes = useNotesStore.getState();
        const expanded = new Set(ui.expandedFolders);
        let parent = notes.currentNote?.folder_id;
        const visited = new Set<string>();
        while (parent && !visited.has(parent)) {
          visited.add(parent); expanded.add(parent);
          parent = notes.folders.find(f => f.id === parent)?.parent_id;
        }
        ui.setExpandedFolders(expanded);
        if (useSettingsStore.getState().vimEnabled) {
          vim.setMode('explorer');
          vim.setExplorerCursor(notes.currentNote?.id ?? null);
        }
        actions.current.showTree();
      } else {
        if (vim.mode === 'explorer') vim.setMode('normal');
        actions.current.hideTree();
        if (destination === 'ai') ui.setIsAiSidebarOpen(true);
        else if (window.matchMedia('(max-width: 767px)').matches) ui.setIsAiSidebarOpen(false);
      }
      const started = performance.now();
      const focus = () => {
        if (thisGeneration !== generation) return;
        const pane = document.querySelector<HTMLElement>(`[data-workspace-pane="${destination}"]`);
        let element: HTMLElement | null = null;
        if (destination === 'tree') {
          const id = useNotesStore.getState().currentNote?.id;
          element = (id ? pane?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`) : null)
            ?? pane?.querySelector<HTMLElement>('[data-tree-id], button') ?? null;
        } else if (destination === 'ai') {
          element = pane?.querySelector<HTMLElement>('[data-agent-composer], .xterm-helper-textarea, button') ?? null;
          // Prefer the composer to the top chooser when both exist.
          element = pane?.querySelector<HTMLElement>('[data-agent-composer]')
            ?? pane?.querySelector<HTMLElement>('.xterm-helper-textarea') ?? element;
        } else {
          const editor = useUiStore.getState().editor;
          if (editor?.domElement?.isConnected) {
            editor.focus();
            if (useSettingsStore.getState().vimEnabled && useVimStore.getState().mode === 'normal') vimBridge.engine?.enterNormal();
            return;
          }
          element = pane?.querySelector<HTMLElement>('[contenteditable="true"], .tl-container, input, button') ?? pane ?? null;
        }
        if (element && element.getBoundingClientRect().width > 0) {
          element.focus({ preventScroll: true });
          element.scrollIntoView({ block: 'nearest' });
        } else if (performance.now() - started < 1000) requestAnimationFrame(focus);
      };
      requestAnimationFrame(focus);
    };
    window.addEventListener('keydown', handler, true);
    return () => { generation++; window.removeEventListener('keydown', handler, true); };
  }, []);
}
