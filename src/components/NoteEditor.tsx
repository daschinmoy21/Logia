import { BlockNoteView } from "@blocknote/mantine";
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
import { Slash, Star, Upload } from "lucide-react";

export function NoteEditor() {
  const { editor } = useEditorContext();
  const { googleApiKey } = useUiStore();
  const { currentNote, folders } = useNotesStore();

  if (!editor) {
    return (
      <div className="flex flex-col w-full h-full bg-zinc-930 items-center justify-center">
        <div className="text-zinc-400">Loading editor...</div>
      </div>
    );
  }

  const getBreadcrumbPath = () => {
    if (!currentNote?.folder_id) return [];

    const path: typeof folders = []; // Explicit type for path array
    let currentFolderId: string | undefined = currentNote.folder_id;

    // Safety break to prevent infinite loops (though shouldn't happen with tree structure)
    let iterations = 0;
    while (currentFolderId && iterations < 50) {
      const folder = folders.find(f => f.id === currentFolderId);
      if (folder) {
        path.unshift(folder);
        currentFolderId = folder.parent_id; // Handle undefined assignment
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
          <button className="p-1.5 text-zinc-500 hover:text-yellow-400 hover:bg-zinc-800 rounded-md transition-colors" title="Favorite">
            <Star size={16} />
          </button>
          <button className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors" title="Export">
            <Upload size={16} />
          </button>
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
