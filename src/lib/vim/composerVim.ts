/**
 * Pure Vim state machine for plain-text composers (the agent bar). The note
 * editor has its own engine in editorVim.ts; this one only knows about a string
 * and a cursor, so it works on any <textarea>.
 */
import { charClass, firstNonBlank, nextWordStart, prevWordStart, wordEnd } from './motions.ts';

export type ComposerVimMode = 'normal' | 'insert';

type Operator = 'd' | 'c' | 'y';

export interface ComposerVimState {
  text: string;
  cursor: number;
  mode: ComposerVimMode;
  /** Keys waiting for a follow-up: an operator, `g`, an operator + `g`, or `r`. */
  pending: string;
  /** Digits typed for the next motion. */
  count: string;
  /** Count typed before the operator (`2dw`). */
  opCount: number;
  /** Column `j`/`k` try to return to across shorter lines. */
  goalCol: number | null;
  register: { text: string; linewise: boolean };
  undo: Array<{ text: string; cursor: number }>;
}

const UNDO_LIMIT = 100;
/** Vim counts are typed by hand; anything larger saturates here so one key can't stall the UI. */
export const MAX_COMPOSER_COUNT = 1000;
/** A paste that would leave the composer longer than this (UTF-16 units) does nothing. */
export const MAX_COMPOSER_PASTE_CHARS = 1024 * 1024;

export function initialComposerVim(mode: ComposerVimMode = 'insert'): ComposerVimState {
  return {
    text: '',
    cursor: 0,
    mode,
    pending: '',
    count: '',
    opCount: 0,
    goalCol: null,
    register: { text: '', linewise: false },
    undo: [],
  };
}

/* --------------------------------------------------------------- text -- */

const lineStart = (s: string, i: number) => (i <= 0 ? 0 : s.lastIndexOf('\n', i - 1) + 1);

const lineEnd = (s: string, i: number) => {
  const end = s.indexOf('\n', i);
  return end === -1 ? s.length : end;
};

const isLowSurrogate = (s: string, i: number) => {
  const code = s.charCodeAt(i);
  return code >= 0xdc00 && code <= 0xdfff;
};

const nextChar = (s: string, i: number) => Math.min(s.length, i + (isLowSurrogate(s, i + 1) ? 2 : 1));
const prevChar = (s: string, i: number) => Math.max(0, i - (isLowSurrogate(s, i - 1) ? 2 : 1));

const firstNonBlankAt = (s: string, i: number) => {
  const start = lineStart(s, i);
  return start + firstNonBlank(s.slice(start, lineEnd(s, i)));
};

/** Normal mode rests on a character, never past the end of the line. */
export function clampNormalCursor(text: string, cursor: number): number {
  const at = Math.max(0, Math.min(text.length, cursor));
  const start = lineStart(text, at);
  const end = lineEnd(text, at);
  return end === start ? start : Math.min(at, prevChar(text, end));
}

/** 1-based row and column, as shown in the status line. */
export function composerCursorPosition(text: string, cursor: number): { row: number; col: number } {
  let row = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < cursor; i = text.indexOf('\n', i + 1)) row++;
  return { row, col: cursor - lineStart(text, cursor) + 1 };
}

function lineAtRow(text: string, row: number): number {
  let start = 0;
  for (let r = 1; r < row; r++) {
    const end = text.indexOf('\n', start);
    if (end === -1) break;
    start = end + 1;
  }
  return start;
}

/* ------------------------------------------------------------ motions -- */

interface Motion {
  to: number;
  /** The operator range includes the character at `to` (`e`, `$`). */
  inclusive?: boolean;
  linewise?: boolean;
  goalCol?: number;
}

