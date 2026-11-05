import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import { version } from "./package.json"
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [react({
    babel: {
      plugins: [[
        "babel-plugin-react-compiler"
      ]],
    },
  }), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    // BlockNote and tldraw each pull in their own ProseMirror. Plugin keys come from a counter in
    // prosemirror-state, so two copies hand out the same key and tldraw's text editor throws.
    dedupe: ['prosemirror-state', 'prosemirror-view', 'prosemirror-model', 'prosemirror-transform'],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
