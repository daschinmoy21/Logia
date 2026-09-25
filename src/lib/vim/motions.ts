/**
 * Pure text motions for the vim engine. They operate on a flat string where
 * blocks are joined with "\n", and return string indices.
 */

/** 0 = whitespace, 1 = word char, 2 = punctuation (vim "word" classes). */
export function charClass(c: string | undefined, bigWord = false): number {
  if (c === undefined || c === '\n' || /\s/.test(c)) return 0;
  if (bigWord) return 1;
  return /[\p{L}\p{N}_]/u.test(c) ? 1 : 2;
}

/** Start of the next word (vim `w` / `W`). Empty lines count as words. */
export function nextWordStart(s: string, i: number, bigWord = false): number {
  const n = s.length;
  if (i >= n - 1) return Math.max(0, n - 1);
  const start = charClass(s[i], bigWord);
  if (start !== 0) {
    while (i < n && charClass(s[i], bigWord) === start) i++;
  }
  while (i < n && charClass(s[i], bigWord) === 0) {
    // An empty line is its own word: "\n\n" stops on the second newline.
    if (s[i] === '\n' && s[i + 1] === '\n') return i + 1;
    i++;
  }
  return Math.min(i, Math.max(0, n - 1));
}

/** End of the current/next word (vim `e` / `E`). */
export function wordEnd(s: string, i: number, bigWord = false): number {
  const n = s.length;
  i++;
  while (i < n && charClass(s[i], bigWord) === 0) i++;
  if (i >= n) return Math.max(0, n - 1);
  const cls = charClass(s[i], bigWord);
  while (i + 1 < n && charClass(s[i + 1], bigWord) === cls) i++;
  return i;
}

/** Start of the current/previous word (vim `b` / `B`). */
export function prevWordStart(s: string, i: number, bigWord = false): number {
  if (i <= 0) return 0;
  i--;
  while (i > 0 && charClass(s[i], bigWord) === 0) {
    if (s[i] === '\n' && s[i - 1] === '\n') return i;
    i--;
  }
  const cls = charClass(s[i], bigWord);
  while (i > 0 && charClass(s[i - 1], bigWord) === cls) i--;
  return i;
}

/** Index of the first non-blank character in a line (vim `^`). */
export function firstNonBlank(line: string): number {
  const m = /\S/.exec(line);
  return m ? m.index : 0;
}

/**
 * Find `ch` in `line` from `offset` (vim f/F/t/T). Returns the new offset or
 * -1 when not found.
 */
export function findInLine(
  line: string,
  offset: number,
  ch: string,
  kind: 'f' | 'F' | 't' | 'T',
  count = 1,
): number {
  if (kind === 'f' || kind === 't') {
    let p = offset;
    let idx = -1;
    for (let k = 0; k < count; k++) {
      idx = line.indexOf(ch, p + 1);
      if (idx === -1) return -1;
      p = idx;
    }
    return kind === 't' ? idx - 1 : idx;
  }
  let p = offset;
  let idx = -1;
  for (let k = 0; k < count; k++) {
    if (p - 1 < 0) return -1;
    idx = line.lastIndexOf(ch, p - 1);
    if (idx === -1) return -1;
    p = idx;
  }
  return kind === 'T' ? idx + 1 : idx;
}

/** Range [from, to) of a text object inside a single line, or null. */
export function textObject(
  line: string,
  offset: number,
  obj: string,
  around: boolean,
): [number, number] | null {
  if (obj === 'w' || obj === 'W') {
    if (!line.length) return null;
    const big = obj === 'W';
    const cls = charClass(line[offset], big);
    let from = offset;
    let to = offset + 1;
    while (from > 0 && charClass(line[from - 1], big) === cls) from--;
    while (to < line.length && charClass(line[to], big) === cls) to++;
    if (around) {
      const trailing = to;
      while (to < line.length && charClass(line[to], big) === 0) to++;
      if (to === trailing) {
        while (from > 0 && charClass(line[from - 1], big) === 0) from--;
      }
    }
    return [from, to];
  }

  const pairs: Record<string, [string, string]> = {
    '"': ['"', '"'],
    "'": ["'", "'"],
    '`': ['`', '`'],
    '(': ['(', ')'],
    ')': ['(', ')'],
    b: ['(', ')'],
    '[': ['[', ']'],
    ']': ['[', ']'],
    '{': ['{', '}'],
    '}': ['{', '}'],
    B: ['{', '}'],
    '<': ['<', '>'],
    '>': ['<', '>'],
  };
  const pair = pairs[obj];
  if (!pair) return null;
  const [open, close] = pair;

  let start = -1;
  let end = -1;
  if (open === close) {
    // Quotes: the pair around the cursor, or the next pair on the line.
    const before = line.lastIndexOf(open, line[offset] === open ? offset - 1 : offset);
    if (line[offset] === open) {
      const after = line.indexOf(close, offset + 1);
      if (before !== -1 && (line.slice(0, offset).split(open).length - 1) % 2 === 1) {
        start = before;
        end = offset;
      } else if (after !== -1) {
        start = offset;
        end = after;
      }
    } else if (before !== -1) {
      const after = line.indexOf(close, offset);
      if (after !== -1) {
        start = before;
        end = after;
      }
    } else {
      const first = line.indexOf(open, offset);
      const second = first === -1 ? -1 : line.indexOf(close, first + 1);
      if (second !== -1) {
        start = first;
        end = second;
      }
    }
  } else {
    let depth = 0;
    for (let i = offset; i >= 0; i--) {
      if (line[i] === close && i !== offset) depth++;
      else if (line[i] === open) {
        if (depth === 0) {
          start = i;
          break;
        }
        depth--;
      }
    }
    if (start !== -1) {
      depth = 0;
      for (let i = start + 1; i < line.length; i++) {
        if (line[i] === open) depth++;
        else if (line[i] === close) {
          if (depth === 0) {
            end = i;
            break;
          }
          depth--;
        }
      }
    }
  }
  if (start === -1 || end === -1) return null;
  return around ? [start, end + 1] : [start + 1, end];
}

/**
 * Find the next match of `query` in `s` starting after `from` (or before it
 * when `backward`). Smart-case: case-sensitive only if the query has capitals.
 * Wraps around. Returns [index, wrapped] or null.
 */
export function searchText(
  s: string,
  query: string,
  from: number,
  backward = false,
): [number, boolean] | null {
  if (!query) return null;
  const caseSensitive = /[A-Z]/.test(query);
  const hay = caseSensitive ? s : s.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  if (!backward) {
    const idx = hay.indexOf(needle, from + 1);
    if (idx !== -1) return [idx, false];
    const wrapped = hay.indexOf(needle);
    return wrapped === -1 ? null : [wrapped, true];
  }
  const idx = from > 0 ? hay.lastIndexOf(needle, from - 1) : -1;
  if (idx !== -1) return [idx, false];
  const wrapped = hay.lastIndexOf(needle);
  return wrapped === -1 ? null : [wrapped, true];
}
