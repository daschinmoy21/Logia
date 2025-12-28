import useUiStore from "../store/UiStore";

interface FooterProps {
  wordCount: number;
  isSaved: boolean;
}

export default function Footer({ wordCount }: FooterProps) {
  const { isAiSidebarOpen, setIsAiSidebarOpen } = useUiStore();

  return (
    <footer className="h-8 border-t border-zinc-800 px-6 flex items-center justify-between text-xs text-zinc-400 flex-shrink-0">
      <div className="flex items-center space-x-4">
        <span>Words: {wordCount}</span>
        {/* <span>{isSaved ? 'Saved' : 'Unsaved'}</span> */}
      </div>
    </footer>
  );
}