function motionFor(s: ComposerVimState, key: string, count: number, hasCount: boolean, forOperator: boolean): Motion | null {
  const { text, cursor } = s;
  const start = lineStart(text, cursor);
  const end = lineEnd(text, cursor);
  const repeat = (step: (at: number) => number) => {
    let at = cursor;
    for (let k = 0; k < count; k++) {
      const next = step(at);
      if (next === at) break;
      at = next;
    }
    return at;
  };

  switch (key) {
    case 'h':
      return { to: repeat((at) => (at > start ? prevChar(text, at) : at)) };
    case 'l':
      // An operator may reach the end of the line; the cursor stops on the last character.
      return { to: repeat((at) => (at < (forOperator ? end : clampNormalCursor(text, end)) ? nextChar(text, at) : at)) };
    case 'j':
    case 'k': {
      const goalCol = s.goalCol ?? cursor - start;
      let line = start;
      for (let n = 0; n < count; n++) {
        if (key === 'j') {
          const lineStop = lineEnd(text, line);
          if (lineStop >= text.length) break;
          line = lineStop + 1;
        } else {
          if (line === 0) break;
          line = lineStart(text, line - 1);
        }
      }
      return { to: Math.min(line + goalCol, lineEnd(text, line)), linewise: true, goalCol };
    }
    case 'w':
    case 'W':
      return { to: repeat((at) => nextWordStart(text, at, key === 'W')) };
    case 'b':
    case 'B':
      return { to: repeat((at) => prevWordStart(text, at, key === 'B')) };
    case 'e':
    case 'E':
      return { to: repeat((at) => wordEnd(text, at, key === 'E')), inclusive: true };
    case '0':
      return { to: start };
    case '^':
      return { to: firstNonBlankAt(text, cursor) };
    case '$':
      return { to: end > start ? prevChar(text, end) : start, inclusive: true };
    case 'G':
      return {
        to: firstNonBlankAt(text, hasCount ? lineAtRow(text, count) : text.length),
        linewise: true,
      };
    default:
      return null;
  }
}

/** Where `dw`/`cw` stop, which isn't where `w` lands: they never eat the next line's start. */
function wordOperatorEnd(text: string, from: number, count: number, big: boolean, op: Operator): number {
  const n = text.length;
  // `cw` on a word changes up to its end and keeps the following space.
  if (op === 'c' && charClass(text[from], big) !== 0) {
    let at = from;
    for (let k = 0; k < count; k++) {
      const insideWord = k > 0 || charClass(text[at + 1], big) === charClass(text[at], big);
      if (insideWord) at = wordEnd(text, at, big);
    }
    return nextChar(text, at);
  }
  let at = from;
  for (let k = 0; k < count; k++) {
    const next = nextWordStart(text, at, big);
    // nextWordStart clamps to the last character, so running out of words looks like a move.
    const clamped =
      next === n - 1 &&
      (charClass(text[next], big) === 0 || charClass(text[next - 1], big) === charClass(text[next], big));
    if (next === at || clamped) {
      at = n;
      break;
    }
    at = next;
  }
  return lineStart(text, at) > lineEnd(text, from) ? lineStart(text, at) - 1 : Math.min(at, n);
}

/* ---------------------------------------------------------- transitions -- */

const parseCount = (digits: string) => Math.min(parseInt(digits, 10) || 1, MAX_COMPOSER_COUNT);

const settled = (s: ComposerVimState): ComposerVimState => ({ ...s, pending: '', count: '', opCount: 0 });

const pushUndo = (s: ComposerVimState, prev: ComposerVimState): ComposerVimState => ({
  ...s,
  undo: [...prev.undo.slice(1 - UNDO_LIMIT), { text: prev.text, cursor: prev.cursor }],
});

function edit(prev: ComposerVimState, text: string, cursor: number, register?: ComposerVimState['register']): ComposerVimState {
  const next = settled({
    ...prev,
    text,
    cursor: clampNormalCursor(text, cursor),
    goalCol: null,
    register: register ?? prev.register,
  });
  return text === prev.text ? next : pushUndo(next, prev);
}

/** Enters insert mode. The snapshot lets `u` undo the whole insert as one change. */
function insertAt(prev: ComposerVimState, text: string, cursor: number, register?: ComposerVimState['register']): ComposerVimState {
  return pushUndo(
    settled({ ...prev, text, cursor, mode: 'insert', goalCol: null, register: register ?? prev.register }),
    prev,
  );
}

