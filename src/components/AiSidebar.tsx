import { PromptInputBox } from "@/components/ui/ai-prompt-box";
import { useNotesStore } from "@/store/notesStore";
import useUiStore from "../store/UiStore";
import { Resizable } from "re-resizable";
import { streamText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { useState, useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  User,
  X,
  Sparkles,
  Calendar as CalendarIcon,
  Hash,
  List,
  AlignLeft,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import toast, { Toaster } from "react-hot-toast";
import { AnimatePresence, motion } from "framer-motion";

interface AiSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = "chat" | "calendar" | "tags";

const AiSidebar = ({ isOpen, onClose }: AiSidebarProps) => {
  const { currentNote } = useNotesStore();
  const { googleApiKey } = useUiStore();
  const [activeTab, setActiveTab] = useState<Tab>("chat");

  // Chat State
  const [messagesMap, setMessagesMap] = useState<
    Record<string, { role: "user" | "assistant"; content: string }[]>
  >({});
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<string>("");
  const scrollableContainerRef = useRef<HTMLDivElement>(null);
  const [googleClient, setGoogleClient] = useState<any>(null);

  // Calendar State
  const [currentDate, setCurrentDate] = useState(new Date());

  const messages = currentNote ? messagesMap[currentNote.id] || [] : [];

  useEffect(() => {
    if (scrollableContainerRef.current) {
      scrollableContainerRef.current.scrollTop =
        scrollableContainerRef.current.scrollHeight;
    }
  }, [messages, streamingMessage, activeTab]);

  useEffect(() => {
    if (!googleApiKey) {
      setGoogleClient(null);
      return;
    }
    try {
      const client = createGoogleGenerativeAI({ apiKey: googleApiKey });
      setGoogleClient(() => client);
    } catch (e) {
      console.error("Failed to create Google AI client", e);
      setGoogleClient(null);
    }
  }, [googleApiKey]);

  const handleSendMessage = async (message: string) => {
    if (!message.trim()) return;
    if (!googleApiKey || !googleClient) {
      toast.error("Google API key not configured.", {
        style: { background: "#333", color: "#fff" },
      });
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
      const systemPrompt =
        "You are KAi, a helpful AI assistant in a note-taking app called Kortex.";
      const noteContext = currentNote
        ? `\n\nContext:\n---\n${currentNote.content}\n---`
        : "";

      const result = await streamText({
        model: googleClient("gemini-2.5-flash"),
        system: systemPrompt + noteContext,
        messages: [...messages, userMessage],
      });

      let fullResponse = "";
      for await (const delta of result.textStream) {
        fullResponse += delta;
        setStreamingMessage(fullResponse);
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
    } catch (error) {
      console.error("AI error:", error);
      setMessagesMap((prev) => ({
        ...prev,
        [currentNote.id]: [
          ...(prev[currentNote.id] || []),
          { role: "assistant", content: "Error occurred." },
        ],
      }));
    } finally {
      setIsLoading(false);
    }
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
          exit={{ width: 0, opacity: 1 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
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
                    onClick={() => setActiveTab("chat")}
                    className={`p-1.5 rounded-md transition-all ${activeTab === "chat" ? "bg-zinc-800 text-zinc-100 shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}
                    title="AI Chat"
                  >
                    <Sparkles size={16} />
                  </button>
                  <button
                    onClick={() => setActiveTab("calendar")}
                    className={`p-1.5 rounded-md transition-all ${activeTab === "calendar" ? "bg-zinc-800 text-zinc-100 shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}
                    title="Calendar"
                  >
                    <CalendarIcon size={16} />
                  </button>
                  <button
                    onClick={() => setActiveTab("tags")}
                    className={`p-1.5 rounded-md transition-all ${activeTab === "tags" ? "bg-zinc-800 text-zinc-100 shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}
                    title="Tags & Properties"
                  >
                    <Hash size={16} />
                  </button>
                </div>
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
                      {messages.length === 0 ? (
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
                            <button className="flex items-center gap-3 w-full p-3 rounded-lg bg-zinc-900/40 hover:bg-zinc-900 border border-zinc-800/50 hover:border-zinc-700 transition-all group text-left">
                              <span className="text-zinc-500 group-hover:text-blue-400 transition-colors">
                                <AlignLeft size={16} />
                              </span>
                              <span className="text-zinc-400 text-sm group-hover:text-zinc-200">
                                Summarize this note
                              </span>
                            </button>
                            <button className="flex items-center gap-3 w-full p-3 rounded-lg bg-zinc-900/40 hover:bg-zinc-900 border border-zinc-800/50 hover:border-zinc-700 transition-all group text-left">
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
                        messages.map((msg, index) => (
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
                              <Markdown remarkPlugins={[remarkGfm]}>
                                {msg.content}
                              </Markdown>
                            </div>
                          </div>
                        ))
                      )}

                      {isLoading && streamingMessage && (
                        <div className="flex gap-3">
                          <div className="mt-1">
                            <Sparkles size={16} className="text-blue-400" />
                          </div>
                          <div className="flex-1 text-sm text-zinc-300">
                            <Markdown remarkPlugins={[remarkGfm]}>
                              {streamingMessage}
                            </Markdown>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="p-4 bg-zinc-950 border-t border-zinc-900/50">
                      <PromptInputBox
                        onSend={handleSendMessage}
                        isLoading={isLoading}
                      />
                    </div>
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
                    <div className="grid grid-cols-7 gap-1 flex-1 content-start">
                      {calendarDays.map((date, i) => (
                        <div
                          key={i}
                          className={`aspect-square flex items-center justify-center text-sm rounded-md transition-colors
                                    ${!date ? "invisible" : ""}
                                    ${date && date.toDateString() === new Date().toDateString() ? "bg-blue-600 text-white font-medium shadow-lg shadow-blue-500/20" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"}
                                `}
                        >
                          {date?.getDate()}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* --- TAGS / PROPERTIES VIEW --- */}
                {activeTab === "tags" && (
                  <div className="flex flex-col h-full bg-zinc-950 overflow-y-auto">
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-zinc-400 font-medium text-sm">
                          Properties
                        </h3>
                      </div>

                      <div className="space-y-1">
                        {[
                          {
                            icon: <Hash size={14} />,
                            label: "Tags",
                            value: "Always show",
                            action: true,
                          },
                          {
                            icon: <AlignLeft size={14} />,
                            label: "Doc mode",
                            value: "Always hide",
                            action: true,
                          },
                          {
                            icon: <CalendarIcon size={14} />,
                            label: "Journal",
                            value: "Always hide",
                            action: true,
                          },
                          {
                            icon: <List size={14} />,
                            label: "Template",
                            value: "Always hide",
                            action: true,
                          },
                          {
                            icon: <CalendarIcon size={14} />,
                            label: "Created",
                            value: "Always show",
                            action: true,
                          },
                          {
                            icon: <CalendarIcon size={14} />,
                            label: "Updated",
                            value: "Always show",
                            action: true,
                          },
                          {
                            icon: <User size={14} />,
                            label: "Created by",
                            value: "Always hide",
                            action: true,
                          },
                        ].map((item, i) => (
                          <div
                            key={i}
                            className="group flex items-center justify-between py-1.5 px-2 hover:bg-zinc-900/60 rounded-md cursor-pointer transition-colors"
                          >
                            <div className="flex items-center gap-3 text-zinc-400 group-hover:text-zinc-300">
                              <span className="opacity-70">{item.icon}</span>
                              <span className="text-sm">{item.label}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-zinc-600 group-hover:text-zinc-500">
                                {item.value}
                              </span>
                              {item.action && (
                                <MoreHorizontal
                                  size={14}
                                  className="text-zinc-700 group-hover:text-zinc-500"
                                />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-8">
                        <button className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 text-sm font-medium transition-colors px-2">
                          <span>Add more properties</span>
                          <ChevronRight size={14} />
                        </button>

                        <div className="mt-4 pl-2 border-l-2 border-zinc-900 ml-3 space-y-3">
                          {["Text", "Number", "Checkbox", "Date", "Person"].map(
                            (type, i) => (
                              <div
                                key={i}
                                className="flex items-center justify-between group cursor-pointer"
                              >
                                <div className="flex items-center gap-3 text-zinc-500 group-hover:text-zinc-300">
                                  {/* Mock icons */}
                                  <span className="text-xs opacity-50">T</span>
                                  <span className="text-sm">{type}</span>
                                </div>
                                <Plus
                                  size={14}
                                  className="text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity"
                                />
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <Toaster />
          </Resizable>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AiSidebar;
