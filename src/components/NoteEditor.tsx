import { BlockNoteView } from "@blocknote/mantine";
import { Fragment, useEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  useEditorContext,
  FormattingToolbarWithAI,
  SuggestionMenuWithAI,
} from "./EditorProvider";

import { AIMenuController } from "@blocknote/xl-ai";
import useUiStore from "../store/UiStore";
import { useNotesStore } from "../store/notesStore";
import { Star, Download, FileText, FileType, Link2, PanelRightDashed } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import toast from "react-hot-toast";
import { useVimEditor } from "../hooks/useVimEditor";
import { renderLiveBlocksForPrint } from "../lib/live-code-blocks";
import { cachedBacklinks, NoteContextPanel } from "./workspace/NoteContextPanel";
import { revealBacklinks } from "./workspace/actions";
import { IconButton, Tip } from "./ui/kit";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "./ui/menu";
import { useLinkNotes } from "./workspace/noteMeta";
import { useWorkspaceStore } from "./workspace/workspaceStore";
import { SHORTCUTS, shortcutAria } from "./workspace/shortcuts";

/** Below this pane width the context panel floats over the text instead of squeezing it. */
const COMPACT_PANE_WIDTH = 760;

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

export function NoteEditor() {
  const { editor, hasAI, noteId } = useEditorContext();
  const { setEditor } = useUiStore();
  const currentNote = useNotesStore((state) => state.currentNote);
  const folders = useNotesStore((state) => state.folders);
  const notes = useLinkNotes(currentNote?.id);
  const { toggleStar } = useNotesStore.getState();

  const compact = useWorkspaceStore((s) => s.contextCompact);
  const panelOpen = useWorkspaceStore((s) => (s.contextCompact ? s.contextOverlayOpen : s.contextPanelOpen));
  const setContextVisible = useWorkspaceStore((s) => s.setContextVisible);
  const setContextCompact = useWorkspaceStore((s) => s.setContextCompact);
  const toggleContextPanel = useWorkspaceStore((s) => s.toggleContextPanel);
  const rootRef = useRef<HTMLDivElement>(null);

  useVimEditor(editor);

  useEffect(() => {
    if (editor) {
      setEditor(editor, noteId);
    }
    return () => {
      if (useUiStore.getState().editor === editor) setEditor(null);
    };
  }, [editor, noteId, setEditor]);

  // Sized from the pane, not the window: the sidebar and AI panel also take room.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => {
      setContextCompact(entry.contentRect.width < COMPACT_PANE_WIDTH);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [setContextCompact, editor]);

  const exportAsMarkdown = async () => {
    if (!editor || !currentNote) return;

    try {
      const markdown = await editor.blocksToMarkdownLossy(editor.document);
      const filename = `${currentNote.title || 'Untitled'}.md`;

      if (!isTauri()) {
        const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
        toast.success('Exported as Markdown!');
        return;
      }

      const filePath = await save({
        defaultPath: filename,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });

      if (filePath) {
        await writeTextFile(filePath, markdown);
        toast.success('Exported as Markdown!');
      }
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Export failed');
    }
  };

  const exportAsPDF = async () => {
    if (!editor || !currentNote) return;
    const toastId = toast.loading('Exporting PDF…', { position: 'bottom-right' });

    try {
      const html = await editor.blocksToHTMLLossy(editor.document);
      const title = escapeHtml(currentNote.title || 'Untitled');

      // Create a hidden iframe for printing (works in Tauri)
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = 'none';
      document.body.appendChild(iframe);

      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) {
        toast.error('Failed to create print preview', { id: toastId });
        document.body.removeChild(iframe);
        return;
      }

      iframeDoc.open();
      iframeDoc.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>${title}</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                line-height: 1.6;
                max-width: 800px;
                margin: 0 auto;
                padding: 40px 20px;
                color: #1a1a1a;
              }
              h1 { font-size: 2em; margin-bottom: 0.5em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
              h2 { font-size: 1.5em; margin-top: 1.5em; }
              h3 { font-size: 1.25em; }
              p { margin: 1em 0; }
              ul, ol { padding-left: 2em; }
              li { margin: 0.5em 0; }
              code { background: #f4f4f4; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }
              pre { background: #f4f4f4; padding: 1em; border-radius: 5px; overflow-x: auto; }
              blockquote { border-left: 4px solid #ddd; margin: 1em 0; padding-left: 1em; color: #666; }
              img { max-width: 100%; height: auto; }
              table { border-collapse: collapse; width: 100%; margin: 1em 0; }
              th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
              th { background: #f4f4f4; }
              .logia-print-diagram, .logia-print-artifact { margin: 1em 0; break-inside: avoid; }
              .logia-print-diagram { text-align: center; }
              .logia-print-diagram svg { max-width: 100%; height: auto; }
              .logia-print-artifact { min-height: 120px; padding: 12px; border: 1px solid #27272a; border-radius: 8px; background: #0a0908; overflow: hidden; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .logia-print-artifact img { display: block; width: 100%; height: auto; }
              @media print {
                body { padding: 0; }
              }
            </style>
          </head>
          <body>
            ${html}
          </body>
        </html>
      `);
      iframeDoc.close();

      // Swap Mermaid and artifact sources for their rendered output.
      await renderLiveBlocksForPrint(iframeDoc.body, (done, total) => {
        toast.loading(`Rendering diagrams and artifacts ${done}/${total}…`, { id: toastId, position: 'bottom-right' });
      });
      // Images must be decoded before printing or they can print blank.
      await Promise.all(Array.from(iframeDoc.images, (img) => img.decode().catch(() => undefined)));
      toast.success('Opening print dialog…', { id: toastId, position: 'bottom-right' });

      // Wait a bit for styles to apply, then print
      setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();

        // Clean up after a delay (print dialog may still be open)
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1000);
      }, 250);
    } catch (error) {
      console.error('PDF export failed:', error);
      toast.error('PDF export failed', { id: toastId, position: 'bottom-right' });
    }
  };

  if (!editor) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-zinc-950">
        <div className="text-[13px] text-zinc-500">Loading editor…</div>
      </div>
    );
  }

  const getBreadcrumbPath = () => {
    if (!currentNote?.folder_id) return [];

    const path: typeof folders = [];
    let currentFolderId: string | undefined = currentNote.folder_id;

    let iterations = 0;
    while (currentFolderId && iterations < 50) {
      const folder = folders.find(f => f.id === currentFolderId);
      if (folder) {
        path.unshift(folder);
        currentFolderId = folder.parent_id;
      } else {
        break;
      }
      iterations++;
    }
    return path;
  };

  const breadcrumbs = getBreadcrumbPath();

  const backlinks = currentNote ? cachedBacklinks(currentNote, notes, folders) : [];

  return (
    <div
      ref={rootRef}
      data-note-editor={currentNote?.id}
      className="flex h-full min-h-0 w-full flex-col bg-zinc-950"
    >
      <div className="flex h-9 flex-shrink-0 items-center justify-between gap-2 pl-3 pr-1.5">
        <nav aria-label="Note location" className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-xs text-zinc-500">
          {breadcrumbs.map((folder, index) => (
            <Fragment key={folder.id}>
              <span className="hidden max-w-[10rem] truncate sm:inline" title={folder.name}>{folder.name}</span>
              {index < breadcrumbs.length - 1 && <span className="hidden text-zinc-700 sm:inline" aria-hidden="true">/</span>}
            </Fragment>
          ))}
        </nav>

        <div className="flex flex-shrink-0 items-center gap-0.5">
          <Tip label="Notes that link here">
            <button
              type="button"
              onClick={revealBacklinks}
              className="flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-100"
              aria-label={`Backlinks: ${backlinks.length} ${backlinks.length === 1 ? "note links" : "notes link"} here`}
            >
              <Link2 size={14} />
              <span className="tabular-nums">{backlinks.length}</span>
            </button>
          </Tip>

          <IconButton
            label={panelOpen ? "Hide note context" : "Show note context"}
            hint={`${panelOpen ? "Hide" : "Show"} outline, tags and links`}
            shortcut={SHORTCUTS.contextPanel}
            active={panelOpen}
            aria-pressed={panelOpen}
            aria-keyshortcuts={shortcutAria(SHORTCUTS.contextPanel)}
            onClick={toggleContextPanel}
          >
            <PanelRightDashed size={15} />
          </IconButton>

          <IconButton
            label={currentNote?.starred ? "Unstar note" : "Star note"}
            hint={currentNote?.starred ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={!!currentNote?.starred}
            className={currentNote?.starred ? "!text-amber-300" : ""}
            onClick={() => currentNote && toggleStar(currentNote.id)}
          >
            <Star size={15} className={currentNote?.starred ? "fill-current" : ""} />
          </IconButton>

          <Menu>
            <MenuTrigger asChild>
              <IconButton label="Export note" hint="Export">
                <Download size={15} />
              </IconButton>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem icon={<FileText size={14} />} onSelect={() => void exportAsMarkdown()}>Markdown (.md)</MenuItem>
              <MenuItem icon={<FileType size={14} />} onSelect={() => void exportAsPDF()}>PDF (Print)</MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>

      {/* Below the toolbar, so opening the panel can't move the toolbar's buttons. */}
      <div className="relative flex min-h-0 flex-1">
        {/* BlockNote Editor */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <BlockNoteView
            editor={editor}
            formattingToolbar={false}
            slashMenu={false}
            className="note-editor-view mx-auto min-h-full max-w-[828px] pb-32 pt-2 sm:pt-8"
            data-theming-css-variables-demo
          >
            {/* AI Menu - Only show if API key is present */}
            {hasAI && <AIMenuController />}

            {/* Custom Formatting Toolbar */}
            <FormattingToolbarWithAI />

            {/* Custom Suggestion Menu */}
            <SuggestionMenuWithAI editor={editor} />
          </BlockNoteView>
        </div>

        {panelOpen && currentNote && (
          <NoteContextPanel
            note={currentNote}
            notes={notes}
            folders={folders}
            editor={editor}
            backlinks={backlinks}
            compact={compact}
            onClose={() => setContextVisible(false)}
          />
        )}
      </div>
    </div>
  );
}
