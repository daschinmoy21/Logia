import { BlockNoteEditor, filterSuggestionItems } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { ReactNode, useEffect, createContext, useContext, useRef } from "react";
import { codeBlock } from "@blocknote/code-block";
import {
  AIMenuController,
  AIToolbarButton,
  createAIExtension,
  getAISlashMenuItems,
} from "@blocknote/xl-ai";
import { en as aiEn } from "@blocknote/xl-ai/locales";
import "@blocknote/xl-ai/style.css";
import { en } from "@blocknote/core/locales";
import {
  FormattingToolbar,
  FormattingToolbarController,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  getFormattingToolbarItems,
} from "@blocknote/react";
import { Note } from "../store/notesStore";
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';


type EditorContextType = {
  editor: ReturnType<typeof useCreateBlockNote>;
  updateCurrentNoteTitle: (title: string) => void;
};

const EditorContext = createContext<EditorContextType | null>(null);

export function useEditorContext() {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error("useEditorContext must be used within EditorProvider");
  }
  return context;
}

// Create provider with API key from environment variables
// const provider = createGroq({
//   apiKey: import.meta.env.VITE_GROQ_API_KEY,
// });
const model = google("gemini-2.5-flash");


export function EditorProvider({
  children,
  currentNote,
  updateCurrentNoteContent,
  updateCurrentNoteTitle,
}: {
  children: ReactNode;
  currentNote: Note;
  updateCurrentNoteContent: (content: string) => void;
  updateCurrentNoteTitle: (title: string) => void;
}) {
  const isUpdatingRef = useRef(false);

  // Always call the hook to maintain consistent order
  const editor = useCreateBlockNote({
    tables: {
      splitCells: true,
      cellBackgroundColor: true,
      cellTextColor: true,
      headers: true
    },
    codeBlock,
    dictionary: {
      ...en,
      ai: aiEn,
    },
    extensions: [
      createAIExtension({
        model,
      }),
    ],
    initialContent: currentNote?.content ? JSON.parse(currentNote.content) : undefined,
  });

  // Update editor content when currentNote changes
  useEffect(() => {
    if (currentNote && !isUpdatingRef.current) {
      console.log('Updating editor content for note:', currentNote.id, 'content length:', currentNote.content?.length);
      try {
        const content = currentNote.content ? JSON.parse(currentNote.content) : [];
        editor.replaceBlocks(editor.document, content);
        console.log('Editor content updated with', content.length, 'blocks');
      } catch (error) {
        // If content is not valid JSON, treat as plain text
        console.warn("Invalid JSON content, treating as plain text");
        editor.replaceBlocks(editor.document, [
          {
            type: "paragraph",
            content: currentNote.content || "",
          },
        ]);
      }
    }
  }, [currentNote?.id, currentNote?.content, editor]); // Trigger when note ID or content changes

  // Handle content changes with auto-save
  useEffect(() => {
    const handleChange = () => {
      if (currentNote && !isUpdatingRef.current) {
        isUpdatingRef.current = true;

        // Get the current document content
        const content = JSON.stringify(editor.document);
        updateCurrentNoteContent(content);

        // Reset the flag after a short delay
        setTimeout(() => {
          isUpdatingRef.current = false;
        }, 100);
      }
    };

    // Listen for editor changes
    editor.onChange(handleChange);

    return () => {
      // Cleanup if needed
    };
  }, [editor, currentNote, updateCurrentNoteContent]);

  return (
    <EditorContext.Provider value={{ editor, updateCurrentNoteTitle }}>
      {children}
    </EditorContext.Provider>
  );
}

// Formatting toolbar with the `AIToolbarButton` added
export function FormattingToolbarWithAI({ editor }: { editor: BlockNoteEditor<any, any, any> }) {
  return (
    <FormattingToolbarController
      formattingToolbar={() => (
        <FormattingToolbar>
          {...getFormattingToolbarItems()}
          {/* Add the AI button */}
          {/* <AIToolbarButton /> */}
        </FormattingToolbar>
      )}
    />
  );
}

// Slash menu with the AI option added
export function SuggestionMenuWithAI({ editor }: { editor: BlockNoteEditor<any, any, any> }) {
  return (
    <SuggestionMenuController
      triggerCharacter="/"
      getItems={async (query) =>
        filterSuggestionItems(
          [
            ...getDefaultReactSlashMenuItems(editor),
            // add the default AI slash menu items, or define your own
            ...getAISlashMenuItems(editor),
          ],
          query,
        )
      }
    />
  );
}
