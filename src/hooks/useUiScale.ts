import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useSettingsStore } from '../store/settingsStore';
import { uiScaleAction } from '../lib/ui-scale';

/** Capture before editor, canvas and terminal shortcuts; scaling also works in dialogs. */
export function useUiScale() {
  const scale = useSettingsStore((s) => s.uiScale);
  useEffect(() => {
    if (isTauri()) {
      void getCurrentWebview().setZoom(scale).catch((error) => console.error('Could not scale the UI:', error));
    } else {
      document.documentElement.style.zoom = String(scale);
      document.documentElement.style.setProperty('--ui-zoom', String(scale));
    }
  }, [scale]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const action = uiScaleAction(event);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      const settings = useSettingsStore.getState();
      settings.setUiScale(action === 'reset' ? 1 : settings.uiScale + (action === 'in' ? 0.1 : -0.1));
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