function operateChars(s: ComposerVimState, op: Operator, from: number, to: number): ComposerVimState {
  const removed = s.text.slice(from, to);
  const register = { text: removed, linewise: false };
  if (op === 'y') return settled({ ...s, cursor: from, register });
  const text = s.text.slice(0, from) + s.text.slice(to);
  if (op === 'c') return insertAt(s, text, from, register);
  return edit(s, text, from, register);
}

function operateLines(s: ComposerVimState, op: Operator, firstAt: number, lastAt: number): ComposerVimState {
  const { text } = s;
  const from = lineStart(text, firstAt);
  const to = lineEnd(text, lastAt);
  const register = { text: text.slice(from, to), linewise: true };
  if (op === 'y') return settled({ ...s, register });
  if (op === 'c') return insertAt(s, text.slice(0, from) + text.slice(to), from, register);
  if (to < text.length) {
    const next = text.slice(0, from) + text.slice(to + 1);
    return edit(s, next, firstNonBlankAt(next, from), register);
  }
  const next = text.slice(0, Math.max(0, from - 1));
  return edit(s, next, firstNonBlankAt(next, next.length), register);
}

function applyOperator(s: ComposerVimState, op: Operator, motionKey: string, motion: Motion, count: number): ComposerVimState {
  const { cursor, text } = s;
  if (motion.linewise) return operateLines(s, op, Math.min(cursor, motion.to), Math.max(cursor, motion.to));
  if (motionKey === 'w' || motionKey === 'W') {
    return operateChars(s, op, cursor, wordOperatorEnd(text, cursor, count, motionKey === 'W', op));
  }
  const from = Math.min(cursor, motion.to);
  const far = Math.max(cursor, motion.to);
  const to = motion.inclusive ? nextChar(text, far) : far;
  return operateChars(s, op, from, Math.min(to, text.length));
}

function moveTo(s: ComposerVimState, motion: Motion): ComposerVimState {
  return settled({ ...s, cursor: clampNormalCursor(s.text, motion.to), goalCol: motion.goalCol ?? null });
}

function paste(s: ComposerVimState, key: 'p' | 'P', count: number): ComposerVimState {
  const { text, cursor, register } = s;
  if (!register.text) return settled(s);
  const pasted = count * register.text.length + (register.linewise ? count : 0);
  if (text.length + pasted > MAX_COMPOSER_PASTE_CHARS) return settled(s);
  const body = Array.from({ length: count }, () => register.text);
  if (register.linewise) {
    const lines = body.join('\n');
    if (key === 'p') {
      const end = lineEnd(text, cursor);
      const next = `${text.slice(0, end)}\n${lines}${text.slice(end)}`;
      return edit(s, next, firstNonBlankAt(next, end + 1));
    }
    const start = lineStart(text, cursor);
    const next = `${text.slice(0, start)}${lines}\n${text.slice(start)}`;
    return edit(s, next, firstNonBlankAt(next, start));
  }
  const chars = body.join('');
  const onEmptyLine = lineStart(text, cursor) === lineEnd(text, cursor);
  const at = key === 'p' && !onEmptyLine ? nextChar(text, cursor) : cursor;
  return edit(s, text.slice(0, at) + chars + text.slice(at), at + chars.length - 1);
}

/** Escape / Ctrl+[ from any mode: cancels pending keys, and insert steps back one character. */
export function composerVimEscape(s: ComposerVimState): ComposerVimState {
  if (s.mode === 'normal') return settled(s);
  const last = s.undo[s.undo.length - 1];
  const undo = last && last.text === s.text ? s.undo.slice(0, -1) : s.undo;
  const cursor = s.cursor > lineStart(s.text, s.cursor) ? prevChar(s.text, s.cursor) : s.cursor;
  return settled({ ...s, mode: 'normal', undo, goalCol: null, cursor: clampNormalCursor(s.text, cursor) });
}

