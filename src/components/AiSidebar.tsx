import { useNotesStore } from "@/store/notesStore";
import type { Note } from "@/types/Note";
import { countWordsInNoteContent } from "@/lib/note-utils";
import useUiStore from "../store/UiStore";
import { Resizable } from "re-resizable";
import { useState, useEffect } from "react";
import { useSettingsStore } from "../store/settingsStore";
import { AgentChooser } from "./agent/AgentChooser";
import { AgentChatPane } from "./agent/AgentChatPane";
import { closeAllAgentChats } from "./agent/agentChats";
import { closeAllAgentSessions, refreshAgentDetection } from "./agent/agentSessions";
import { AGENT_TOOLS, type AgentTool } from "../lib/ai/agent-terminal";
import {
  Sparkles,
  GitBranch,
  Calendar as CalendarIcon,
  Info,
  AlignLeft,
  ChevronLeft,
  ChevronRight,
  FileText,
  Star,
  Clock,
  Folder as FolderIcon,
  Type,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { prefersReducedMotion } from "../lib/utils";
import { IconButton } from "./ui/kit";
import { useWorkspaceStore } from "./workspace/workspaceStore";
import { GitPanel } from "./workspace/GitPanel";
import { isTauri } from "@tauri-apps/api/core";

interface AiSidebarProps {
  isOpen: boolean;
  /** Open only while hovered, floating over the note instead of docked beside it. */
  peek?: boolean;
  onPeekEnter?: () => void;
  onPeekLeave?: () => void;
  onClose: () => void;
}


/** Matches the app's narrow layout: too little room to dock beside the note. */
const COMPACT_QUERY = "(max-width: 767px)";

const noNotes: Note[] = [];

const AiSidebar = ({ isOpen, peek = false, onPeekEnter, onPeekLeave, onClose }: AiSidebarProps) => {
  const reduceMotion = prefersReducedMotion();
  const activeTab = useWorkspaceStore((s) => s.aiTab);
  const setActiveTab = useWorkspaceStore((s) => s.setAiTab);
  const chosenAgent = useSettingsStore((s) => s.activeAgent);
  const firstDetected = useSettingsStore((s) => AGENT_TOOLS.find((tool) => s.cliStatus[tool.id]?.available)?.id);
  const activeAgent: AgentTool = chosenAgent ?? firstDetected ?? "codex";
  const panelWidth = useWorkspaceStore((s) => s.aiPanelWidth);
  // A closed panel stays mounted to keep its sessions, but shouldn't react to every keystroke.
  const currentNote = useNotesStore((s) => (isOpen ? s.currentNote : null));
  const notes = useNotesStore((s) => (isOpen && activeTab === "calendar" ? s.notes : noNotes));
  const folders = useNotesStore((s) => s.folders);
  const selectNote = useNotesStore((s) => s.selectNote);
  const pendingAiPrompt = useUiStore((s) => s.pendingAiPrompt);
  const [isCompact, setIsCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches);

  // Calendar State
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());

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

  // Prompts sent from elsewhere (the vim `:ai <prompt>` command) are sent by the chat view.
  useEffect(() => {
    if (pendingAiPrompt) setActiveTab("chat");
  }, [pendingAiPrompt]);

  const selectAgent = (agent: AgentTool) => {
    useSettingsStore.getState().setActiveAgent(agent);
    setActiveTab("chat");
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-workspace-pane="ai"] [data-agent-composer]')?.focus();
    });
  };

  const agentLabel = AGENT_TOOLS.find((tool) => tool.id === activeAgent)?.label ?? activeAgent;

  const folderName = currentNote?.folder_id
    ? folders.find((f) => f.id === currentNote.folder_id)?.name
    : undefined;
  const wordCount = currentNote ? countWordsInNoteContent(currentNote.content) : 0;

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
            onResizeStop={(_event, _direction, element) => useWorkspaceStore.getState().setAiPanelWidth(element.offsetWidth)}
            enable={{ left: !isCompact }}
            minWidth={isCompact ? undefined : 300}
            maxWidth={isCompact ? undefined : 900}
            handleStyles={{ left: { width: 7, left: -4 } }}
            handleClasses={{ left: "z-10 resize-handle" }}
          >
            <div data-workspace-pane="ai" className="flex h-full flex-col border-l border-zinc-800 bg-zinc-950">
              <div className="flex h-9 flex-shrink-0 items-center gap-0.5 pl-1.5 pr-1">
                <AgentChooser selected={activeAgent} title={agentLabel} onSelect={selectAgent} />
                <IconButton label="AI Chat" hint="Chat" active={activeTab === "chat"} aria-pressed={activeTab === "chat"} onClick={() => setActiveTab("chat")}>
                  <Sparkles size={14} />
                </IconButton>
                <IconButton label="Calendar" active={activeTab === "calendar"} aria-pressed={activeTab === "calendar"} onClick={() => setActiveTab("calendar")}>
                  <CalendarIcon size={14} />
                </IconButton>
                <IconButton label="Note info" active={activeTab === "info"} aria-pressed={activeTab === "info"} onClick={() => setActiveTab("info")}>
                  <Info size={14} />
                </IconButton>
                {isTauri() && (
                  <IconButton label="Source control" active={activeTab === "git"} aria-pressed={activeTab === "git"} onClick={() => setActiveTab("git")}>
                    <GitBranch size={14} />
                  </IconButton>
                )}
                <IconButton label="Close AI sidebar" hint="Close" onClick={onClose}>
                  <X size={15} />
                </IconButton>
              </div>

              {/* Content Area */}
              <div className="relative flex flex-1 flex-col overflow-hidden">
                {/* --- CHAT VIEW --- */}
                {activeTab === "chat" && (
                  <AgentChatPane key={activeAgent} tool={activeAgent} onSwitchAgent={selectAgent} />
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

                {activeTab === "git" && (
                  <div className="flex min-h-0 flex-1 flex-col pt-1">
                    <GitPanel />
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
