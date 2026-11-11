import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '../../lib/utils';
import shuttleUrl from '../../assets/shuttle.jpg';

/** One dither cell and the lit dot inside it, in CSS pixels. When the dot fills the cell there is no gap. */
const CELL = 1;
const DOT = 1;

const FPS = 10;
/** Softens the dither grain a touch, in CSS pixels. */
const BLUR = 0.6;
const GAP = '#050405';
/** Colors every dot snaps to: near-blacks so empty space still shows a faint grain, then the photo's hues. */
const COLORS = [
  '#000000', '#0d0f16', '#1a0c08', '#06142a',
  '#0b2f5c', '#1d64b0', '#4fa3e8', '#a9dcff',
  '#f4f1e8', '#ffb35c', '#f0641e', '#b3240e', '#5a1206',
];
/** How far the ordered pattern nudges a color before it snaps to the nearest one. */
const SPREAD = 48;
/** Tone applied to the photo first: darker mids and stronger color, so it reads as a backdrop. */
const GAMMA = 1.3;
const SATURATION = 1.15;
const EXPOSURE = 0.92;

/** Where the shuttle sits in the photo, and where it lands in the pane. */
const FOCUS = { x: 0.515, y: 0.505 };
const TARGET = { x: 0.52, y: 0.34 };
const ZOOM = 1.6;
/** How far the photo drifts under the grid, in CSS pixels, and how long one sway takes. */
const DRIFT = 24;
const PERIOD = 48;

/** 8x8 ordered-dither thresholds in -0.5..0.5, built by interleaving the bits of (x xor y) and y. */
const BAYER = Float32Array.from({ length: 64 }, (_, i) => {
  const x = i & 7;
  const y = i >> 3;
  let v = 0;
  for (let bit = 0; bit < 3; bit++) {
    const shift = 2 * (2 - bit);
    v |= ((((x ^ y) >> bit) & 1) << (shift + 1)) | (((y >> bit) & 1) << shift);
  }
  return (v + 0.5) / 64 - 0.5;
});

const hexRgb = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
const RGB = COLORS.map(hexRgb);
/** Packed for a Uint32 view of ImageData, which is little-endian ABGR. */
const pack = ([r, g, b]: number[]) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
const PACKED = Uint32Array.from(RGB.map(pack));
/** The gap around each dot is a dim shade of the dot's color, so the grain shows without losing the glow. */
const GAP_SHADE = 0.4;
const DIM = Uint32Array.from(RGB.map((color) => pack(color.map((v) => Math.round(v * GAP_SHADE)))));
const GAP_PACKED = pack(hexRgb(GAP));

/** Precomputed tone curve per channel value. */
const CURVE = Float32Array.from({ length: 256 }, (_, v) => 255 * EXPOSURE * (v / 255) ** GAMMA);

function nearest(r: number, g: number, b: number) {
  let best = 0;
  let distance = Infinity;
  for (let i = 0; i < RGB.length; i++) {
    const color = RGB[i];
    // Weighted toward green, roughly how the eye ranks the channels.
    const d = 2 * (r - color[0]) ** 2 + 4 * (g - color[1]) ** 2 + 3 * (b - color[2]) ** 2;
    if (d < distance) [best, distance] = [i, d];
  }
  return best;
}

/** Nearest color for every 5-bit-per-channel RGB, so a frame is a table lookup per dot. */
let lookup: Uint8Array | null = null;
function nearestTable() {
  if (lookup) return lookup;
  lookup = new Uint8Array(32 * 32 * 32);
  for (let r = 0; r < 32; r++)
    for (let g = 0; g < 32; g++)
      for (let b = 0; b < 32; b++) lookup[(r << 10) | (g << 5) | b] = nearest(r * 8.2, g * 8.2, b * 8.2);
  return lookup;
}
const bits = (v: number) => (v <= 0 ? 0 : v >= 255 ? 31 : v >> 3);

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });

/**
 * Sets up the pane for one size and returns a function drawing the frame at a time in seconds.
 * The photo is scaled to one sample per cell, toned, ordered-dithered, and written straight into pixels.
 */
