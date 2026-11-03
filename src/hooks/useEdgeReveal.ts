import { useCallback, useEffect, useRef, useState } from 'react';

/** How long the pointer must rest on the window edge before a panel opens. */
const REVEAL_DELAY_MS = 70;
/** Grace period after the pointer leaves before the panel hides. */
const HIDE_DELAY_MS = 260;

/**
 * Open a panel while the pointer rests on a window edge or on the panel itself.
 * `canHide` can hold it open, for example while it has focus or an open menu.
 */
export function useEdgeReveal(canHide: () => boolean = () => true) {
  const [open, setOpen] = useState(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const canHideRef = useRef(canHide);
  canHideRef.current = canHide;

  const clearTimers = useCallback(() => {
    if (revealTimer.current) clearTimeout(revealTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    revealTimer.current = null;
    hideTimer.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const attempt = () => {
      if (canHideRef.current()) {
        hideTimer.current = null;
        setOpen(false);
      } else {
        hideTimer.current = setTimeout(attempt, HIDE_DELAY_MS);
      }
    };
    hideTimer.current = setTimeout(attempt, HIDE_DELAY_MS);
  }, []);

  const onEdgeEnter = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    if (openRef.current || revealTimer.current) return;
    revealTimer.current = setTimeout(() => {
      revealTimer.current = null;
      setOpen(true);
    }, REVEAL_DELAY_MS);
  }, []);

  const onEdgeLeave = useCallback(() => {
    // Pointer only brushed the edge: cancel the pending reveal.
    if (revealTimer.current) {
      clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
    // If the panel opened under a still pointer and the pointer then flicked
    // away, the panel never saw mouseenter/leave: hide it unless it's entered.
    if (openRef.current) scheduleHide();
  }, [scheduleHide]);

  const keepOpen = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setOpen(true);
  }, []);

  return { open, setOpen, clearTimers, onEdgeEnter, onEdgeLeave, keepOpen, scheduleHide };
}
