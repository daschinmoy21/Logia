import { useEffect, useRef } from "react";

interface SineWaveCanvasProps {
  isRunning: boolean;
}

export const SineWaveCanvas = ({ isRunning }: SineWaveCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();
  const phaseRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    const amplitudeMap = new Map<number, number>();
    const frequency = 0.1; // Adjusted for vertical line animation
    const lineSpacing = 12; // Space between vertical lines

    const getAmplitudeForWave = (waveIndex: number) => {
      if (!amplitudeMap.has(waveIndex)) {
        // Amplitude range: 8% to 20% of canvas height
        const newAmplitude = height * 0.08 + Math.random() * height * 0.12;
        amplitudeMap.set(waveIndex, newAmplitude);
      }
      return amplitudeMap.get(waveIndex)!;
    };

    const resizeObserver = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        const { width: newWidth, height: newHeight } = entry.contentRect;
        width = newWidth;
        height = newHeight;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);
        amplitudeMap.clear();
      }
    });

    resizeObserver.observe(canvas);

    const animate = () => {
      // Semi-transparent black background (60% opacity)
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(0, 0, width, height);

      // Brighter grid lines for visibility against dark background
      ctx.strokeStyle = "hsl(230, 15%, 25%)";
      ctx.lineWidth = 0.5;
      ctx.globalAlpha = 0.5;

      // Horizontal center line
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      // Vertical grid lines
      for (let x = 0; x < width; x += 100) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      // Reset global alpha
      ctx.globalAlpha = 1.0;

      // Create gradient for vertical lines (centered at middle)
      const centerY = height / 2;
      const maxAmplitude = height * 0.2; // Maximum possible amplitude
      const gradient = ctx.createLinearGradient(
        0, centerY - maxAmplitude,
        0, centerY + maxAmplitude
      );
      gradient.addColorStop(0, "hsl(200, 80%, 75%)");
      gradient.addColorStop(0.5, "hsl(220, 70%, 80%)");
      gradient.addColorStop(1, "hsl(240, 80%, 75%)");

      // Apply glow effect
      ctx.shadowColor = "hsl(220, 80%, 70%)";
      ctx.shadowBlur = 15;
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";

      // Draw vertical lines extending in both directions
      ctx.beginPath();
      for (let x = 0; x < width; x += lineSpacing) {
        const angle = x * frequency + phaseRef.current;
        const waveIndex = Math.floor(angle / (2 * Math.PI));
        const amplitude = getAmplitudeForWave(waveIndex);

        // Calculate symmetric line height using sine wave
        const magnitude = Math.abs(Math.sin(angle)) * amplitude;
        const topY = centerY - magnitude;
        const bottomY = centerY + magnitude;

        // Draw vertical line from top to bottom
        ctx.moveTo(x, topY);
        ctx.lineTo(x, bottomY);
      }
      ctx.stroke();

      // Reset shadow
      ctx.shadowBlur = 0;

      // Update phase for animation
      phaseRef.current += 0.05;
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    if (isRunning) {
      amplitudeMap.clear();
      animate();
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
      // Clear canvas with semi-transparent black when stopped
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(0, 0, width, height);
    }

    return () => {
      resizeObserver.disconnect();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isRunning]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
};
