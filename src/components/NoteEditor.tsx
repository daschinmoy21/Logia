import { BlockNoteView } from "@blocknote/mantine";
import {
  useEditorContext,
  FormattingToolbarWithAI,
  SuggestionMenuWithAI,
} from "./EditorProvider";
import { Note } from "../types/Note";
import { AIMenuController } from "@blocknote/xl-ai";

export function NoteEditor({
  currentNote,
  updateCurrentNoteTitle,
}: {
  currentNote: Note;
  updateCurrentNoteTitle: (title: string) => void;
}) {
  const { editor } = useEditorContext();

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      editor?.focus();
    }
  };

  if (!editor) {
    return (
      <div className="flex flex-col w-full h-full bg-zinc-930 items-center justify-center">
        <div className="text-zinc-400">Loading editor...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full bg-zinc-930">
      {/* Note title input */}
      <div className="ml-7 px-6 pt-6 pb-4 border-b border-zinc-700">
        <input
          type="text"
          value={currentNote?.title || ""}
          onChange={(e) => updateCurrentNoteTitle(e.target.value)}
          onKeyDown={handleTitleKeyDown}
          placeholder="Note title..."
          className="w-full bg-transparent text-2xl font-semibold text-zinc-100 placeholder-zinc-500 focus:outline-none"
        />
      </div>

      {/* BlockNote Editor */}
      <div className="flex-1">
        <BlockNoteView
          editor={editor}
          formattingToolbar={false}
          slashMenu={false}
          className="h-full bg-zinc-950 px-1 py-2"
          data-theming-css-variables-demo
        >
          {/* AI Menu */}
          <AIMenuController />

          {/* Custom Formatting Toolbar */}
          <FormattingToolbarWithAI />

          {/* Custom Suggestion Menu */}
          <SuggestionMenuWithAI editor={editor} />
        </BlockNoteView>
      </div>
    </div>
  );
}
