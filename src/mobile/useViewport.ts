import { useEffect } from 'react';

/**
 * Publishes the visible viewport as CSS variables on <html>:
 * `--m-vh` is the height above the soft keyboard and `--m-kb` the keyboard's height.
 * Android WebViews usually shrink the page for the keyboard (both vars then follow
 * innerHeight); browsers that overlay the keyboard only shrink the visual viewport.
 */
export function useViewportVars() {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    let frame = 0;
    const update = () => {
      frame = 0;
      const height = vv ? vv.height : window.innerHeight;
      const keyboard = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
      root.style.setProperty('--m-vh', `${Math.round(height)}px`);
      root.style.setProperty('--m-kb', `${Math.round(keyboard)}px`);
      root.style.setProperty('--m-vtop', `${Math.round(vv?.offsetTop ?? 0)}px`);
      // Without a keyboard there's nothing to scroll the page out from under; undo any drift.
      if (window.scrollY !== 0 && keyboard === 0) window.scrollTo(0, 0);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();

    // Android: MainActivity reports the status/gesture bar sizes (older WebViews give 0 for env()).
    type Insets = Partial<Record<'top' | 'bottom' | 'left' | 'right', number>>;
    const applyInsets = (insets: Insets) => {
      for (const side of ['top', 'bottom', 'left', 'right'] as const) {
        root.style.setProperty(`--android-safe-${side}`, `${insets[side] ?? 0}px`);
      }
    };
    const onInsets = (event: Event) => applyInsets((event as CustomEvent<Insets>).detail ?? {});
    const bridge = (window as unknown as { LogiaInsets?: { get(): string } }).LogiaInsets;
    if (bridge) {
      try {
        applyInsets(JSON.parse(bridge.get()) as Insets);
      } catch {
        /* keep env() values */
      }
    }
    window.addEventListener('logia-insets', onInsets);
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('logia-insets', onInsets);
      root.style.removeProperty('--m-vh');
      root.style.removeProperty('--m-kb');
      root.style.removeProperty('--m-vtop');
    };
  }, []);
}

