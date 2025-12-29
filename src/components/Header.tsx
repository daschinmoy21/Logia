import useUiStore from "../store/UiStore";
import { PanelRight, PanelLeft } from "lucide-react";

export default function Header() {
  const { isAiSidebarOpen, setIsAiSidebarOpen, isSidebarFloating, setIsSidebarFloating } = useUiStore();

  return (
    <header className="h-10 bg-zinc-950/90 px-4 border-b border-zinc-300/20 flex items-center justify-between flex-shrink-0">
      {/* Left side content */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setIsSidebarFloating(!isSidebarFloating)}
          className={`p-2 rounded-md transition-all duration-200 ${isSidebarFloating
              ? "text-blue-400 bg-blue-400/10"
              : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
            }`}
          title={isSidebarFloating ? "Pin Sidebar" : "Float Sidebar"}
        >
          <PanelLeft size={18} />
        </button>
      </div>

      <div className="flex items-center">
        <button
          onClick={() => setIsAiSidebarOpen(!isAiSidebarOpen)}
          className={`p-2 rounded-md transition-all duration-200 ${isAiSidebarOpen
              ? "text-blue-400 bg-blue-400/10"
              : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
            }`}
          title="Toggle AI Sidebar"
        >
          <PanelRight size={18} />
        </button>
      </div>
    </header>
  );
}
