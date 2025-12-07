import useUiStore from "../store/UiStore";
import { Sparkles } from 'lucide-react';

interface FooterProps {
  wordCount: number
  isSaved: boolean
}

export default function Footer({ wordCount }: FooterProps) {
  const { isAiSidebarOpen, setIsAiSidebarOpen } = useUiStore();

  return (
    <footer className="h-8 border-t border-zinc-800 px-6 flex items-center justify-between text-xs text-zinc-400 flex-shrink-0">
      <div className="flex items-center space-x-4">
        <span>Words: {wordCount}</span>
        {/* <span>{isSaved ? 'Saved' : 'Unsaved'}</span> */}
      </div>
      <button
        onClick={() => setIsAiSidebarOpen(!isAiSidebarOpen)}
        className="text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <Sparkles size={17} />
      </button>
    </footer>
  )
}
