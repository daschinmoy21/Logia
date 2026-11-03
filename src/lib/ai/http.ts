const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Route HTTP calls through the Tauri HTTP plugin so provider APIs aren't
 * blocked by CORS in the webview. Falls back to the browser fetch when the
 * plugin isn't available or the URL is outside its scope.
 */
export const aiFetch: typeof fetch = async (input, init) => {
  if (isTauri()) {
    try {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
      return await tauriFetch(input, init);
    } catch (error) {
      const msg = String(error);
      // Scope/permission errors mean the plugin refused; try the webview.
      if (!/not allowed|scope|forbidden/i.test(msg)) throw error;
    }
  }
  return fetch(input, init);
};
