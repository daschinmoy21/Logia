import { CircleStop } from "lucide-react";
import { ShimmeringText } from "./animate-ui/text/shimmering";
import { SineWaveCanvas } from "./Wave";
import { useState, useEffect } from "react";
import { formatTime } from "../lib/utils";


import useUiStore from "../store/UiStore";

function RecStatus({
  isRecording,
  isProcessing,
  onStop,
}: {
  isRecording: boolean;
  isProcessing: boolean;
  onStop: () => void;
}) {
  const recordingStartTime = useUiStore((state) => state.recordingStartTime);
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isRecording && recordingStartTime) {
      // Update immediately
      setElapsedTime(Math.floor((Date.now() - recordingStartTime) / 1000));

      timer = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - recordingStartTime) / 1000));
      }, 1000);
    } else {
      setElapsedTime(0);
    }
    return () => clearInterval(timer);
  }, [isRecording, recordingStartTime]);

  if (isProcessing) {
    return (
      <div className="flex items-center justify-center gap-3 h-10 px-2 mb-2 bg-black/60 border-y border-zinc-700/50">
        <ShimmeringText
          text="Transcribing..."
          shimmeringColor="#ffffff"
          className="font-mono text-sm text-zinc-100"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between h-10 px-2 mb-2 bg-black/60 border-y border-zinc-700/50">
      <span className="font-mono text-sm text-zinc-100 w-16 text-center">
        <ShimmeringText
          text={formatTime(elapsedTime)}
          shimmeringColor="#ffffff"
        />
      </span>
      <div className="flex-1 h-full mx-2">
        <SineWaveCanvas isRunning={isRecording} />
      </div>
      <button
        onClick={onStop}
        className="text-sm flex items-center gap-1.5 bg-red-500/40 text-white px-2 py-1 rounded-lg hover:bg-red-600 transition-colors"
      >
        <CircleStop />
      </button>
    </div>
  );
}
export default RecStatus;
