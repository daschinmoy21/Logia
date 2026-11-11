import { isTauri } from '@tauri-apps/api/core';

const OVERRIDE_KEY = 'logia.mobile-override';

/**
 * The phone shell runs in the Android app, or in a browser when asked for (`?mobile=1`,
 * remembered for the tab; `?mobile=0` turns it off) or on a narrow touch screen.
 * A narrow desktop window keeps the desktop workspace: it has a keyboard and a mouse.
 */
export function isMobileShell(): boolean {
  if (typeof window === 'undefined') return false;
  if (isTauri()) return /Android/i.test(navigator.userAgent);
  const param = new URLSearchParams(window.location.search).get('mobile');
  try {
    if (param === '1' || param === '0') sessionStorage.setItem(OVERRIDE_KEY, param);
    const stored = sessionStorage.getItem(OVERRIDE_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {
    if (param === '1') return true;
    if (param === '0') return false;
  }
  return window.matchMedia?.('(max-width: 640px) and (pointer: coarse)').matches ?? false;
}
