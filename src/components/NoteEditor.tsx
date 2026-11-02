import { BlockNoteView } from "@blocknote/mantine";
import { Fragment, useEffect, useState, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  useEditorContext,
  FormattingToolbarWithAI,
  SuggestionMenuWithAI,
} from "./EditorProvider";

import { AIMenuController } from "@blocknote/xl-ai";
import useUiStore from "../store/UiStore";
import { useNotesStore } from "../store/notesStore";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Slash, Star, Download, FileText, FileType, Link2, PanelRightDashed } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import toast from "react-hot-toast";
import { useVimEditor } from "../hooks/useVimEditor";
import { cachedBacklinks, NoteContextPanel } from "./workspace/NoteContextPanel";
import { goHome, revealBacklinks } from "./workspace/actions";
import { useLinkNotes } from "./workspace/noteMeta";
import { useWorkspaceStore } from "./workspace/workspaceStore";
import { SHORTCUTS, shortcutAria, shortcutText } from "./workspace/shortcuts";

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

  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

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

  // Close export menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    if (showExportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showExportMenu]);

  const exportAsMarkdown = async () => {
    if (!editor || !currentNote) return;
    setShowExportMenu(false);

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
    setShowExportMenu(false);

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
        toast.error('Failed to create print preview');
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

      // Wait a bit for styles to apply, then print
      setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();

        // Clean up after a delay (print dialog may still be open)
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1000);
      }, 250);

      toast.success('Opening print dialog...');
    } catch (error) {
      console.error('PDF export failed:', error);
      toast.error('PDF export failed');
    }
  };

  if (!editor) {
    return (
      <div className="flex flex-col w-full h-full bg-zinc-930 items-center justify-center">
        <div className="text-zinc-400">Loading editor...</div>
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
      className="relative flex h-full min-h-0 w-full bg-zinc-950"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 flex-shrink-0 items-center justify-between gap-2 px-3 sm:px-6">
          <div className="min-w-0 flex-1 overflow-hidden">
            <Breadcrumb>
              <BreadcrumbList className="flex-nowrap">
                <BreadcrumbItem>
                  <BreadcrumbLink asChild className="text-zinc-500 hover:text-zinc-300 text-xs">
                    <button type="button" onClick={() => goHome()}>Home</button>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator><Slash className="size-3 text-zinc-600" /></BreadcrumbSeparator>

                {breadcrumbs.map((folder) => (
                  <Fragment key={folder.id}>
                    <BreadcrumbItem className="hidden min-w-0 sm:inline-flex">
                      <span className="max-w-[10rem] truncate text-xs text-zinc-500" title={folder.name}>
                        {folder.name}
                      </span>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden sm:list-item"><Slash className="size-3 text-zinc-600" /></BreadcrumbSeparator>
                  </Fragment>
                ))}

                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbPage className="block truncate text-zinc-300 text-xs font-medium">
                    {currentNote?.title || "Untitled"}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>

          <div className="flex flex-shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={revealBacklinks}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              title="Show notes that link here"
              aria-label={`Backlinks: ${backlinks.length} ${backlinks.length === 1 ? "note links" : "notes link"} here`}
            >
              <Link2 size={15} />
              <span className="tabular-nums">{backlinks.length}</span>
            </button>

            <button
              type="button"
              onClick={toggleContextPanel}
              className={`p-1.5 rounded-md transition-colors ${panelOpen
                ? "text-blue-400 bg-blue-400/10"
                : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
                }`}
              title={`${panelOpen ? "Hide" : "Show"} outline, tags and links (${shortcutText(SHORTCUTS.contextPanel)})`}
              aria-label={panelOpen ? "Hide note context" : "Show note context"}
              aria-pressed={panelOpen}
              aria-keyshortcuts={shortcutAria(SHORTCUTS.contextPanel)}
            >
              <PanelRightDashed size={16} />
            </button>

            <button
              type="button"
              onClick={() => currentNote && toggleStar(currentNote.id)}
              className={`p-1.5 hover:bg-zinc-800 rounded-md transition-colors ${currentNote?.starred
                ? 'text-yellow-400'
                : 'text-zinc-500 hover:text-yellow-400'
                }`}
              title={currentNote?.starred ? "Unstar" : "Star"}
              aria-label={currentNote?.starred ? "Unstar note" : "Star note"}
              aria-pressed={!!currentNote?.starred}
            >
              <Star size={16} className={currentNote?.starred ? "fill-yellow-400" : ""} />
            </button>

            {/* Export dropdown */}
            <div className="relative" ref={exportMenuRef}>
              <button
                type="button"
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors"
                title="Export"
                aria-label="Export note"
                aria-expanded={showExportMenu}
              >
                <Download size={16} />
              </button>

              {showExportMenu && (

                <div className="absolute right-0 top-full mt-1 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl py-1 min-w-[160px] z-50">
                  <p className="px-3 py-2 text-sm text-zinc-300">Share as:</p>
                  <button
                    onClick={exportAsMarkdown}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                  >
                    <FileText size={14} />
                    Markdown (.md)
                  </button>
                  <button
                    onClick={exportAsPDF}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                  >
                    <FileType size={14} />
                    PDF (Print)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* BlockNote Editor */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <BlockNoteView
            editor={editor}
            formattingToolbar={false}
            slashMenu={false}
            className="note-editor-view mx-auto min-h-full max-w-4xl bg-zinc-950 pb-24 pt-2 sm:pt-6"
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
  );
}
