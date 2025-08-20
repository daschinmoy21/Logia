export function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center bg-zinc-950 h-full">
      <div className="text-center">
        <div className="text-zinc-400 text-xl font-medium mb-2">
          Welcome to Kortex
        </div>
        <div className="text-zinc-500 text-sm">
          Select a note from the sidebar or create a new one to start writing
        </div>
      </div>
    </div>
  );
}
