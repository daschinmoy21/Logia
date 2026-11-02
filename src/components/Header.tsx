import { AnimatePresence, motion } from "framer-motion";
import useUiStore from "../store/UiStore";
import { useNotesStore } from "../store/notesStore";
import { useSettingsStore } from "../store/settingsStore";
import { useVimStore, type VimMode } from "../store/vimStore";
import { Globe, PanelRight, PanelLeft, PanelLeftDashed, Search } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { openPalette } from "./workspace/actions";
import { Kbd, SHORTCUTS, shortcutAria, shortcutText } from "./workspace/shortcuts";

const MODE_STYLE: Record<VimMode, { label: string; className: string }> = {
  normal: { label: "NORMAL", className: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  insert: { label: "INSERT", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  visual: { label: "VISUAL", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  "visual-line": { label: "V-LINE", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  explorer: { label: "EXPLORER", className: "bg-purple-500/15 text-purple-300 border-purple-500/30" },
};

function VimBadge() {
  const vimEnabled = useSettingsStore((s) => s.vimEnabled);
  const setVimEnabled = useSettingsStore((s) => s.setVimEnabled);
  const mode = useVimStore((s) => s.mode);
  const pending = useVimStore((s) => s.pending);
  const commandOpen = useVimStore((s) => !!s.commandLine);

  if (!vimEnabled) {
    return (
      <button
        type="button"
        onClick={() => setVimEnabled(true)}
        className="rounded-md border border-zinc-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-zinc-600 hover:text-zinc-300 hover:border-zinc-600 transition-colors"
        title="Enable vim mode"
        aria-label="Enable vim mode"
      >
        VIM
      </button>
    );
  }

  const style = commandOpen
    ? { label: "COMMAND", className: "bg-zinc-500/15 text-zinc-200 border-zinc-500/30" }
    : MODE_STYLE[mode];

  return (
    <div className="flex items-center gap-2">
      <AnimatePresence>
        {pending && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="font-mono text-xs text-zinc-400"
          >
            {pending}
          </motion.span>
        )}
      </AnimatePresence>
      <button
        type="button"
        onClick={() => useUiStore.getState().setIsSettingsOpen(true, "editor")}
        onContextMenu={(e) => {
          e.preventDefault();
          setVimEnabled(false);
        }}
        className={`min-w-[4.75rem] rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide transition-colors duration-150 ${style.className}`}
        title="Vim mode — click for keybindings, right-click to turn off"
        aria-label={`Vim mode: ${style.label}`}
      >
        {style.label}
      </button>
    </div>
  );
}

function BrowserBadge() {
  const description = "Browser workspace: notes are kept only in this browser. Trash, audio capture, to-dos, Git sync and saved AI keys need the desktop app.";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-200/90"
      title={description}
      role="img"
      aria-label={description}
    >
      <Globe size={12} aria-hidden="true" />
      <span className="hidden sm:inline">Browser workspace</span>
    </span>
  );
}

export default function Header({
  onToggleSidebar,
  sidebarOpen = false,
}: {
  /** Set on narrow screens, where the button shows or hides the sidebar instead of pinning it. */
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
}) {
  const { isAiSidebarOpen, setIsAiSidebarOpen } = useUiStore();
  const isSidebarFloating = useSettingsStore((s) => s.sidebarFloating);
  const setSidebarFloating = useSettingsStore((s) => s.setSidebarFloating);
  const currentNote = useNotesStore((s) => s.currentNote);
  const SidebarIcon = isSidebarFloating ? PanelLeftDashed : PanelLeft;

  return (
    <header className="h-10 bg-zinc-950/90 px-3 border-b border-zinc-800/70 flex items-center justify-between flex-shrink-0 gap-3">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <button
          type="button"
          onClick={onToggleSidebar ?? (() => setSidebarFloating(!isSidebarFloating))}
          className={`p-1.5 rounded-md transition-all duration-200 ${
            (onToggleSidebar ? sidebarOpen : isSidebarFloating)
              ? "text-blue-400 bg-blue-400/10"
              : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
          }`}
          title={
            onToggleSidebar
              ? sidebarOpen ? "Hide sidebar" : "Show sidebar"
              : `${isSidebarFloating ? "Pin sidebar" : "Auto-hide sidebar"} (${shortcutText(SHORTCUTS.sidebar)})`
          }
          aria-label={
            onToggleSidebar
              ? sidebarOpen ? "Hide sidebar" : "Show sidebar"
              : isSidebarFloating ? "Pin sidebar" : "Auto-hide sidebar"
          }
          aria-pressed={onToggleSidebar ? sidebarOpen : isSidebarFloating}
        >
          <SidebarIcon size={17} />
        </button>
        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={currentNote?.id ?? "home"}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.14 }}
              className={`text-sm truncate ${currentNote ? "text-zinc-300" : "text-zinc-600"}`}
              title={currentNote ? currentNote.title || "Untitled" : undefined}
            >
              {currentNote ? currentNote.title || "Untitled" : "Home"}
              {currentNote?.note_type === "canvas" && (
                <span className="ml-2 text-[10px] uppercase tracking-wide text-purple-400/80">
                  Canvas
                </span>
              )}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {!isTauri() && <BrowserBadge />}
        <button
          type="button"
          onClick={() => openPalette("notes")}
          className="flex items-center gap-2 rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          title={`Search notes (${shortcutText(SHORTCUTS.quickSwitch)}) or run a command (${shortcutText(SHORTCUTS.commands)})`}
          aria-label="Search notes and commands"
          aria-keyshortcuts={shortcutAria(SHORTCUTS.quickSwitch)}
        >
          <Search size={16} />
          <Kbd keys={SHORTCUTS.quickSwitch} className="hidden md:inline-flex" />
        </button>
        <VimBadge />
        <button
          type="button"
          onClick={() => setIsAiSidebarOpen(!isAiSidebarOpen)}
          className={`p-1.5 rounded-md transition-all duration-200 ${
            isAiSidebarOpen
              ? "text-blue-400 bg-blue-400/10"
              : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
          }`}
          title={`${isAiSidebarOpen ? "Close" : "Open"} AI panel (${shortcutText(SHORTCUTS.toggleAi)})`}
          aria-label={isAiSidebarOpen ? "Close AI sidebar" : "Open AI sidebar"}
          aria-pressed={isAiSidebarOpen}
        >
          <PanelRight size={17} />
        </button>
      </div>
    </header>
  );
}
