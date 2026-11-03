import { useNotesStore } from "@/store/notesStore";
import type { Note } from "@/types/Note";
import { SuggestionCard } from "./chat/SuggestionCard";
import { EditApprovalPicker } from "./chat/EditApprovalPicker";
import { parseEditorActions } from "../lib/parse-editor-actions";
import { handleAiAction } from "../lib/editor-actions";
import { countWordsInNoteContent } from "@/lib/note-utils";
import useUiStore from "../store/UiStore";
import { Resizable } from "re-resizable";
import { useState, useEffect, useRef } from "react";
import { activeProvider, friendlyAiError, streamChat } from "../lib/ai/client";
import { isProviderReady } from "../store/settingsStore";
import { ModelPicker } from "./ModelPicker";
import { useSettingsStore } from "../store/settingsStore";
import { AgentChooser, type AgentSelection } from "./agent/AgentChooser";
import { AgentComposer } from "./agent/AgentComposer";
import { AgentChatPane } from "./agent/AgentChatPane";
import { closeAllAgentChats } from "./agent/agentChats";
import { closeAllAgentSessions, refreshAgentDetection } from "./agent/agentSessions";
import { AGENT_TOOLS } from "../lib/ai/agent-terminal";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Sparkles,
  Calendar as CalendarIcon,
  Info,
  AlignLeft,
  ChevronLeft,
  ChevronRight,
  FileText,
  Plus,
  Star,
  Clock,
  Folder as FolderIcon,
  Type,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { prefersReducedMotion } from "../lib/utils";
import { IconButton } from "./ui/kit";
import toast from "react-hot-toast";

interface AiSidebarProps {
  isOpen: boolean;
  /** Open only while hovered, floating over the note instead of docked beside it. */
  peek?: boolean;
  onPeekEnter?: () => void;
  onPeekLeave?: () => void;
  onClose: () => void;
}

type Tab = "chat" | "calendar" | "info";

interface LogiaMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actionStatus?: "pending" | "approved" | "refused";
  appliedCount?: number;
  applying?: boolean;
  actionError?: string;
}

/** Matches the app's narrow layout: too little room to dock beside the note. */
const COMPACT_QUERY = "(max-width: 767px)";

/** Terminal UIs need more room than chat, so opening an agent widens a narrow panel once. */
const TERMINAL_WIDTH = 480;

const noNotes: Note[] = [];

