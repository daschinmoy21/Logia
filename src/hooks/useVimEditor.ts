import { useEffect } from 'react';
import type { BlockNoteEditor } from '@blocknote/core';
import { attachVim } from '../lib/vim/editorVim';
import { vimBridge } from '../lib/vim/bridge';
import { useSettingsStore } from '../store/settingsStore';
import { useVimStore } from '../store/vimStore';

/** Attach vim keybindings to a BlockNote editor while vim mode is enabled. */
export function useVimEditor(editor: BlockNoteEditor<any, any, any> | null) {
  const vimEnabled = useSettingsStore((s) => s.vimEnabled);

  useEffect(() => {
    if (!vimEnabled || !editor) return;
    let engine: ReturnType<typeof attachVim> | null = null;
    let frame = 0;
    let tries = 0;

    const tryAttach = () => {
      // The ProseMirror view only exists once BlockNoteView has mounted.
      if (!editor.domElement?.isConnected) {
        if (tries++ < 120) frame = requestAnimationFrame(tryAttach);
        return;
      }
      const vim = useVimStore.getState();
      if (vim.mode !== 'explorer') vim.setMode('normal');
      engine = attachVim(editor, {
        getMode: () => useVimStore.getState().mode,
        setMode: (mode) => useVimStore.getState().setMode(mode),
        setPending: (keys) => useVimStore.getState().setPending(keys),
        flash: (text, error) => useVimStore.getState().flash(text, error),
        leader: () => vimBridge.leader(),
        commandLine: (prefix) => vimBridge.commandLine(prefix),
        focusExplorer: () => vimBridge.focusExplorer(),
      });
      vimBridge.engine = engine;
    };
    tryAttach();

    return () => {
      cancelAnimationFrame(frame);
      if (engine) {
        engine.detach();
        if (vimBridge.engine === engine) vimBridge.engine = null;
      }
    };
  }, [editor, vimEnabled]);
}
