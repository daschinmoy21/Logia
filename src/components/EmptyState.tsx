import { StarsBackground } from './animate-ui/backgrounds/stars';
import { ShimmeringText } from './animate-ui/text/shimmering';
import { WritingText } from './animate-ui/text/writing';

export function EmptyState() {

  return (
    <div className="relative flex-1 flex items-center justify-center bg-zinc-950 h-full">
      <div className="absolute inset-0 z-0">
        <StarsBackground />
      </div>
      <div className="text-center z-10">
        <div className="text-zinc-100 text-xl font-medium mb-2">
          <ShimmeringText
            className="text-4xl font-semibold"
            text="Welcome to Logia"
            wave />
        </div>
        <div className="text-zinc-300 text-sm">
          <WritingText
            className="text-2xl"
            text="Select a note or create a new one to get started"
            spacing={9}
            transition={{
              duration: 2,
              delay: 0.1,
            }}
          />

        </div>
      </div>
    </div>
  );
}
