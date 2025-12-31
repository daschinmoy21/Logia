import { BlockNoteView } from "@blocknote/mantine";
import { useEffect, useState, useRef } from "react";
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
import { Slash, Star, Download, FileText, FileType } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import toast from "react-hot-toast";

export function NoteEditor() {
  const { editor } = useEditorContext();
  const { googleApiKey, setEditor } = useUiStore();
  const currentNote = useNotesStore((state) => state.currentNote);
  const folders = useNotesStore((state) => state.folders);
  const { toggleStar } = useNotesStore.getState();

  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editor) {
      setEditor(editor);
    }
    return () => {
      setEditor(null);
    };
  }, [editor, setEditor]);

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
      const title = currentNote.title || 'Untitled';

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
            <h1>${title}</h1>
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

  return (
    <div className="flex flex-col w-full h-full bg-zinc-930 relative">
      {/* Breadcrumbs positioned above the editor */}
      <div className="absolute top-8 left-24 z-10 w-[calc(100%-8rem)] flex items-center justify-between pointer-events-none">
        {/* Pointer events auto for children to allow interaction */}
        <div className="pointer-events-auto overflow-hidden">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink className="text-zinc-500 hover:text-zinc-300 text-xs">Home</BreadcrumbLink>
              </BreadcrumbItem>
              {breadcrumbs.length > 0 && <BreadcrumbSeparator ><Slash className="size-3 text-zinc-600" /></BreadcrumbSeparator>}

              {breadcrumbs.map((folder) => (
                <div key={folder.id} className="flex items-center gap-1.5 sm:gap-2.5">
                  <BreadcrumbItem>
                    <BreadcrumbLink className="text-zinc-500 hover:text-zinc-300 text-xs text-nowrap">
                      {folder.name}
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator><Slash className="size-3 text-zinc-600" /></BreadcrumbSeparator>
                </div>
              ))}

              <BreadcrumbItem>
                <BreadcrumbPage className="text-zinc-300 text-xs font-medium truncate max-w-[200px]">
                  {currentNote?.title || "Untitled"}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>

        <div className="flex items-center gap-1 pointer-events-auto bg-zinc-930 pl-2">
          <button
            onClick={() => currentNote && toggleStar(currentNote.id)}
            className={`p-1.5 hover:bg-zinc-800 rounded-md transition-colors ${currentNote?.starred
              ? 'text-yellow-400'
              : 'text-zinc-500 hover:text-yellow-400'
              }`}
            title={currentNote?.starred ? "Unstar" : "Star"}
          >
            <Star size={16} className={currentNote?.starred ? "fill-yellow-400" : ""} />
          </button>

          {/* Export dropdown */}
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors"
              title="Export"
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
      <div className="flex-1">
        <BlockNoteView
          editor={editor}
          formattingToolbar={false}
          slashMenu={false}
          className="h-full bg-zinc-950 pl-24 pt-20 pr-12"
          data-theming-css-variables-demo
        >
          {/* AI Menu - Only show if API key is present */}
          {googleApiKey && <AIMenuController />}

          {/* Custom Formatting Toolbar */}
          <FormattingToolbarWithAI />

          {/* Custom Suggestion Menu */}
          <SuggestionMenuWithAI editor={editor} />
        </BlockNoteView>
      </div>
    </div>
  );
}
