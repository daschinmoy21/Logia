import { useEffect, useRef } from 'react';

/**
 * Android's back button walks the WebView's history, so every layer that back should
 * close (the editor, a sheet, a menu, a non-home tab) owns one history entry while it's open.
 * Back pops the topmost layer. Closing a layer from the UI consumes its entry quietly.
 */
type Layer = { close: () => void };

const stack: Layer[] = [];
let ignoredPops = 0;
let listening = false;
let pendingBack = 0;

/** Several layers closing at once (a menu action that also leaves the editor) go back together. */
function consumeEntries(count: number) {
  if (pendingBack === 0) {
    queueMicrotask(() => {
      const steps = pendingBack;
      pendingBack = 0;
      ignoredPops += 1;
      window.history.go(-steps);
    });
  }
  pendingBack += count;
}

function onPopState() {
  if (ignoredPops > 0) {
    ignoredPops -= 1;
    return;
  }
  stack.pop()?.close();
}

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('popstate', onPopState);
}

export function useBackLayer(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return;
    listen();
    const layer: Layer = { close: () => closeRef.current() };
    stack.push(layer);
    window.history.pushState({ logiaLayer: stack.length }, '');
    return () => {
      const index = stack.indexOf(layer);
      // Still listed: the UI closed it, not back. Take its history entry back off.
      if (index >= 0) {
        stack.splice(index, 1);
        consumeEntries(1);
      }
    };
  }, [open]);
}

/** Whether a layer is open above the base screen. Lets gestures ignore the page underneath. */
export const openLayerCount = () => stack.length;

/**
 * Android back button. The WebView's own back skips entries pushed without a fresh user
 * gesture, so on device it could close the app from inside the editor. Taking the button over
 * means back always pops the top layer through history, and only leaves the app from the base screen.
 */
export function useNativeBackButton() {
  useEffect(() => {
    let disposed = false;
    let unregister: (() => void) | undefined;
    void (async () => {
      const { isTauri } = await import('@tauri-apps/api/core');
      if (!isTauri()) return;
      const { onBackButtonPress, exit } = await import('@tauri-apps/api/app');
      const listener = await onBackButtonPress(() => {
        if (stack.length > 0) window.history.back();
        else void exit(0);
      });
      if (disposed) void listener.unregister();
      else unregister = () => void listener.unregister();
    })().catch(() => {
      /* not on a device: the browser's back already walks history */
    });
    return () => {
      disposed = true;
      unregister?.();
    };
  }, []);
}
