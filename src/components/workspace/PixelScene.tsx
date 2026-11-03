import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '../../lib/utils';

/** One matrix cell, in CSS pixels: a tall lit bar and the dark gap around it. */
const CELL_WIDTH = 5;
const CELL_HEIGHT = 9;
const BAR_WIDTH = 3;
const BAR_HEIGHT = 7;

/** Chunky on purpose, and it keeps the panel cheap beside the editor. */
const FPS = 12;
const LEVELS = 8;
const SEED = 41.7;

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const RAMP = ['#0f0c0a', '#1b1612', '#29211b'].map(rgb);
const PANEL = '#050303';
/** Colors of what moves across the panel, past the glow's levels in a cell's color index. */
const SPRITE = { cream: LEVELS, orange: LEVELS + 1, stem: LEVELS + 2, blade: LEVELS + 3, petal: LEVELS + 4, bud: LEVELS + 5 };
const SPRITE_COLORS = ['#f7ecc4', '#f47a35', '#7a2a0c', '#4a1a08', '#f6ae5c', '#fbe7a6'];

const hash = (x: number, y: number) => {
  const value = Math.sin(x * 127.1 + y * 311.7 + SEED) * 43758.5453;
  return value - Math.floor(value);
};

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

function noise(x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const top = hash(ix, iy) * (1 - fx) + hash(ix + 1, iy) * fx;
  const bottom = hash(ix, iy + 1) * (1 - fx) + hash(ix + 1, iy + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

function fbm(x: number, y: number) {
  let total = 0;
  let amplitude = 0.5;
  for (let octave = 0; octave < 4; octave++) {
    total += noise(x, y) * amplitude;
    x = x * 2.03 + 7.1;
    y = y * 2.03 + 3.3;
    amplitude /= 2;
  }
  return total / 0.9375;
}

function color(value: number) {
  const position = clamp01(value) * (RAMP.length - 1);
  const index = Math.min(RAMP.length - 2, Math.floor(position));
  const t = position - index;
  const [a, b] = [RAMP[index], RAMP[index + 1]];
  return `rgb(${a[0] + (b[0] - a[0]) * t} ${a[1] + (b[1] - a[1]) * t} ${a[2] + (b[2] - a[2]) * t})`;
}

const PALETTE = [...Array.from({ length: LEVELS }, (_, i) => color(i / (LEVELS - 1))), ...SPRITE_COLORS];

/** The unlit panel, worked out once per size: faint drifts so the boxes stay visible. */
function buildField(columns: number, rows: number, height: number) {
  const field = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const drift = fbm((column * CELL_WIDTH) / (height * 0.5), (row * CELL_HEIGHT) / (height * 0.12));
      field[row * columns + column] = clamp01(drift * 1.1 - 0.1) * (0.85 + 0.3 * hash(column, row));
    }
  }
  return field;
}

type Put = (column: number, row: number, sprite: number) => void;

function drawBird(put: Put, column: number, row: number, seed: number, time: number) {
  const span = 5 + Math.round(hash(seed, 5) * 2);
  const flap = Math.sin(time * (6.5 + hash(seed, 6) * 2) + seed * 1.7);
  const color = hash(seed, 7) > 0.35 ? SPRITE.cream : SPRITE.orange;
  put(column, row, color);
  put(column + 1, row, color);
  for (let k = 1; k <= span; k++) {
    // Wings bend at the middle joint, so a downstroke reads as an M and an upstroke as a V.
    const along = k / span;
    const lift = flap * 2.6 * along - Math.max(0, along - 0.55) * flap * 1.6;
    put(column - k, row - lift, color);
    put(column + 1 + k, row - lift, color);
  }
}

/** A loose V, gliding across the panel on a slow swell and wrapping around. */
function drawFlock(put: Put, columns: number, rows: number, index: number, time: number) {
  const direction = index % 2 ? -1 : 1;
  const birds = 3 + index * 2;
  const span = columns + 120;
  const travel = (time * (7 + index * 2.5) + hash(index, 3) * span) % span;
  const lead = direction > 0 ? travel - 60 : columns + 60 - travel;
  const lane = rows * (0.16 + index * 0.17) + 2;
  for (let bird = 0; bird < birds; bird++) {
    const rank = Math.ceil(bird / 2);
    const side = bird % 2 ? -1 : 1;
    const seed = index * 10 + bird;
    const column = lead - direction * rank * 16 + (hash(seed, 8) - 0.5) * 4;
    const row = lane + side * rank * 2.4 + 1.5 * Math.sin(time * 0.45 + column * 0.02 + seed);
    drawBird(put, column, row, seed, time);
  }
}

