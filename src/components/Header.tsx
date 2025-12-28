import useUiStore from "../store/UiStore";
import { PanelRight } from "lucide-react";

export default function Header() {
  const { isAiSidebarOpen, setIsAiSidebarOpen } = useUiStore();

  return (
    <header className="h-10 bg-zinc-900 px-4 flex items-center justify-between flex-shrink-0">
      {/* Left side content (if any)
       */}
      <div className="flex items-center text-xs text-zinc-500 font-medium">
        {/* Placeholder for Breadcrumbs or Title if needed, keeping word count if that was intended,
         */}
      </div>

      <div className="flex items-center">
        <button
          onClick={() => setIsAiSidebarOpen(!isAiSidebarOpen)}
          className={`p-2 rounded-md transition-all duration-200 ${
            isAiSidebarOpen
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
