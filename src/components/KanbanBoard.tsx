import { useState, useEffect } from "react";
import {
  Dialog,
  DialogPanel,
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Transition,
} from "@headlessui/react";
import { invoke } from "@tauri-apps/api/core";
import {
  Plus,
  ListTodo,
  Clock,
  CheckCircle,
  X,
  MoreHorizontal,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type KanbanTask = {
  id: string;
  name: string;
  column: string;
  created_at: string;
  updated_at: string;
};

interface KanbanBoardContainerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function KanbanBoardContainer({
  isOpen,
  onClose,
}: KanbanBoardContainerProps) {
  const [kanbanData, setKanbanData] = useState<KanbanTask[]>([]);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskName, setEditingTaskName] = useState("");
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [fadingTaskId, setFadingTaskId] = useState<string | null>(null);

  const kanbanColumns = [
    { id: "todo", name: "Todo" },
    { id: "in-progress", name: "Doing" },
    { id: "done", name: "Done" },
  ];

  const loadKanbanTasks = async () => {
    try {
      const tasks = await invoke<KanbanTask[]>("get_kanban_data");
      setKanbanData(tasks);
    } catch (error) {
      console.error("Failed to load kanban tasks:", error);
    }
  };

  const saveKanbanData = async (data: KanbanTask[]) => {
    try {
      await invoke("save_kanban_data", { tasks: data });
    } catch (error) {
      console.error("Failed to save kanban data:", error);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadKanbanTasks();
    }
  }, [isOpen]);

  const addTask = (columnId: string) => {
    const newId = Date.now().toString();
    const newTask: KanbanTask = {
      id: newId,
      name: "New Task",
      column: columnId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const newData = [...kanbanData, newTask];
    setKanbanData(newData);
    saveKanbanData(newData);
  };

  const deleteTask = (taskId: string) => {
    const newData = kanbanData.filter((task) => task.id !== taskId);
    setKanbanData(newData);
    saveKanbanData(newData);
  };

  const startEditingTask = (taskId: string, currentName: string) => {
    setEditingTaskId(taskId);
    setEditingTaskName(currentName);
  };

  const saveTaskName = () => {
    if (editingTaskId && editingTaskName.trim()) {
      const newData = kanbanData.map((task) =>
        task.id === editingTaskId
          ? {
            ...task,
            name: editingTaskName.trim(),
            updated_at: new Date().toISOString(),
          }
          : task,
      );
      setKanbanData(newData);
      saveKanbanData(newData);
    }
    setEditingTaskId(null);
    setEditingTaskName("");
  };

  const cancelEditing = () => {
    setEditingTaskId(null);
    setEditingTaskName("");
  };

  const getColumnTaskCount = (columnId: string) => {
    return kanbanData.filter((task) => task.column === columnId).length;
  };

  const moveTask = async (taskId: string, targetColumn: string) => {
    if (targetColumn === "done") {
      // 1. Strikethrough visible
      setCompletingTaskId(taskId);
      await new Promise((resolve) => setTimeout(resolve, 120));

      // 2. Fade out (disappear visually)
      setFadingTaskId(taskId);
      await new Promise((resolve) => setTimeout(resolve, 120));

      // 3. Move to new column (this triggers the "new" render in Done column)
      const newData = kanbanData.map((task) =>
        task.id === taskId ? { ...task, column: targetColumn } : task,
      );
      setKanbanData(newData);
      saveKanbanData(newData);

      // Cleanup states
      setCompletingTaskId(null);
      setFadingTaskId(null);
    } else {
      // Immediate move for other columns
      const newData = kanbanData.map((task) =>
        task.id === taskId ? { ...task, column: targetColumn } : task,
      );
      setKanbanData(newData);
      saveKanbanData(newData);
    }
  };

  const getCardBackground = (columnId: string) => {
    switch (columnId) {
      default:
        return "bg-zinc-950 border-zinc-800";
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-[99999]">
      <div className="fixed inset-0 bg-black/50" />
      <div
        className="fixed inset-0 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <DialogPanel
          className="flex h-[85dvh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header Section with Tabs */}
          <div className="flex h-11 flex-shrink-0 items-center justify-between border-b border-zinc-800 pl-4 pr-2">
            <h2 className="text-[13px] font-medium text-zinc-100">Tasks</h2>

            {/* Close Button */}
            <button
              onClick={onClose}
              aria-label="Close tasks"
              className="flex size-7 items-center justify-center rounded-md text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-100"
            >
              <X size={15} />
            </button>
          </div>

          {/* Kanban Content */}
          <div className="flex-1 overflow-x-auto p-3">
              <div className="flex h-full gap-2">
                {kanbanColumns.map((column) => (
                  <div
                    key={column.id}
                    className="flex h-full min-w-[260px] flex-1 flex-col rounded-lg bg-zinc-925"
                  >
                    {/* Column Header */}
                    <div className="flex items-center justify-between px-2.5 py-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="flex items-center text-xs font-medium text-zinc-300"
                        >
                          {column.id === "todo" && (
                            <ListTodo size={12} className="mr-1.5" />
                          )}
                          {column.id === "in-progress" && (
                            <Clock size={12} className="mr-1.5" />
                          )}
                          {column.id === "done" && (
                            <CheckCircle size={12} className="mr-1.5" />
                          )}
                          {column.name}
                        </div>
                        <span className="text-xs tabular-nums text-zinc-500">
                          {getColumnTaskCount(column.id)}
                        </span>

                        <button
                          onClick={() => addTask(column.id)}
                          className="p-1 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700/50 rounded transition-colors"
                          title="Add Task"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Column Content */}
                    <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
                      <AnimatePresence mode="popLayout">
                        {kanbanData
                          .filter((task) => task.column === column.id)
                          .map((task) => (
                            <motion.div
                              key={task.id}
                              layoutId={
                                task.column === "done" ? undefined : task.id
                              }
                              initial={{
                                opacity: 0,
                                x: column.id === "done" ? -10 : -20,
                              }}
                              animate={{
                                opacity: fadingTaskId === task.id ? 0 : 1,
                                x: 0,
                                transition: {
                                  duration: column.id === "done" ? 0.4 : 0.2,
                                }, // Slower fade in for done
                              }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              transition={{ duration: 0.2 }}
                            >
                              <div
                                className={`group relative rounded-lg p-3 shadow-sm hover:border-zinc-600/50 transition-colors border ${getCardBackground(task.column)}`}
                              >
                                {editingTaskId === task.id ? (
                                  <input
                                    type="text"
                                    value={editingTaskName}
                                    onChange={(e) =>
                                      setEditingTaskName(e.target.value)
                                    }
                                    onBlur={saveTaskName}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") saveTaskName();
                                      if (e.key === "Escape") cancelEditing();
                                    }}
                                    className="bg-zinc-900 border border-zinc-700/80 rounded px-2 py-1 text-zinc-300 w-full outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all text-sm placeholder-zinc-600"
                                    autoFocus
                                  />
                                ) : (
                                  <div className="flex gap-3">
                                    {/* Action Menu (Left) */}
                                    <div className="pt-0.5">
                                      <Menu as="div" className="relative">
                                        <MenuButton className="flex items-center justify-center p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
                                          <MoreHorizontal size={14} />
                                        </MenuButton>
                                        <Transition
                                          enter="transition duration-100 ease-out"
                                          enterFrom="transform scale-95 opacity-0"
                                          enterTo="transform scale-100 opacity-100"
                                          leave="transition duration-75 ease-out"
                                          leaveFrom="transform scale-100 opacity-100"
                                          leaveTo="transform scale-95 opacity-0"
                                        >
                                          <MenuItems className="absolute left-0 mt-1 w-32 origin-top-left rounded-md bg-zinc-900 border border-zinc-800 shadow-xl focus:outline-none z-50">
                                            <div className="p-1">
                                              {column.id !== "todo" && (
                                                <MenuItem>
                                                  {({ active }) => (
                                                    <button
                                                      onClick={() =>
                                                        moveTask(
                                                          task.id,
                                                          "todo",
                                                        )
                                                      }
                                                      className={`${active ? "bg-zinc-800 text-zinc-200" : "text-zinc-400"} group flex w-full items-center rounded-sm px-2 py-1.5 text-xs`}
                                                    >
                                                      <ListTodo
                                                        size={12}
                                                        className="mr-2"
                                                      />
                                                      To Todo
                                                    </button>
                                                  )}
                                                </MenuItem>
                                              )}
                                              {column.id !== "in-progress" && (
                                                <MenuItem>
                                                  {({ active }) => (
                                                    <button
                                                      onClick={() =>
                                                        moveTask(
                                                          task.id,
                                                          "in-progress",
                                                        )
                                                      }
                                                      className={`${active ? "bg-zinc-800 text-blue-400" : "text-blue-400/80"} group flex w-full items-center rounded-sm px-2 py-1.5 text-xs`}
                                                    >
                                                      <Clock
                                                        size={12}
                                                        className="mr-2"
                                                      />
                                                      Doing
                                                    </button>
                                                  )}
                                                </MenuItem>
                                              )}
                                              {column.id !== "done" && (
                                                <MenuItem>
                                                  {({ active }) => (
                                                    <button
                                                      onClick={() =>
                                                        moveTask(
                                                          task.id,
                                                          "done",
                                                        )
                                                      }
                                                      className={`${active ? "bg-zinc-800 text-green-400" : "text-green-400/80"} group flex w-full items-center rounded-sm px-2 py-1.5 text-xs`}
                                                    >
                                                      <CheckCircle
                                                        size={12}
                                                        className="mr-2"
                                                      />
                                                      Done
                                                    </button>
                                                  )}
                                                </MenuItem>
                                              )}
                                              <div className="my-1 h-px bg-zinc-800" />
                                              <MenuItem>
                                                {({ active }) => (
                                                  <button
                                                    onClick={() =>
                                                      deleteTask(task.id)
                                                    }
                                                    className={`${active ? "bg-red-900/20 text-red-400" : "text-red-400/80"} group flex w-full items-center rounded-sm px-2 py-1.5 text-xs`}
                                                  >
                                                    Delete
                                                  </button>
                                                )}
                                              </MenuItem>
                                            </div>
                                          </MenuItems>
                                        </Transition>
                                      </Menu>
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                      <p
                                        className={`m-0 cursor-default text-[13px] text-zinc-200 line-clamp-2 transition-all duration-300 ${completingTaskId === task.id || task.column === "done" ? "line-through text-zinc-500 opacity-60" : ""}`}
                                        onDoubleClick={() =>
                                          startEditingTask(task.id, task.name)
                                        }
                                      >
                                        {task.name}
                                      </p>

                                                                          </div>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          ))}
                      </AnimatePresence>
                    </div>
                  </div>
                ))}
              </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