function drawPlant(put: Put, base: number, ground: number, seed: number, time: number) {
  const flower = hash(seed, 1) > 0.5;
  const height = flower ? 9 + hash(seed, 2) * 9 : 4 + hash(seed, 2) * 6;
  const reach = 2.5 + hash(seed, 3) * 4;
  // A gust that travels along the ground, so neighbours lean one after another.
  const wind = (lean: number) =>
    Math.sin(time * 1.25 - base * 0.09 + hash(seed, 4)) * lean + Math.sin(time * 0.37 - base * 0.03) * lean * 0.6;
  let column = base;
  let row = ground;
  for (let step = 0; step <= height; step++) {
    const along = step / height;
    column = base + wind(reach * along * along);
    row = ground - step;
    put(column, row, flower ? SPRITE.stem : SPRITE.blade);
  }
  if (!flower) return;
  for (const [dx, dy] of [[-2, 0], [2, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    put(column + dx, row + dy, SPRITE.petal);
  }
  put(column, row, SPRITE.bud);
}

/**
 * Sets up the panel for one size and returns a function drawing the frame at a time in seconds.
 * Only cells whose color changed are repainted.
 */
function createPanel(canvas: HTMLCanvasElement, width: number, height: number) {
  const context = canvas.getContext('2d');
  if (!context || width < 1 || height < 1) return null;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  context.scale(scale, scale);
  context.fillStyle = PANEL;
  context.fillRect(0, 0, width, height);

  const columns = Math.ceil(width / CELL_WIDTH);
  const rows = Math.ceil(height / CELL_HEIGHT);
  const field = buildField(columns, rows, height);
  const previous = new Int16Array(columns * rows).fill(-1);
  const sprites = new Int16Array(columns * rows);

  const flocks = columns < 120 ? 1 : 2;
  const ground = Math.round(rows * 0.8);
  // Plants frame the panel and stay clear of the greeting in the middle.
  const plants: number[] = [];
  for (let column = 1; column < columns; column += 2) {
    const side = Math.min(column, columns - column) / columns;
    if (side < 0.2 && hash(column, 11) > 0.35 + side * 2) plants.push(column);
  }

  return (time: number) => {
    sprites.fill(-1);
    const put: Put = (column, row, sprite) => {
      const c = Math.round(column);
      const r = Math.round(row);
      if (c >= 0 && c < columns && r >= 0 && r < rows) sprites[r * columns + c] = sprite;
    };
    for (let plant = 0; plant < plants.length; plant++) drawPlant(put, plants[plant], ground, plants[plant], time);
    for (let flock = 0; flock < flocks; flock++) drawFlock(put, columns, rows, flock, time);

    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const i = row * columns + column;
        let index = sprites[i];
        if (index < 0) index = Math.round(field[i] * (LEVELS - 1));
        if (index === previous[i]) continue;
        previous[i] = index;
        context.fillStyle = PALETTE[index];
        context.fillRect(column * CELL_WIDTH, row * CELL_HEIGHT, BAR_WIDTH, BAR_HEIGHT);
      }
    }
  };
}

/**
 * A boxed dot-matrix scene of birds passing over flowers in the wind. It runs only while it's on
 * screen and the window is showing, and holds one still frame for people who prefer less motion.
 */
export function PixelScene({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const still = prefersReducedMotion();
    let frame = 0;
    let last = '';
    let lastDraw = 0;
    let onScreen = true;
    let draw: ((time: number) => void) | null = null;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (!draw || !onScreen || document.hidden || now - lastDraw < 1000 / FPS) return;
      lastDraw = now;
      draw(now / 1000);
    };

    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const size = `${width}x${height}`;
      if (size === last) return;
      last = size;
      draw = createPanel(canvas, width, height);
      draw?.(performance.now() / 1000);
    });
    const visible = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; });
    resize.observe(canvas);
    visible.observe(canvas);
    if (!still) frame = requestAnimationFrame(tick);
    return () => {
      resize.disconnect();
      visible.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  const mask = 'linear-gradient(to bottom, black 46%, transparent 92%)';
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none block select-none ${className}`}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    />
  );
}