function createPanel(canvas: HTMLCanvasElement, image: HTMLImageElement, width: number, height: number) {
  const context = canvas.getContext('2d');
  if (!context || width < 1 || height < 1) return null;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  // Whole device pixels, so dots stay crisp at fractional display scales.
  const cell = Math.max(1, Math.round(CELL * scale));
  const dot = Math.max(1, Math.min(cell, Math.round(DOT * scale)));
  const columns = Math.ceil(canvas.width / cell);
  const rows = Math.ceil(canvas.height / cell);

  const sampler = document.createElement('canvas');
  sampler.width = columns;
  sampler.height = rows;
  const sample = sampler.getContext('2d', { willReadFrequently: true });
  if (!sample) return null;
  sample.imageSmoothingQuality = 'high';
  const table = nearestTable();

  // Cover the pane with room to drift, then place the shuttle at the target point. In device pixels.
  const drift = DRIFT * scale;
  const cover = ZOOM * Math.max((canvas.width + drift * 2) / image.width, (canvas.height + drift * 2) / image.height);
  const drawnWidth = image.width * cover;
  const drawnHeight = image.height * cover;
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const baseX = clamp(canvas.width * TARGET.x - drawnWidth * FOCUS.x, canvas.width + drift - drawnWidth, -drift);
  const baseY = clamp(canvas.height * TARGET.y - drawnHeight * FOCUS.y, canvas.height + drift - drawnHeight, -drift);

  const output = context.createImageData(canvas.width, canvas.height);
  const pixels = new Uint32Array(output.data.buffer);
  pixels.fill(GAP_PACKED);
  const previous = new Int16Array(columns * rows).fill(-1);

  return (time: number) => {
    const phase = (time / PERIOD) * Math.PI * 2;
    const x = baseX + Math.sin(phase) * drift;
    const y = baseY + Math.sin(phase * 0.5 + 1) * drift * 0.4;
    sample.drawImage(image, x / cell, y / cell, drawnWidth / cell, drawnHeight / cell);
    const source = sample.getImageData(0, 0, columns, rows).data;

    let changed = false;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const i = row * columns + column;
        let r = CURVE[source[i * 4]];
        let g = CURVE[source[i * 4 + 1]];
        let b = CURVE[source[i * 4 + 2]];
        const luma = 0.3 * r + 0.59 * g + 0.11 * b;
        const nudge = BAYER[(row & 7) * 8 + (column & 7)] * SPREAD;
        r = luma + (r - luma) * SATURATION + nudge;
        g = luma + (g - luma) * SATURATION + nudge;
        b = luma + (b - luma) * SATURATION + nudge;
        const index = table[(bits(r) << 10) | (bits(g) << 5) | bits(b)];
        if (index === previous[i]) continue;
        previous[i] = index;
        changed = true;
        if (cell === 1) {
          pixels[row * canvas.width + column] = PACKED[index];
          continue;
        }
        const left = column * cell;
        const top = row * cell;
        const across = Math.min(cell, canvas.width - left);
        for (let dy = 0; dy < cell && top + dy < canvas.height; dy++) {
          const start = (top + dy) * canvas.width + left;
          pixels.fill(dot >= cell ? PACKED[index] : DIM[index], start, start + across);
          if (dy < dot && dot < cell) pixels.fill(PACKED[index], start, start + Math.min(dot, across));
        }
      }
    }
    if (changed) context.putImageData(output, 0, 0);
  };
}

/**
 * The shuttle over Earth's limb, ordered-dithered into a fine dot grid behind the whole home pane,
 * drifting slowly. It runs only while on screen and the window is showing, and holds one still
 * frame for people who prefer less motion.
 */
export function DitherScene({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const still = prefersReducedMotion();
    let cancelled = false;
    let image: HTMLImageElement | null = null;
    let frame = 0;
    let size = { width: 0, height: 0 };
    let last = '';
    let lastDraw = 0;
    let onScreen = true;
    let draw: ((time: number) => void) | null = null;

    const rebuild = () => {
      if (!image) return;
      const key = `${size.width}x${size.height}x${window.devicePixelRatio}`;
      if (key === last) return;
      last = key;
      draw = createPanel(canvas, image, size.width, size.height);
      draw?.(still ? 0 : performance.now() / 1000);
    };

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (!draw || !onScreen || document.hidden || now - lastDraw < 1000 / FPS) return;
      lastDraw = now;
      draw(now / 1000);
    };

    const resize = new ResizeObserver(([entry]) => {
      size = { width: entry.contentRect.width, height: entry.contentRect.height };
      rebuild();
    });
    const visible = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; });
    resize.observe(canvas);
    visible.observe(canvas);
    loadImage(shuttleUrl).then((loaded) => {
      if (cancelled) return;
      image = loaded;
      rebuild();
      if (!still) frame = requestAnimationFrame(tick);
    }, () => {});
    return () => {
      cancelled = true;
      resize.disconnect();
      visible.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none block select-none ${className}`}
      style={{ background: GAP, filter: `blur(${BLUR}px)` }}
    />
  );
}