/** One printable key in normal mode. Keys Vim would reject just clear what was pending. */
export function composerVimKey(s: ComposerVimState, key: string): ComposerVimState {
  const { text, cursor } = s;

  if (s.pending === 'r') {
    const count = parseCount(s.count);
    const end = lineEnd(text, cursor);
    let to = cursor;
    for (let k = 0; k < count; k++) {
      if (to >= end) return settled(s);
      to = nextChar(text, to);
    }
    return edit(s, text.slice(0, cursor) + key.repeat(count) + text.slice(to), cursor + count - 1);
  }

  if (/^[1-9]$/.test(key) || (key === '0' && s.count)) {
    return { ...s, count: String(Math.min(Number(s.count + key), MAX_COMPOSER_COUNT)) };
  }

  const hasCount = !!s.count || s.opCount > 0;
  const count = Math.min(parseCount(s.count) * (s.opCount || 1), MAX_COMPOSER_COUNT);
  const pendingOp = (['d', 'c', 'y'] as const).find((op) => s.pending.startsWith(op));

  if (s.pending.endsWith('g')) {
    if (key !== 'g') return settled(s);
    const to = firstNonBlankAt(text, lineAtRow(text, hasCount ? count : 1));
    return pendingOp ? operateLines(s, pendingOp, Math.min(cursor, to), Math.max(cursor, to)) : moveTo(s, { to });
  }

  if (key === 'g') return { ...s, pending: `${s.pending}g` };

  if (pendingOp) {
    if (key === pendingOp) {
      const last = lineAtRow(text.slice(cursor), count) + cursor;
      return operateLines(s, pendingOp, cursor, last);
    }
    const motion = motionFor(s, key, count, hasCount, true);
    return motion ? applyOperator(s, pendingOp, key, motion, count) : settled(s);
  }

  const motion = motionFor(s, key, count, hasCount, false);
  if (motion) return moveTo(s, motion);

  const start = lineStart(text, cursor);
  const end = lineEnd(text, cursor);
  const chars = (from: number, n: number) => {
    let to = from;
    for (let k = 0; k < n && to < end; k++) to = nextChar(text, to);
    return to;
  };

  switch (key) {
    case 'i':
      return insertAt(s, text, cursor);
    case 'a':
      return insertAt(s, text, end === start ? cursor : nextChar(text, cursor));
    case 'I':
      return insertAt(s, text, firstNonBlankAt(text, cursor));
    case 'A':
      return insertAt(s, text, end);
    case 'o':
      return insertAt(s, `${text.slice(0, end)}\n${text.slice(end)}`, end + 1);
    case 'O':
      return insertAt(s, `${text.slice(0, start)}\n${text.slice(start)}`, start);
    case 'd':
    case 'c':
    case 'y':
      return { ...s, pending: key, opCount: count, count: '' };
    case 'x':
      return end === start ? settled(s) : operateChars(s, 'd', cursor, chars(cursor, count));
    case 'X': {
      let from = cursor;
      for (let k = 0; k < count && from > start; k++) from = prevChar(text, from);
      return operateChars(s, 'd', from, cursor);
    }
    case 's':
      return operateChars(s, 'c', cursor, chars(cursor, count));
    case 'S':
      return operateLines(s, 'c', cursor, cursor);
    case 'C':
      return operateChars(s, 'c', cursor, end);
    case 'D':
      return operateChars(s, 'd', cursor, end);
    case 'Y':
      return operateLines(s, 'y', cursor, cursor);
    case 'p':
    case 'P':
      return paste(s, key, count);
    case 'r':
      return { ...s, pending: 'r' };
    case 'u': {
      const last = s.undo[s.undo.length - 1];
      if (!last) return settled(s);
      return settled({
        ...s,
        text: last.text,
        cursor: clampNormalCursor(last.text, last.cursor),
        undo: s.undo.slice(0, -1),
        goalCol: null,
      });
    }
    default:
      return settled(s);
  }
}