const AiSidebar = ({ isOpen, peek = false, onPeekEnter, onPeekLeave, onClose }: AiSidebarProps) => {
  const providerId = useSettingsStore((s) => s.activeProvider);
  const reduceMotion = prefersReducedMotion();
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [activeAgent, setActiveAgent] = useState<AgentSelection>("logia");
  const [includeNote, setIncludeNote] = useState(true);
  const [panelWidth, setPanelWidth] = useState(360);
  // A closed panel stays mounted to keep its chats, but shouldn't react to every keystroke.
  const currentNote = useNotesStore((s) => (isOpen ? s.currentNote : null));
  const notes = useNotesStore((s) => (isOpen && activeTab === "calendar" ? s.notes : noNotes));
  const folders = useNotesStore((s) => s.folders);
  const selectNote = useNotesStore((s) => s.selectNote);
  const setIsSettingsOpen = useUiStore((s) => s.setIsSettingsOpen);

  // Chat State - includes actionStatus for persistence
  const [messagesMap, setMessagesMap] = useState<Record<string, LogiaMessage[]>>({});
  const applyingMessages = useRef(new Set<string>());
  const [isLoading, setIsLoading] = useState(false);
  const [isCompact, setIsCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches);
  const [streamingMessage, setStreamingMessage] = useState<string>("");
  const scrollableContainerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Calendar State
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());

  const messages = currentNote ? messagesMap[currentNote.id] || [] : [];

  const patchMessage = (noteId: string, messageId: string, patch: Partial<LogiaMessage>) => {
    setMessagesMap((prev) => ({ ...prev, [noteId]: (prev[noteId] || []).map((msg) =>
      msg.id === messageId ? { ...msg, ...patch } : msg) }));
  };

  // Execution belongs to the thread, so remounting a card cannot replay its edits.
  const applyMessageActions = async (noteId: string, message: LogiaMessage) => {
    if (message.actionStatus === "approved" || message.actionStatus === "refused" || applyingMessages.current.has(message.id)) return;
    applyingMessages.current.add(message.id);
    patchMessage(noteId, message.id, { applying: true, actionError: undefined });
    let appliedCount = message.appliedCount ?? 0;
    const actions = parseEditorActions(message.content).actions;
    const originalEditor = useUiStore.getState().editor;
    try {
      for (; appliedCount < actions.length;) {
        const { editor, editorNoteId } = useUiStore.getState();
        if (!editor || editor !== originalEditor || editorNoteId !== noteId || useNotesStore.getState().currentNote?.id !== noteId) {
          throw new Error("Open the original note to apply these changes.");
        }
        await handleAiAction(editor, actions[appliedCount]);
        appliedCount++;
        patchMessage(noteId, message.id, { appliedCount });
      }
      patchMessage(noteId, message.id, { actionStatus: "approved" });
    } catch (error) {
      patchMessage(noteId, message.id, { actionError: error instanceof Error ? error.message : String(error) });
    } finally {
      applyingMessages.current.delete(message.id);
      patchMessage(noteId, message.id, { applying: false });
    }
  };

  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const onChange = () => setIsCompact(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Sessions outlive the panel's visibility, but not the panel itself or the window.
  useEffect(() => {
    const closeAgents = () => { closeAllAgentSessions(); closeAllAgentChats(); };
    window.addEventListener("beforeunload", closeAgents);
    return () => {
      window.removeEventListener("beforeunload", closeAgents);
      closeAgents();
    };
  }, []);

  // Detection only looks for binaries on PATH; nothing launches until asked.
  useEffect(() => {
    if (isOpen) void refreshAgentDetection();
  }, [isOpen]);

  const selectAgent = (agent: AgentSelection) => {
    setActiveAgent(agent);
    setActiveTab("chat");
    if (agent !== "logia") {
      setPanelWidth((width) => Math.max(width, Math.min(TERMINAL_WIDTH, Math.floor(window.innerWidth * 0.55))));
    }
  };

  useEffect(() => {
    if (scrollableContainerRef.current) {
      scrollableContainerRef.current.scrollTop =
        scrollableContainerRef.current.scrollHeight;
    }
  }, [messages, streamingMessage, activeTab]);

  const ensureProviderReady = () => {
    const provider = activeProvider();
    if (isProviderReady(provider.id)) return true;
    toast.error(`${provider.label} isn't set up yet.`);
    setIsSettingsOpen(true, 'ai');
    return false;
  };

  const handleSendMessage = async (message: string) => {
    if (!message.trim() || isLoading || !ensureProviderReady() || !currentNote) return;
    const provider = activeProvider();
    const autoAcceptEdits = useSettingsStore.getState().editApprovalMode === "auto-edits";
    const userMessage: LogiaMessage = { id: crypto.randomUUID(), role: "user", content: message };
    setMessagesMap((prev) => ({
      ...prev,
      [currentNote.id]: [...(prev[currentNote.id] || []), userMessage],
    }));
    setIsLoading(true);
    setStreamingMessage("");

    try {
      const systemPrompt = `You are Logia, a helpful AI assistant in the note-taking app of the same name.

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
      const noteContext = includeNote
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
        id: crypto.randomUUID(),
        role: "assistant" as const,
        content: fullResponse,
      };
      setMessagesMap((prev) => ({
        ...prev,
        [currentNote.id]: [...(prev[currentNote.id] || []), assistantMessage],
      }));
      setStreamingMessage("");
      // Only completed replies use auto-accept; stopping or returning to Supervised cancels it.
      if (!controller.signal.aborted && autoAcceptEdits && useSettingsStore.getState().editApprovalMode === "auto-edits"
        && parseEditorActions(fullResponse).actions.length) {
        await applyMessageActions(currentNote.id, assistantMessage);
      }
    } catch (error: unknown) {
      const aborted = abortRef.current?.signal.aborted;
      if (!aborted) console.error("AI error:", error);
      const errorMessage = aborted ? "_Stopped._" : friendlyAiError(error, provider);

      setMessagesMap((prev) => ({
        ...prev,
        [currentNote.id]: [
          ...(prev[currentNote.id] || []),
          { id: crypto.randomUUID(), role: "assistant", content: errorMessage },
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
    selectAgent("logia");
    void handleSendMessage(pendingAiPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAiPrompt, isOpen, currentNote?.id, isLoading]);

  const threadTitle =
    AGENT_TOOLS.find((tool) => tool.id === activeAgent)?.label ??
    messages.find((m) => m.role === "user")?.content.split("\n")[0] ??
    "New Logia thread";

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
          key="ai-panel"
          data-ai-peek={peek || undefined}
          initial={peek && !reduceMotion ? { x: 24, opacity: 0 } : false}
          animate={{ x: 0, opacity: 1 }}
          exit={peek && !reduceMotion ? { x: 24, opacity: 0 } : undefined}
          transition={{ duration: 0.1, ease: "easeOut" }}
          onMouseEnter={peek ? onPeekEnter : undefined}
          onMouseLeave={peek ? onPeekLeave : undefined}
          style={{ height: peek ? undefined : "100%", minWidth: 0, maxWidth: isCompact ? "100%" : undefined }}
          className={
            peek
              ? "absolute bottom-1.5 right-1.5 top-1.5 z-[900] overflow-clip rounded-lg border border-zinc-800 shadow-2xl shadow-black/70"
              : isCompact
                ? "absolute inset-y-0 right-0 z-[800] w-[min(100%,28rem)]"
                : "flex-shrink-0"
          }
        >
          <Resizable
            size={{ width: isCompact ? "100%" : panelWidth, height: "100%" }}
            onResizeStop={(_event, _direction, element) => setPanelWidth(element.offsetWidth)}
            enable={{ left: !isCompact }}
            minWidth={isCompact ? undefined : 300}
            maxWidth={isCompact ? undefined : 900}
            handleStyles={{ left: { width: 7, left: -4 } }}
            handleClasses={{ left: "z-10 resize-handle" }}
          >
            <div data-workspace-pane="ai" className="flex h-full flex-col border-l border-zinc-800 bg-zinc-950">
              <div className="flex h-9 flex-shrink-0 items-center gap-0.5 pl-1.5 pr-1">
                <AgentChooser selected={activeAgent} title={threadTitle} onSelect={selectAgent} />
                {activeAgent === "logia" && (
                  <IconButton
                    label="New thread"
                    hint="New thread (clears this note's chat)"
                    disabled={isLoading || messages.length === 0}
                    onClick={clearChat}
                  >
                    <Plus size={15} />
                  </IconButton>
                )}
                <IconButton label="AI Chat" hint="Chat" active={activeTab === "chat"} aria-pressed={activeTab === "chat"} onClick={() => setActiveTab("chat")}>
                  <Sparkles size={14} />
                </IconButton>
                <IconButton label="Calendar" active={activeTab === "calendar"} aria-pressed={activeTab === "calendar"} onClick={() => setActiveTab("calendar")}>
                  <CalendarIcon size={14} />
                </IconButton>
                <IconButton label="Note info" active={activeTab === "info"} aria-pressed={activeTab === "info"} onClick={() => setActiveTab("info")}>
                  <Info size={14} />
                </IconButton>
                <IconButton label="Close AI sidebar" hint="Close" onClick={onClose}>
                  <X size={15} />
                </IconButton>
              </div>

              {/* Content Area */}
              <div className="relative flex flex-1 flex-col overflow-hidden">
                {/* --- CHAT VIEW --- */}
                {activeTab === "chat" && activeAgent !== "logia" && (
                  <AgentChatPane key={activeAgent} tool={activeAgent} />
                )}
                {activeTab === "chat" && activeAgent === "logia" && (
                  <>
                    <div
                      ref={scrollableContainerRef}
                      className="flex-1 space-y-5 overflow-y-auto px-4 py-3"
                    >
                      {!currentNote ? (
                        <div className="flex h-full flex-col justify-center px-2 text-center">
                          <h3 className="text-[13px] font-medium text-zinc-200">Open a note to chat</h3>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">Logia's chat is tied to the active note.</p>
                        </div>
                      ) : messages.length === 0 ? (
                        <div className="flex h-full flex-col justify-end pb-2">
                          <h3 className="px-1 text-[13px] font-medium text-zinc-200">Ask about this note</h3>
                          <div className="mt-2 flex flex-col">
                            {[
                              { icon: <AlignLeft size={14} />, label: "Summarize this note", prompt: "Summarize this note" },
                              { icon: <Sparkles size={14} />, label: "Brainstorm ideas", prompt: "Brainstorm ideas related to this note" },
                            ].map((item) => (
                              <button
                                key={item.label}
                                type="button"
                                disabled={isLoading}
                                onClick={() => handleSendMessage(item.prompt)}
                                className="flex h-8 w-full items-center gap-2 rounded-md px-1 text-left text-[13px] text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-100 disabled:opacity-50"
                              >
                                <span aria-hidden="true">{item.icon}</span>
                                {item.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        messages.map((msg) => {
                          const { actions: actionDataList, text: textContent } = msg.role === "assistant"
                            ? parseEditorActions(msg.content) : { actions: [], text: msg.content };

                          return (
                            <div key={msg.id} className={msg.role === "user" ? "ml-8 rounded-lg bg-white/[0.06] px-3 py-2" : ""}>
                              {textContent && (
                                <div className={`chat-prose ${actionDataList.length > 0 ? "mb-3" : ""}`}>
                                  <Markdown remarkPlugins={[remarkGfm]}>
                                    {textContent}
                                  </Markdown>
                                </div>
                              )}
                              {actionDataList.length > 0 && (
                                <SuggestionCard
                                  actionDataList={actionDataList}
                                  status={msg.actionStatus || "pending"}
                                  appliedCount={msg.appliedCount ?? 0}
                                  isProcessing={!!msg.applying}
                                  error={msg.actionError}
                                  onApprove={() => void applyMessageActions(currentNote.id, msg)}
                                  onRefuse={() => patchMessage(currentNote.id, msg.id, { actionStatus: "refused" })}
                                />
                              )}
                            </div>
                          );
                        })
                      )}

                      {isLoading && (
                        <div className="chat-prose">
                          {streamingMessage ? (
                            // Check if streaming content looks like an action JSON
                            streamingMessage.includes('"type": "editor_action"') ||
                              streamingMessage.includes('"type":"editor_action"') ? (
                              <span className="text-zinc-500 motion-safe:animate-pulse">Preparing edits…</span>
                            ) : (
                              <Markdown remarkPlugins={[remarkGfm]}>
                                {streamingMessage}
                              </Markdown>
                            )
                          ) : (
                            <span className="text-zinc-500 motion-safe:animate-pulse">Thinking…</span>
                          )}
                        </div>
                      )}
                    </div>
                    {currentNote && (
                      <AgentComposer
                        draftKey="logia"
                        label="Message Logia"
                        placeholder="Message Logia…"
                        busy={isLoading}
                        onStop={stopGeneration}
                        onSend={(text) => {
                          if (!ensureProviderReady()) return false;
                          void handleSendMessage(text);
                          return true;
                        }}
                        leading={
                          <>
                            <button
                              type="button"
                              onClick={() => setIncludeNote((on) => !on)}
                              aria-pressed={includeNote}
                              title={includeNote ? "This note is sent as context. Click to leave it out." : "This note isn't sent. Click to include it."}
                              className={`flex h-7 max-w-[7rem] items-center gap-1 rounded-md px-1.5 text-xs hover:bg-white/[0.07] ${includeNote ? "text-zinc-300" : "text-zinc-500 line-through"}`}
                            >
                              <FileText size={12} className="flex-shrink-0" />
                              <span className="truncate">{currentNote.title || "Untitled"}</span>
                            </button>
                            <ModelPicker providerId={providerId} scope="chat" disabled={isLoading} />
                            <EditApprovalPicker />
                          </>
                        }
                      />
                    )}
                  </>
                )}

                {/* --- CALENDAR VIEW --- */}
                {activeTab === "calendar" && (
                  <div className="flex h-full flex-col px-3 pb-3 pt-1">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="text-[13px] font-medium text-zinc-100">
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
                          className="rounded px-1.5 text-xs text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
                        >
                          Today
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
                          className="text-xs font-medium text-zinc-500 py-1"
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
                            className={`relative flex aspect-square items-center justify-center rounded-md text-xs
                              ${isToday ? "bg-zinc-100 font-medium text-zinc-950" : isSelected ? "bg-white/[0.1] text-zinc-100" : "text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-100"}
                            `}
                            aria-label={`${date.toDateString()}${count ? `, ${count} notes updated` : ""}`}
                            aria-pressed={isSelected}
                          >
                            {date.getDate()}
                            {count > 0 && (
                              <span className={`absolute bottom-1 size-1 rounded-full ${isToday ? "bg-zinc-950" : "bg-zinc-400"}`} />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-5 border-t border-zinc-800 pt-3 min-h-0 flex-1 overflow-y-auto">
                      <p className="text-xs font-medium text-zinc-500 mb-2 px-1">
                        {selectedDay.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
                      </p>
                      {selectedDayNotes.length === 0 ? (
                        <p className="text-xs text-zinc-500 px-1">No notes updated this day.</p>
                      ) : (
                        <ul className="space-y-0.5">
                          {selectedDayNotes.map((note) => (
                            <li key={note.id}>
                              <button
                                type="button"
                                onClick={() => selectNote(note)}
                                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-[5px] text-left text-[13px] ${currentNote?.id === note.id ? "bg-white/[0.13] text-zinc-100" : "text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-200"}`}
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
                  <div className="flex h-full flex-col overflow-y-auto px-3 pb-3 pt-1">
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
