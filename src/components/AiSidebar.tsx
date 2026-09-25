import { PromptInputBox } from "@/components/ui/ai-prompt-box";
import { useNotesStore } from "@/store/notesStore";
import { SuggestionCard } from "./chat/SuggestionCard";
import { countWordsInNoteContent } from "@/lib/note-utils";
import useUiStore from "../store/UiStore";
import { Resizable } from "re-resizable";
import { useState, useEffect, useRef } from "react";
import { activeProvider, friendlyAiError, streamChat } from "../lib/ai/client";
import { isProviderReady } from "../store/settingsStore";
import { ProviderSwitcher } from "./ProviderSwitcher";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  User,
  Sparkles,
  Calendar as CalendarIcon,
  Hash,
  AlignLeft,
  ChevronLeft,
  ChevronRight,
  FileText,
  Square,
  Star,
  Clock,
  Folder as FolderIcon,
  Type,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import toast from "react-hot-toast";

interface AiSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = "chat" | "calendar" | "info";

const AiSidebar = ({ isOpen, onClose }: AiSidebarProps) => {
  const { currentNote, notes, folders, selectNote } = useNotesStore();
  const setIsSettingsOpen = useUiStore((s) => s.setIsSettingsOpen);
  const [activeTab, setActiveTab] = useState<Tab>("chat");

  // Chat State - includes actionStatus for persistence
  const [messagesMap, setMessagesMap] = useState<
    Record<string, { role: "user" | "assistant"; content: string; actionStatus?: "pending" | "approved" | "refused" }[]>
  >({});
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<string>("");
  const scrollableContainerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Calendar State
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());

  const messages = currentNote ? messagesMap[currentNote.id] || [] : [];

  // Function to update action status for a message
  const updateMessageStatus = (messageIndex: number, status: "pending" | "approved" | "refused") => {
    if (!currentNote) return;
    setMessagesMap((prev) => {
      const noteMessages = [...(prev[currentNote.id] || [])];
      if (noteMessages[messageIndex]) {
        noteMessages[messageIndex] = { ...noteMessages[messageIndex], actionStatus: status };
      }
      return { ...prev, [currentNote.id]: noteMessages };
    });
  };

  useEffect(() => {
    if (scrollableContainerRef.current) {
      scrollableContainerRef.current.scrollTop =
        scrollableContainerRef.current.scrollHeight;
    }
  }, [messages, streamingMessage, activeTab]);

  const handleSendMessage = async (message: string) => {
    if (!message.trim() || isLoading) return;
    const provider = activeProvider();
    if (!isProviderReady(provider.id)) {
      toast.error(`${provider.label} isn't set up yet.`);
      setIsSettingsOpen(true, 'ai');
      return;
    }
    if (!currentNote) return;
    const userMessage = { role: "user" as const, content: message };
    setMessagesMap((prev) => ({
      ...prev,
      [currentNote.id]: [...(prev[currentNote.id] || []), userMessage],
    }));
    setIsLoading(true);
    setStreamingMessage("");

    try {
      const systemPrompt = `You are DaddyAI, a helpful AI assistant in a note-taking app called Logia.

CAPABILITIES:
1. Chat: Answer questions normally.
2. Edit: You can ADD, UPDATE, DELETE, or REPLACE content in the note.

=== INSERT ACTIONS ===

FOR CODE BLOCKS:
{ "type": "editor_action", "action": "insertCode", "description": "Adding code example", "data": { "code": "your code here", "language": "rust" } }

FOR HEADINGS (plain text only, no tables/lists inside):
{ "type": "editor_action", "action": "insertHeading", "description": "Adding section", "data": { "text": "Heading Text", "level": 2 } }

FOR PLAIN TEXT:
{ "type": "editor_action", "action": "insertText", "description": "Adding paragraph", "data": { "text": "Your text here" } }

FOR TABLES:
{ "type": "editor_action", "action": "insertTable", "description": "Adding table", "data": { "headers": ["Column 1", "Column 2"], "rows": [["value1", "value2"], ["value3", "value4"]] } }

FOR LISTS:
{ "type": "editor_action", "action": "insertList", "description": "Adding list", "data": { "items": ["Item 1", "Item 2", "Item 3"], "ordered": false } }

=== EDIT ACTIONS ===

TO UPDATE EXISTING CONTENT (find by text, then change):
{ "type": "editor_action", "action": "update", "description": "Fixing typo in X", "data": { "searchText": "text to find", "newContent": "corrected text" } }

TO DELETE CONTENT:
{ "type": "editor_action", "action": "delete", "description": "Removing section", "data": { "searchText": "text in block to delete" } }

TO REPLACE CONTENT:
{ "type": "editor_action", "action": "replace", "description": "Replacing X with Y", "data": { "searchText": "old text", "newContent": "new replacement text" } }

=== RULES ===
- Only output JSON when user asks to edit/add/delete/change the note
- Use "searchText" to find existing content (a unique phrase from that block)
- For regular chat, just respond normally without JSON
- Keep descriptions short and clear
- IMPORTANT: Headings can ONLY contain plain text - never put tables or lists inside headings
- For tables, use insertTable action NOT insertHeading or insertText
- Each action should be a separate JSON object
`;
      const noteContext = currentNote
        ? `\n\nContext:\n---\n${currentNote.content}\n---`
        : "";

      const controller = new AbortController();
      abortRef.current = controller;
      let fullResponse = "";
      for await (const text of streamChat({
        system: systemPrompt + noteContext,
        messages: [...messages, userMessage].map(({ role, content }) => ({ role, content })),
        signal: controller.signal,
        provider,
      })) {
        fullResponse = text;
        setStreamingMessage(text);
      }

      if (controller.signal.aborted && !fullResponse.trim()) {
        fullResponse = "_Stopped._";
      }
      const assistantMessage = {
        role: "assistant" as const,
        content: fullResponse,
      };
      setMessagesMap((prev) => ({
        ...prev,
        [currentNote.id]: [...(prev[currentNote.id] || []), assistantMessage],
      }));
      setStreamingMessage("");
    } catch (error: unknown) {
      const aborted = abortRef.current?.signal.aborted;
      if (!aborted) console.error("AI error:", error);
      const errorMessage = aborted ? "_Stopped._" : friendlyAiError(error, provider);

      setMessagesMap((prev) => ({
        ...prev,
        [currentNote.id]: [
          ...(prev[currentNote.id] || []),
          { role: "assistant", content: errorMessage },
        ],
      }));
      setStreamingMessage("");
    } finally {
      abortRef.current = null;
      setIsLoading(false);
    }
  };

  const stopGeneration = () => abortRef.current?.abort();

  // Prompts sent from elsewhere (e.g. the vim `:ai <prompt>` command)
  const pendingAiPrompt = useUiStore((s) => s.pendingAiPrompt);
  useEffect(() => {
    if (!pendingAiPrompt || !isOpen || !currentNote || isLoading) return;
    useUiStore.getState().setPendingAiPrompt(null);
    setActiveTab("chat");
    void handleSendMessage(pendingAiPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAiPrompt, isOpen, currentNote?.id, isLoading]);

  const folderName = currentNote?.folder_id
    ? folders.find((f) => f.id === currentNote.folder_id)?.name
    : undefined;
  const wordCount = currentNote ? countWordsInNoteContent(currentNote.content) : 0;
  const clearChat = () => {
    if (!currentNote) return;
    setMessagesMap((prev) => ({ ...prev, [currentNote.id]: [] }));
  };

  // Calendar Logic
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 = Sunday

    // Adjust for Monday start if needed, but let's stick to Sunday start for simplicity or match screenshot
    // Screenshot shows Sunday start (Su Mo Tu ...)

    const days = [];
    // Previous month filler
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(null);
    }
    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }
    return days;
  };

  const calendarDays = getDaysInMonth(currentDate);

  // Notes touched per day (by last update), for activity dots and the day list
  const notesByDay = new Map<string, typeof notes>();
  for (const note of notes) {
    const key = new Date(note.updated_at).toDateString();
    const list = notesByDay.get(key);
    if (list) list.push(note);
    else notesByDay.set(key, [note]);
  }
  const selectedDayNotes = notesByDay.get(selectedDay.toDateString()) ?? [];

  const prevMonth = () =>
    setCurrentDate(
      new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1),
    );
  const nextMonth = () =>
    setCurrentDate(
      new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1),
    );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: "auto", opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          style={{ height: "100%" }}
        >
          <Resizable
            defaultSize={{ width: 320, height: "100%" }}
            enable={{ left: true }}
            minWidth={300}
            maxWidth={600}
            handleClasses={{
              left: "w-1 bg-zinc-800 hover:bg-zinc-600 transition-colors",
            }}
          >
            <div className="h-full bg-zinc-950 border-l border-zinc-800 flex flex-col shadow-2xl">
              {/* Top Tabs Bar */}
              <div className="flex items-center justify-between px-2 py-2 border-b border-zinc-900 bg-zinc-950 sticky top-0 z-10">
                <div className="flex items-center gap-1 bg-zinc-900/50 p-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setActiveTab("chat")}
                    className={`p-1.5 rounded-md transition-all ${activeTab === "chat" ? "bg-zinc-800 text-zinc-100 shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}
                    title="AI Chat"
                    aria-pressed={activeTab === "chat"}
                  >
                    <Sparkles size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("calendar")}
                    className={`p-1.5 rounded-md transition-all ${activeTab === "calendar" ? "bg-zinc-800 text-zinc-100 shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}
                    title="Calendar"
                    aria-pressed={activeTab === "calendar"}
                  >
                    <CalendarIcon size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("info")}
                    className={`p-1.5 rounded-md transition-all ${activeTab === "info" ? "bg-zinc-800 text-zinc-100 shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}
                    title="Note info"
                    aria-pressed={activeTab === "info"}
                  >
                    <Hash size={16} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                  title="Close AI sidebar"
                  aria-label="Close AI sidebar"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              {/* Content Area */}
              <div className="flex-1 overflow-hidden relative flex flex-col bg-zinc-950">
                {/* --- CHAT VIEW --- */}
                {activeTab === "chat" && (
                  <>
                    <div
                      ref={scrollableContainerRef}
                      className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent"
                    >
                      {!currentNote ? (
                        <div className="h-full flex flex-col items-center justify-center text-center p-6 mt-10">
                          <div className="relative bg-zinc-900 p-4 rounded-xl border border-zinc-800 shadow-lg mb-4">
                            <FileText size={28} className="text-zinc-400" />
                          </div>
                          <h3 className="text-zinc-100 text-base font-semibold mb-1">
                            Open a note to chat
                          </h3>
                          <p className="text-zinc-500 text-sm max-w-[220px]">
                            AI chat is tied to the active note. Create or select one from the sidebar.
                          </p>
                        </div>
                      ) : messages.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center p-6 mt-10">
                          <div className="mb-6 relative">
                            <div className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full"></div>
                            <div className="relative bg-zinc-900 p-4 rounded-xl border border-zinc-800 shadow-lg">
                              <Sparkles size={32} className="text-blue-400" />
                            </div>
                          </div>
                          <h3 className="text-zinc-100 text-lg font-semibold mb-2">
                            What can I help you with?
                          </h3>
                          <div className="flex flex-col gap-2 mt-6 w-full max-w-xs">
                            <button
                              type="button"
                              disabled={isLoading}
                              onClick={() => handleSendMessage("Summarize this note")}
                              className="flex items-center gap-3 w-full p-3 rounded-lg bg-zinc-900/40 hover:bg-zinc-900 border border-zinc-800/50 hover:border-zinc-700 transition-all group text-left disabled:opacity-50"
                            >
                              <span className="text-zinc-500 group-hover:text-blue-400 transition-colors">
                                <AlignLeft size={16} />
                              </span>
                              <span className="text-zinc-400 text-sm group-hover:text-zinc-200">
                                Summarize this note
                              </span>
                            </button>
                            <button
                              type="button"
                              disabled={isLoading}
                              onClick={() => handleSendMessage("Brainstorm ideas related to this note")}
                              className="flex items-center gap-3 w-full p-3 rounded-lg bg-zinc-900/40 hover:bg-zinc-900 border border-zinc-800/50 hover:border-zinc-700 transition-all group text-left disabled:opacity-50"
                            >
                              <span className="text-zinc-500 group-hover:text-blue-400 transition-colors">
                                <Sparkles size={16} />
                              </span>
                              <span className="text-zinc-400 text-sm group-hover:text-zinc-200">
                                Brainstorm ideas
                              </span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        messages.map((msg, index) => {
                          // Extract ALL action objects from the message
                          let actionDataList: any[] = [];
                          let textContent = msg.content;

                          if (msg.role === "assistant") {
                            // Find all JSON objects or arrays in the content
                            const content = msg.content;
                            let searchStart = 0;

                            while (searchStart < content.length) {
                              // Look for start of JSON (object or array)
                              let startChar = '';
                              let startIdx = -1;

                              const objStart = content.indexOf("{", searchStart);
                              const arrStart = content.indexOf("[", searchStart);

                              if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
                                startIdx = objStart;
                                startChar = "{";
                              } else if (arrStart !== -1) {
                                startIdx = arrStart;
                                startChar = "[";
                              }

                              if (startIdx === -1) break;

                              const endChar = startChar === "{" ? "}" : "]";
                              let depth = 0;
                              let endIdx = -1;

                              for (let i = startIdx; i < content.length; i++) {
                                if (content[i] === startChar) depth++;
                                else if (content[i] === endChar) {
                                  depth--;
                                  if (depth === 0) {
                                    endIdx = i;
                                    break;
                                  }
                                }
                              }

                              if (endIdx !== -1) {
                                const jsonStr = content.substring(startIdx, endIdx + 1);
                                try {
                                  const parsed = JSON.parse(jsonStr);

                                  // Handle array of actions
                                  if (Array.isArray(parsed)) {
                                    parsed.forEach((item: any) => {
                                      if (item.type === "editor_action") {
                                        actionDataList.push(item);
                                      }
                                    });
                                    // Remove the array from text content
                                    textContent = textContent.replace(jsonStr, "").trim();
                                  }
                                  // Handle single action object
                                  else if (parsed.type === "editor_action") {
                                    actionDataList.push(parsed);
                                    // Remove from text content
                                    textContent = textContent.replace(jsonStr, "").trim();
                                  }
                                } catch (e) {
                                  // JSON parse failed, skip
                                }
                                searchStart = endIdx + 1;
                              } else {
                                break;
                              }
                            }

                            // Clean up any leftover brackets or commas
                            textContent = textContent.replace(/^\s*[\[\],\s]+\s*$/, "").trim();
                          }

                          return (
                            <div
                              key={index}
                              className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
                            >
                              <div
                                className={`flex-shrink-0 mt-1 size-7 rounded-sm flex items-center justify-center ${msg.role === "user" ? "bg-zinc-800" : "bg-transparent"}`}
                              >
                                {msg.role === "user" ? (
                                  <User size={14} className="text-zinc-400" />
                                ) : (
                                  <Sparkles size={16} className="text-blue-400" />
                                )}
                              </div>
                              <div
                                className={`flex-1 text-sm leading-relaxed ${msg.role === "user" ? "bg-zinc-800 text-zinc-100 px-3 py-2 rounded-lg" : "text-zinc-300"}`}
                              >
                                {textContent && (
                                  <div className={actionDataList.length > 0 ? "mb-3" : ""}>
                                    <Markdown remarkPlugins={[remarkGfm]}>
                                      {textContent}
                                    </Markdown>
                                  </div>
                                )}
                                {actionDataList.length > 0 && (
                                  <SuggestionCard
                                    actionDataList={actionDataList}
                                    status={msg.actionStatus || "pending"}
                                    onStatusChange={(status) => updateMessageStatus(index, status)}
                                  />
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}

                      {isLoading && (
                        <div className="flex gap-3">
                          <div className="mt-1">
                            <Sparkles
                              size={16}
                              className="text-blue-400 animate-pulse"
                            />
                          </div>
                          <div className="flex-1 text-sm text-zinc-300">
                            {streamingMessage ? (
                              // Check if streaming content looks like an action JSON
                              streamingMessage.includes('"type": "editor_action"') ||
                                streamingMessage.includes('"type":"editor_action"') ? (
                                <div className="flex items-center gap-2">
                                  <div className="size-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                                  <span className="text-zinc-400 italic">
                                    Evaluating action...
                                  </span>
                                </div>
                              ) : (
                                <Markdown remarkPlugins={[remarkGfm]}>
                                  {streamingMessage}
                                </Markdown>
                              )
                            ) : (
                              <span className="text-zinc-500 italic animate-pulse">
                                Thinking...
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={stopGeneration}
                              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 transition-colors"
                            >
                              <Square size={10} className="fill-current" /> Stop
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    {currentNote && (
                      <div className="p-3 pt-2 bg-zinc-950 border-t border-zinc-900/50" data-vim-escape-to-editor>
                        <div className="flex items-center justify-between mb-2">
                          <ProviderSwitcher />
                          {messages.length > 0 && !isLoading && (
                            <button
                              type="button"
                              onClick={clearChat}
                              className="p-1 rounded text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900 transition-colors"
                              title="Clear chat"
                              aria-label="Clear chat"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                        <PromptInputBox
                          onSend={handleSendMessage}
                          isLoading={isLoading}
                        />
                      </div>
                    )}
                  </>
                )}

                {/* --- CALENDAR VIEW --- */}
                {activeTab === "calendar" && (
                  <div className="flex flex-col h-full bg-zinc-950 p-4">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-zinc-100 font-semibold text-lg">
                        {currentDate.toLocaleString("default", {
                          month: "short",
                        })}{" "}
                        <span className="text-zinc-500">
                          {currentDate.getFullYear()}
                        </span>
                      </h2>
                      <div className="flex gap-1">
                        <button
                          onClick={prevMonth}
                          className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 rounded"
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <button
                          onClick={() => setCurrentDate(new Date())}
                          className="text-xs font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 px-2 rounded"
                        >
                          TODAY
                        </button>
                        <button
                          onClick={nextMonth}
                          className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 rounded"
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-7 gap-1 text-center mb-2">
                      {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
                        <div
                          key={day}
                          className="text-xs font-medium text-zinc-600 py-1"
                        >
                          {day}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-1 content-start">
                      {calendarDays.map((date, i) => {
                        if (!date) return <div key={i} className="aspect-square" />;
                        const isToday = date.toDateString() === new Date().toDateString();
                        const isSelected = date.toDateString() === selectedDay.toDateString();
                        const count = notesByDay.get(date.toDateString())?.length ?? 0;
                        return (
                          <button
                            type="button"
                            key={i}
                            onClick={() => setSelectedDay(date)}
                            className={`relative aspect-square flex items-center justify-center text-sm rounded-md transition-colors
                              ${isToday ? "bg-blue-600 text-white font-medium shadow-lg shadow-blue-500/20" : isSelected ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"}
                            `}
                            aria-label={`${date.toDateString()}${count ? `, ${count} notes updated` : ""}`}
                            aria-pressed={isSelected}
                          >
                            {date.getDate()}
                            {count > 0 && (
                              <span className={`absolute bottom-1 size-1 rounded-full ${isToday ? "bg-white" : "bg-blue-400"}`} />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-5 border-t border-zinc-900 pt-4 min-h-0 flex-1 overflow-y-auto">
                      <p className="text-xs font-medium text-zinc-500 mb-2 px-1">
                        {selectedDay.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
                      </p>
                      {selectedDayNotes.length === 0 ? (
                        <p className="text-xs text-zinc-600 px-1">No notes updated this day.</p>
                      ) : (
                        <ul className="space-y-0.5">
                          {selectedDayNotes.map((note) => (
                            <li key={note.id}>
                              <button
                                type="button"
                                onClick={() => selectNote(note)}
                                className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md text-left transition-colors ${currentNote?.id === note.id ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"}`}
                              >
                                <FileText size={13} className="flex-shrink-0 text-zinc-500" />
                                <span className="truncate">{note.title || "Untitled"}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}

                {/* --- NOTE INFO VIEW --- */}
                {activeTab === "info" && (
                  <div className="flex flex-col h-full bg-zinc-950 overflow-y-auto p-4">
                    {!currentNote ? (
                      <p className="text-sm text-zinc-500 text-center mt-10">
                        Open a note to see its details.
                      </p>
                    ) : (
                      <>
                        <h3 className="text-zinc-100 font-medium text-sm mb-4 truncate" title={currentNote.title}>
                          {currentNote.title || "Untitled"}
                        </h3>
                        <dl className="space-y-1">
                          {[
                            { icon: <Type size={14} />, label: "Type", value: currentNote.note_type === "canvas" ? "Canvas" : "Text" },
                            { icon: <AlignLeft size={14} />, label: "Words", value: currentNote.note_type === "canvas" ? "—" : wordCount.toLocaleString() },
                            { icon: <FolderIcon size={14} />, label: "Folder", value: folderName ?? "Root" },
                            { icon: <Star size={14} />, label: "Starred", value: currentNote.starred ? "Yes" : "No" },
                            { icon: <CalendarIcon size={14} />, label: "Created", value: new Date(currentNote.created_at).toLocaleString() },
                            { icon: <Clock size={14} />, label: "Updated", value: new Date(currentNote.updated_at).toLocaleString() },
                          ].map((item) => (
                            <div
                              key={item.label}
                              className="flex items-center justify-between gap-3 py-1.5 px-2 rounded-md hover:bg-zinc-900/60 transition-colors"
                            >
                              <dt className="flex items-center gap-3 text-zinc-500">
                                <span className="opacity-70">{item.icon}</span>
                                <span className="text-sm">{item.label}</span>
                              </dt>
                              <dd className="text-xs text-zinc-300 truncate text-right">{item.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

          </Resizable>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AiSidebar;
