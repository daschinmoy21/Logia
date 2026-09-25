/**
 * Vim emulation for the BlockNote (ProseMirror) editor.
 *
 * Text motions work on a flat view of the document (textblocks joined by
 * "\n"); line-wise commands (dd, yy, p, V…) work on BlockNote blocks, which
 * map naturally to vim lines.
 */
import type { BlockNoteEditor } from '@blocknote/core';
import type { VimMode } from '../../store/vimStore';
import {
  findInLine,
  firstNonBlank,
  nextWordStart,
  prevWordStart,
  searchText,
  textObject,
  wordEnd,
} from './motions';

type AnyEditor = BlockNoteEditor<any, any, any>;
type View = NonNullable<AnyEditor['prosemirrorView']>;
type AnyBlock = ReturnType<AnyEditor['getTextCursorPosition']>['block'];

export interface VimHost {
  getMode(): VimMode;
  setMode(mode: VimMode): void;
  setPending(keys: string): void;
  flash(text: string, error?: boolean): void;
  leader(): void;
  commandLine(prefix: ':' | '/' | '?'): void;
  focusExplorer(): void;
}

export interface VimEngine {
  detach(): void;
  search(query: string, backward: boolean): void;
  gotoLine(line: number): void;
  enterNormal(): void;
}

interface Segment {
  flat: number; // index in flat string
  start: number; // PM position of the textblock content start
  len: number;
}

interface Flat {
  text: string;
  segs: Segment[];
}

type Register = { kind: 'text'; text: string } | { kind: 'blocks'; blocks: unknown[] } | null;

/** Unnamed register shared by all editors (survives note switches). */
let register: Register = null;
let lastSearch: { query: string; backward: boolean } | null = null;
let lastFind: { ch: string; kind: 'f' | 'F' | 't' | 'T' } | null = null;

function buildFlat(view: View): Flat {
  const segs: Segment[] = [];
  const parts: string[] = [];
  let flat = 0;
  view.state.doc.descendants((node, pos) => {
    if (node.isTextblock) {
      const start = pos + 1;
      const text = view.state.doc.textBetween(start, start + node.content.size, '\n', '￼');
      segs.push({ flat, start, len: node.content.size });
      parts.push(text);
      flat += node.content.size + 1;
      return false;
    }
    return true;
  });
  return { text: parts.join('\n'), segs };
}

function segIndexForPos(f: Flat, pos: number): number {
  let lo = 0;
  let hi = f.segs.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (f.segs[mid].start <= pos) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

function posToFlat(f: Flat, pos: number): number {
  if (!f.segs.length) return 0;
  const seg = f.segs[segIndexForPos(f, pos)];
  return seg.flat + Math.max(0, Math.min(seg.len, pos - seg.start));
}

function flatToPos(f: Flat, idx: number): number {
  if (!f.segs.length) return 1;
  let lo = 0;
  let hi = f.segs.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (f.segs[mid].flat <= idx) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const seg = f.segs[best];
  return seg.start + Math.min(seg.len, Math.max(0, idx - seg.flat));
}

function stripIds(block: any): unknown {
  const { id: _id, children, ...rest } = block;
  return { ...rest, children: (children ?? []).map(stripIds) };
}

/** Mirror yanks to the system clipboard (best effort, like `clipboard=unnamedplus`). */
function mirrorToClipboard(text: string) {
  try {
    void navigator.clipboard?.writeText(text).catch(() => {});
  } catch {
    /* clipboard unavailable */
  }
}

const isPrintable = (e: KeyboardEvent) => e.key.length === 1 && !e.ctrlKey && !e.metaKey;

export function attachVim(editor: AnyEditor, host: VimHost): VimEngine {
  const view = editor.prosemirrorView as View | undefined;
  if (!view) {
    return { detach() {}, search() {}, gotoLine() {}, enterNormal() {} };
  }
  const dom = view.dom as HTMLElement;

  // ---- per-editor command state ----
  let count = '';
  let operator: '' | 'd' | 'c' | 'y' | '>' | '<' = '';
  let opCount = 1;
  let pendingG = false;
  let pendingReplace = false;
  let pendingFind: 'f' | 'F' | 't' | 'T' | null = null;
  let pendingObject: 'i' | 'a' | null = null;
  let visualAnchor = 0; // flat index where visual mode started
  let visualHead = 0; // flat index of the vim cursor in visual modes

  const mode = () => host.getMode();

  // ---- cursor overlay (block cursor for normal/visual modes) ----
  const cursorEl = document.createElement('div');
  cursorEl.className = 'vim-block-cursor';
  document.body.appendChild(cursorEl);
  let rafId = 0;

  const cursorFlatIndex = (f: Flat): number => {
    const m = mode();
    if (m === 'visual' || m === 'visual-line') return visualHead;
    return posToFlat(f, view.state.selection.head);
  };

  const renderCursor = () => {
    rafId = 0;
    const m = mode();
    const focused = document.activeElement === dom;
    dom.classList.toggle('vim-caret-hidden', focused && m !== 'insert');
    document.body.classList.toggle('vim-visual-active', m === 'visual' || m === 'visual-line');
    if (!focused || m === 'insert' || m === 'explorer') {
      cursorEl.style.display = 'none';
      return;
    }
    try {
      const f = buildFlat(view);
      const pos = flatToPos(f, cursorFlatIndex(f));
      const a = view.coordsAtPos(pos, 1);
      let width = 8;
      const segLen = f.segs[segIndexForPos(f, pos)]?.len ?? 0;
      const segStart = f.segs[segIndexForPos(f, pos)]?.start ?? pos;
      if (pos < segStart + segLen) {
        const b = view.coordsAtPos(pos + 1, -1);
        if (Math.abs(b.top - a.top) < 2 && b.left > a.left) width = b.left - a.left;
      }
      cursorEl.style.display = 'block';
      cursorEl.style.transform = `translate(${a.left}px, ${a.top}px)`;
      cursorEl.style.width = `${Math.max(2, width)}px`;
      cursorEl.style.height = `${Math.max(12, a.bottom - a.top)}px`;
      cursorEl.classList.toggle('vim-block-cursor--visual', m !== 'normal');
      // restart blink
      cursorEl.style.animation = 'none';
      void cursorEl.offsetWidth;
      cursorEl.style.animation = '';
    } catch {
      cursorEl.style.display = 'none';
    }
  };
  const scheduleCursor = () => {
    if (!rafId) rafId = requestAnimationFrame(renderCursor);
  };

  // ---- selection helpers ----
  const setCursor = (pos: number) => {
    editor._tiptapEditor.commands.setTextSelection(pos);
    view.dispatch(view.state.tr.scrollIntoView());
    scheduleCursor();
  };

  const setRange = (from: number, to: number) => {
    editor._tiptapEditor.commands.setTextSelection({ from, to });
    scheduleCursor();
  };

  /** Normal-mode cursors sit on a character, never past the last one. */
  const clampNormal = (f: Flat, idx: number): number => {
    const pos = flatToPos(f, idx);
    const seg = f.segs[segIndexForPos(f, pos)];
    if (!seg) return idx;
    const max = seg.flat + Math.max(0, seg.len - 1);
    return Math.min(Math.max(idx, seg.flat), max);
  };

  const lineOf = (f: Flat, idx: number) => {
    const seg = f.segs[segIndexForPos(f, flatToPos(f, idx))];
    return {
      seg,
      text: f.text.slice(seg.flat, seg.flat + seg.len),
      offset: idx - seg.flat,
    };
  };

  const currentBlock = (): AnyBlock => editor.getTextCursorPosition().block;

  const blockAtFlat = (f: Flat, idx: number): AnyBlock | undefined => {
    const pos = flatToPos(f, idx);
    try {
      const $pos = view.state.doc.resolve(pos);
      for (let d = $pos.depth; d >= 0; d--) {
        const node = $pos.node(d);
        if (node.type.name === 'blockContainer' && node.attrs.id) {
          return editor.getBlock(node.attrs.id as string);
        }
      }
    } catch {
      /* ignore */
    }
    return undefined;
  };

  /** Blocks in document order, with their ancestors' ids. */
  const flattenBlocks = () => {
    const out: Array<{ block: AnyBlock; ancestors: string[] }> = [];
    const walk = (blocks: AnyBlock[], ancestors: string[]) => {
      for (const b of blocks) {
        out.push({ block: b, ancestors });
        if (b.children?.length) walk(b.children as AnyBlock[], [...ancestors, b.id]);
      }
    };
    walk(editor.document as AnyBlock[], []);
    return out;
  };

  /** Top-most blocks covering [fromId..toId] in document order. */
  const blocksBetween = (fromId: string, toId: string): AnyBlock[] => {
    const flat = flattenBlocks();
    let a = flat.findIndex((x) => x.block.id === fromId);
    let b = flat.findIndex((x) => x.block.id === toId);
    if (a === -1 || b === -1) return [];
    if (a > b) [a, b] = [b, a];
    const range = flat.slice(a, b + 1);
    const ids = new Set(range.map((x) => x.block.id));
    return range.filter((x) => !x.ancestors.some((id) => ids.has(id))).map((x) => x.block);
  };

  const blocksFromCursor = (n: number): AnyBlock[] => {
    const flat = flattenBlocks();
    const start = flat.findIndex((x) => x.block.id === currentBlock().id);
    if (start === -1) return [currentBlock()];
    const end = Math.min(flat.length - 1, start + n - 1);
    return blocksBetween(flat[start].block.id, flat[end].block.id);
  };

  // ---- editing primitives ----
  const yankBlocks = (blocks: AnyBlock[]) => {
    register = { kind: 'blocks', blocks: blocks.map(stripIds) };
    Promise.resolve(editor.blocksToMarkdownLossy(blocks as any))
      .then(mirrorToClipboard)
      .catch(() => {});
    host.flash(blocks.length > 1 ? `${blocks.length} blocks yanked` : 'block yanked');
  };

  const deleteBlocks = (blocks: AnyBlock[], yank = true) => {
    if (!blocks.length) return;
    if (yank) register = { kind: 'blocks', blocks: blocks.map(stripIds) };
    const last = blocks[blocks.length - 1];
    const next = editor.getNextBlock(last) ?? editor.getPrevBlock(blocks[0]);
    const total = flattenBlocks().filter((x) => x.ancestors.length === 0).length;
    const topLevelRemoved = blocks.filter((b) => !editor.getParentBlock(b)).length;
    if (topLevelRemoved >= total) {
      // Never leave the document without a block.
      const [fresh] = editor.replaceBlocks(blocks, [{ type: 'paragraph' }]).insertedBlocks;
      if (fresh) editor.setTextCursorPosition(fresh, 'start');
    } else {
      editor.removeBlocks(blocks);
      if (next && editor.getBlock(next.id)) editor.setTextCursorPosition(next, 'start');
    }
    scheduleCursor();
  };

  const deleteRange = (from: number, to: number, yank = true) => {
    if (to <= from) return;
    if (yank) register = { kind: 'text', text: view.state.doc.textBetween(from, to, '\n') };
    view.dispatch(view.state.tr.delete(from, to));
  };

  const insertText = (text: string, at: number) => {
    const lines = text.split('\n');
    if (lines.length === 1) {
      view.dispatch(view.state.tr.insertText(text, at));
      return at + text.length;
    }
    // Multi-line text: first line inline, the rest as new paragraphs.
    view.dispatch(view.state.tr.insertText(lines[0], at));
    const block = currentBlock();
    const inserted = editor.insertBlocks(
      lines.slice(1).map((l) => ({ type: 'paragraph', content: l })),
      block,
      'after',
    );
    const lastBlock = inserted[inserted.length - 1];
    if (lastBlock) editor.setTextCursorPosition(lastBlock, 'end');
    return view.state.selection.head;
  };

  const put = (before: boolean) => {
    if (!register) return;
    if (register.kind === 'blocks') {
      const inserted = editor.insertBlocks(register.blocks as any, currentBlock(), before ? 'before' : 'after');
      if (inserted[0]) editor.setTextCursorPosition(inserted[0], 'start');
      scheduleCursor();
      return;
    }
    const f = buildFlat(view);
    const idx = posToFlat(f, view.state.selection.head);
    const { seg } = lineOf(f, idx);
    const at = before ? flatToPos(f, idx) : Math.min(flatToPos(f, idx) + 1, seg.start + seg.len);
    const end = insertText(register.text, seg.len === 0 ? seg.start : at);
    setCursor(Math.max(seg.start, end - 1));
  };

  // ---- modes ----
  const resetPending = () => {
    count = '';
    operator = '';
    opCount = 1;
    pendingG = false;
    pendingReplace = false;
    pendingFind = null;
    pendingObject = null;
    host.setPending('');
  };

  const enterInsert = (pos?: number) => {
    resetPending();
    if (pos !== undefined) setCursor(pos);
    host.setMode('insert');
    scheduleCursor();
  };

  const enterNormal = () => {
    resetPending();
    const m = mode();
    const f = buildFlat(view);
    let idx: number;
    if (m === 'visual' || m === 'visual-line') idx = visualHead;
    else {
      idx = posToFlat(f, view.state.selection.head);
      // Leaving insert mode steps back onto the last typed character.
      if (m === 'insert' && idx > lineOf(f, idx).seg.flat) idx -= 1;
    }
    host.setMode('normal');
    setCursor(flatToPos(f, clampNormal(f, idx)));
  };

  const showVisual = () => {
    const f = buildFlat(view);
    if (mode() === 'visual-line') {
      const first = lineOf(f, Math.min(visualAnchor, visualHead)).seg;
      const last = lineOf(f, Math.max(visualAnchor, visualHead)).seg;
      setRange(first.start, last.start + last.len);
    } else {
      const from = Math.min(visualAnchor, visualHead);
      const to = Math.max(visualAnchor, visualHead) + 1;
      if (visualHead >= visualAnchor) setRange(flatToPos(f, from), flatToPos(f, to));
      else setRange(flatToPos(f, to), flatToPos(f, from));
    }
    scheduleCursor();
  };

  const enterVisual = (line: boolean) => {
    const f = buildFlat(view);
    const idx = posToFlat(f, view.state.selection.head);
    visualAnchor = idx;
    visualHead = idx;
    host.setMode(line ? 'visual-line' : 'visual');
    showVisual();
  };

  // ---- motions ----
  interface MotionResult {
    idx: number;
    inclusive?: boolean;
    linewise?: boolean;
  }

  const verticalMove = (fromPos: number, down: boolean, n: number): number => {
    const sel = window.getSelection() as Selection & {
      modify?: (alter: string, direction: string, granularity: string) => void;
    };
    if (!sel || typeof sel.modify !== 'function') {
      const f = buildFlat(view);
      const si = segIndexForPos(f, fromPos);
      const target = f.segs[Math.min(f.segs.length - 1, Math.max(0, si + (down ? n : -n)))];
      return target.start;
    }
    try {
      const { node, offset } = view.domAtPos(fromPos);
      sel.collapse(node, offset);
      for (let k = 0; k < n; k++) sel.modify('move', down ? 'forward' : 'backward', 'line');
      if (!sel.focusNode || !dom.contains(sel.focusNode)) return fromPos;
      return view.posAtDOM(sel.focusNode, sel.focusOffset);
    } catch {
      return fromPos;
    }
  };

  const motion = (key: string, n: number, f: Flat, idx: number, forOperator: boolean): MotionResult | null => {
    const { seg, text: line, offset } = lineOf(f, idx);
    switch (key) {
      case 'h':
      case 'ArrowLeft':
      case 'Backspace':
        return { idx: Math.max(seg.flat, idx - n) };
      case 'l':
      case 'ArrowRight':
        return {
          idx: Math.min(seg.flat + Math.max(0, seg.len - (forOperator ? 0 : 1)), idx + n),
        };
      case '0':
      case 'Home':
        return { idx: seg.flat };
      case '^':
        return { idx: seg.flat + firstNonBlank(line) };
      case '$':
      case 'End':
        return { idx: seg.flat + Math.max(0, seg.len - 1), inclusive: true };
      case 'w':
      case 'W': {
        let i = idx;
        for (let k = 0; k < n; k++) i = nextWordStart(f.text, i, key === 'W');
        // `dw` on the last word of a line stops at the line end, like vim.
        if (forOperator && i > seg.flat + seg.len) i = seg.flat + seg.len;
        return { idx: i };
      }
      case 'b':
      case 'B': {
        let i = idx;
        for (let k = 0; k < n; k++) i = prevWordStart(f.text, i, key === 'B');
        return { idx: i };
      }
      case 'e':
      case 'E': {
        let i = idx;
        for (let k = 0; k < n; k++) i = wordEnd(f.text, i, key === 'E');
        return { idx: i, inclusive: true };
      }
      case 'j':
      case 'k':
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Enter': {
        const down = key === 'j' || key === 'ArrowDown' || key === 'Enter';
        if (forOperator) {
          const si = segIndexForPos(f, seg.start);
          const ti = Math.min(f.segs.length - 1, Math.max(0, si + (down ? n : -n)));
          return { idx: f.segs[ti].flat, linewise: true };
        }
        const pos = verticalMove(flatToPos(f, idx), down, n);
        let target = posToFlat(f, pos);
        if (key === 'Enter') target = lineOf(f, target).seg.flat + firstNonBlank(lineOf(f, target).text);
        return { idx: target };
      }
      case '{':
      case '}': {
        const si = segIndexForPos(f, seg.start);
        const ti = Math.min(f.segs.length - 1, Math.max(0, si + (key === '}' ? n : -n)));
        return { idx: f.segs[ti].flat, linewise: forOperator };
      }
      case 'G': {
        const target = count ? f.segs[Math.min(f.segs.length, Math.max(1, n)) - 1] : f.segs[f.segs.length - 1];
        return { idx: target.flat + firstNonBlank(f.text.slice(target.flat, target.flat + target.len)), linewise: true };
      }
      case 'gg': {
        const target = f.segs[Math.min(f.segs.length, Math.max(1, count ? n : 1)) - 1];
        return { idx: target.flat + firstNonBlank(f.text.slice(target.flat, target.flat + target.len)), linewise: true };
      }
      case ';':
      case ',': {
        if (!lastFind) return null;
        const flip: Record<string, 'f' | 'F' | 't' | 'T'> = { f: 'F', F: 'f', t: 'T', T: 't' };
        const kind = key === ';' ? lastFind.kind : flip[lastFind.kind];
        const o = findInLine(line, offset, lastFind.ch, kind, n);
        return o === -1 ? null : { idx: seg.flat + o, inclusive: kind === 'f' || kind === 't' };
      }
      default:
        return null;
    }
  };

  const isMotionKey = (k: string) =>
    /^(h|j|k|l|w|W|b|B|e|E|0|\^|\$|\{|\}|G|;|,)$/.test(k) ||
    ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', 'Backspace'].includes(k);

  // ---- operators ----
  const applyOperator = (op: typeof operator, from: number, to: number, linewise: boolean, f: Flat) => {
    if (linewise) {
      const a = blockAtFlat(f, Math.min(from, to));
      const b = blockAtFlat(f, Math.max(from, to));
      if (!a || !b) return;
      const blocks = blocksBetween(a.id, b.id);
      if (op === 'y') {
        yankBlocks(blocks);
        setCursor(flatToPos(f, Math.min(from, to)));
      } else if (op === 'd') {
        deleteBlocks(blocks);
      } else if (op === 'c') {
        register = { kind: 'blocks', blocks: blocks.map(stripIds) };
        const [first, ...rest] = blocks;
        if (rest.length) editor.removeBlocks(rest);
        editor.updateBlock(first, { content: [] } as any);
        editor.setTextCursorPosition(first, 'start');
        enterInsert();
      } else if (op === '>' || op === '<') {
        for (const blk of blocks) {
          editor.setTextCursorPosition(blk, 'start');
          if (op === '>' && editor.canNestBlock()) editor.nestBlock();
          if (op === '<' && editor.canUnnestBlock()) editor.unnestBlock();
        }
        scheduleCursor();
      }
      return;
    }

    const a = flatToPos(f, Math.min(from, to));
    const b = flatToPos(f, Math.max(from, to));
    if (op === 'y') {
      register = { kind: 'text', text: view.state.doc.textBetween(a, b, '\n') };
      mirrorToClipboard(register.text);
      host.flash('yanked');
      setCursor(a);
    } else if (op === 'd') {
      deleteRange(a, b);
      const nf = buildFlat(view);
      setCursor(flatToPos(nf, clampNormal(nf, posToFlat(nf, a))));
    } else if (op === 'c') {
      deleteRange(a, b);
      enterInsert(a);
    } else if (op === '>' || op === '<') {
      applyOperator(op, from, to, true, f);
    }
  };

  // ---- key handling ----
  const handleVisualOp = (key: string, f: Flat): boolean => {
    const line = mode() === 'visual-line';
    const lo = Math.min(visualAnchor, visualHead);
    const hi = Math.max(visualAnchor, visualHead);
    const op: typeof operator | null =
      key === 'd' || key === 'x' || key === 'Delete' ? 'd' : key === 'y' ? 'y' : key === 'c' || key === 's' ? 'c' : key === '>' ? '>' : key === '<' ? '<' : null;
    if (op) {
      host.setMode('normal');
      if (line || op === '>' || op === '<') applyOperator(op, lo, hi, true, f);
      else applyOperator(op, lo, hi + 1, false, f);
      if (op !== 'c') resetPending();
      return true;
    }
    if (key === '~' || key === 'u' || key === 'U') {
      const a = flatToPos(f, lo);
      const b = flatToPos(f, line ? lineOf(f, hi).seg.flat + lineOf(f, hi).seg.len : hi + 1);
      const text = view.state.doc.textBetween(a, b, '\n', '￼');
      const mapped = [...text]
        .map((c) => (key === 'u' ? c.toLowerCase() : key === 'U' ? c.toUpperCase() : c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()))
        .join('');
      const tr = view.state.tr;
      for (let i = 0; i < text.length; i++) {
        if (text[i] !== mapped[i] && text[i] !== '\n' && text[i] !== '￼') {
          const p = flatToPos(f, lo + i);
          tr.insertText(mapped[i], p, p + 1);
        }
      }
      view.dispatch(tr);
      host.setMode('normal');
      setCursor(a);
      return true;
    }
    if (key === 'p' || key === 'P') {
      const saved = register;
      host.setMode('normal');
      if (line) {
        const a = blockAtFlat(f, lo);
        const b = blockAtFlat(f, hi);
        if (a && b && saved) {
          const blocks = blocksBetween(a.id, b.id);
          const ref = blocks[0];
          if (saved.kind === 'blocks') editor.insertBlocks(saved.blocks as any, ref, 'before');
          else editor.insertBlocks([{ type: 'paragraph', content: saved.text } as any], ref, 'before');
          deleteBlocks(blocks, false);
        }
      } else if (saved?.kind === 'text') {
        const a = flatToPos(f, lo);
        deleteRange(a, flatToPos(f, hi + 1), false);
        insertText(saved.text, a);
      }
      register = saved;
      return true;
    }
    if (key === 'o') {
      [visualAnchor, visualHead] = [visualHead, visualAnchor];
      showVisual();
      return true;
    }
    if (key === 'J') {
      host.setMode('normal');
      setCursor(flatToPos(f, lo));
      const lines = segIndexForPos(f, flatToPos(f, hi)) - segIndexForPos(f, flatToPos(f, lo));
      joinLines(Math.max(1, lines));
      return true;
    }
    return false;
  };

  const joinLines = (n: number) => {
    for (let k = 0; k < n; k++) {
      const f = buildFlat(view);
      const idx = posToFlat(f, view.state.selection.head);
      const si = segIndexForPos(f, flatToPos(f, idx));
      const cur = f.segs[si];
      const next = f.segs[si + 1];
      if (!next) return;
      const nextText = f.text.slice(next.flat, next.flat + next.len);
      const lead = firstNonBlank(nextText);
      const tr = view.state.tr;
      // Remove the boundary and leading blanks of the next line, then add one space.
      tr.delete(cur.start + cur.len, next.start + lead);
      const needsSpace = cur.len > 0 && nextText.trim().length > 0;
      if (needsSpace) tr.insertText(' ', cur.start + cur.len);
      view.dispatch(tr);
      setCursor(cur.start + cur.len);
    }
  };

  const replaceChars = (ch: string, n: number, f: Flat, idx: number) => {
    const { seg } = lineOf(f, idx);
    if (idx + n > seg.flat + seg.len) return;
    const from = flatToPos(f, idx);
    view.dispatch(view.state.tr.insertText(ch.repeat(n), from, from + n));
    setCursor(from + n - 1);
  };

  const toggleCase = (n: number, f: Flat, idx: number) => {
    const { seg } = lineOf(f, idx);
    const end = Math.min(seg.flat + seg.len, idx + n);
    const tr = view.state.tr;
    for (let i = idx; i < end; i++) {
      const c = f.text[i];
      const t = c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase();
      if (t !== c) {
        const p = flatToPos(f, i);
        tr.insertText(t, p, p + 1);
      }
    }
    view.dispatch(tr);
    const nf = buildFlat(view);
    setCursor(flatToPos(nf, clampNormal(nf, end)));
  };

  const openLine = (above: boolean) => {
    const block = currentBlock();
    const listTypes = ['bulletListItem', 'numberedListItem', 'checkListItem'];
    const type = listTypes.includes(block.type as string) ? block.type : 'paragraph';
    const [inserted] = editor.insertBlocks([{ type } as any], block, above ? 'before' : 'after');
    if (inserted) editor.setTextCursorPosition(inserted, 'start');
    enterInsert();
  };

  const searchWordUnderCursor = (backward: boolean) => {
    const f = buildFlat(view);
    const idx = posToFlat(f, view.state.selection.head);
    const { text, offset } = lineOf(f, idx);
    const range = textObject(text, offset, 'w', false);
    if (!range) return;
    const word = text.slice(range[0], range[1]).trim();
    if (word) doSearch(word, backward);
  };

  const doSearch = (query: string, backward: boolean, fromCursor = true) => {
    lastSearch = { query, backward };
    const f = buildFlat(view);
    const idx = fromCursor ? posToFlat(f, view.state.selection.head) : 0;
    const hit = searchText(f.text, query, idx, backward);
    if (!hit) {
      host.flash(`E486: Pattern not found: ${query}`, true);
      return;
    }
    const [at, wrapped] = hit;
    if (wrapped) host.flash(backward ? 'search hit TOP, continuing at BOTTOM' : 'search hit BOTTOM, continuing at TOP');
    setCursor(flatToPos(f, at));
  };

  const handleNormal = (e: KeyboardEvent): boolean => {
    const key = e.key;
    const ctrl = e.ctrlKey && !e.metaKey && !e.altKey;
    const f = buildFlat(view);
    const m = mode();
    const inVisual = m === 'visual' || m === 'visual-line';
    const idx = inVisual ? visualHead : posToFlat(f, view.state.selection.head);

    // --- pending single-char arguments ---
    if (pendingReplace) {
      pendingReplace = false;
      if (isPrintable(e)) replaceChars(key, Math.max(1, parseInt(count || '1', 10)), f, idx);
      resetPending();
      return true;
    }
    if (pendingFind) {
      const kind = pendingFind;
      pendingFind = null;
      if (!isPrintable(e)) {
        resetPending();
        return true;
      }
      lastFind = { ch: key, kind };
      const n = Math.max(1, parseInt(count || '1', 10));
      const { seg, text, offset } = lineOf(f, idx);
      const o = findInLine(text, offset, key, kind, n);
      if (o !== -1) moveOrOperate({ idx: seg.flat + o, inclusive: kind === 'f' || kind === 't' }, f, idx);
      else resetPending();
      return true;
    }
    if (pendingObject) {
      const around = pendingObject === 'a';
      pendingObject = null;
      const { seg, text, offset } = lineOf(f, idx);
      const range = textObject(text, offset, key, around);
      if (range && operator) {
        const op = operator;
        applyOperator(op, seg.flat + range[0], seg.flat + range[1], false, f);
        if (op !== 'c') resetPending();
      } else if (range && inVisual) {
        visualAnchor = seg.flat + range[0];
        visualHead = seg.flat + Math.max(range[0], range[1] - 1);
        showVisual();
        resetPending();
      } else resetPending();
      return true;
    }

    // --- counts ---
    if (/^[1-9]$/.test(key) || (key === '0' && count)) {
      count += key;
      host.setPending((operator ? `${opCount > 1 ? opCount : ''}${operator}` : '') + count);
      return true;
    }
    const n = Math.max(1, parseInt(count || '1', 10)) * (operator ? opCount : 1);

    // --- g prefix ---
    if (pendingG) {
      pendingG = false;
      if (key === 'g') return moveOrOperate(motion('gg', n, f, idx, !!operator), f, idx);
      if (key === 'J') {
        joinLines(n);
        resetPending();
        return true;
      }
      resetPending();
      return true;
    }

    if (ctrl) {
      if (key === 'r') {
        for (let k = 0; k < n; k++) editor.redo();
        resetPending();
        scheduleCursor();
        return true;
      }
      if (key === 'd' || key === 'u' || key === 'f' || key === 'b') {
        const lines = key === 'd' || key === 'u' ? 15 : 30;
        const down = key === 'd' || key === 'f';
        const pos = verticalMove(flatToPos(f, idx), down, lines);
        moveOrOperate({ idx: posToFlat(f, pos) }, f, idx);
        return true;
      }
      if (key === 'h') {
        host.focusExplorer();
        return true;
      }
      return false; // let Ctrl-c, Ctrl-v, etc. through
    }

    // --- visual-mode operators ---
    if (inVisual && handleVisualOp(key, f)) return true;
    if (inVisual && (key === 'i' || key === 'a')) {
      pendingObject = key;
      return true;
    }

    // --- operator-pending ---
    if (operator) {
      if (key === operator || (operator === '>' && key === '>') || (operator === '<' && key === '<')) {
        // dd, yy, cc, >>, <<
        const blocks = blocksFromCursor(n);
        const first = blocks[0];
        const lastBlock = blocks[blocks.length - 1];
        if (first && lastBlock) {
          const op = operator;
          if (op === 'y') yankBlocks(blocks);
          else if (op === 'd') deleteBlocks(blocks);
          else if (op === 'c') {
            register = { kind: 'blocks', blocks: blocks.map(stripIds) };
            if (blocks.length > 1) editor.removeBlocks(blocks.slice(1));
            editor.updateBlock(first, { content: [] } as any);
            editor.setTextCursorPosition(first, 'start');
            enterInsert();
            return true;
          } else {
            for (const blk of blocks) {
              editor.setTextCursorPosition(blk, 'start');
              if (op === '>' && editor.canNestBlock()) editor.nestBlock();
              if (op === '<' && editor.canUnnestBlock()) editor.unnestBlock();
            }
          }
        }
        resetPending();
        scheduleCursor();
        return true;
      }
      if (key === 'i' || key === 'a') {
        pendingObject = key;
        host.setPending(`${operator}${key}`);
        return true;
      }
      if (key === 'g') {
        pendingG = true;
        return true;
      }
      if (key === 'f' || key === 'F' || key === 't' || key === 'T') {
        pendingFind = key;
        return true;
      }
      if (isMotionKey(key)) {
        // `cw` acts like `ce` on a word, as in vim.
        const effective = operator === 'c' && (key === 'w' || key === 'W') && /\S/.test(f.text[idx] ?? '') ? (key === 'w' ? 'e' : 'E') : key;
        return moveOrOperate(motion(effective, n, f, idx, true), f, idx);
      }
      resetPending();
      return true;
    }

    // --- motions ---
    if (isMotionKey(key) && !(key === 'Enter' && inVisual)) {
      return moveOrOperate(motion(key, n, f, idx, false), f, idx);
    }

    switch (key) {
      case 'g':
        pendingG = true;
        host.setPending(`${count}g`);
        return true;
      case 'f':
      case 'F':
      case 't':
      case 'T':
        pendingFind = key;
        host.setPending(`${count}${key}`);
        return true;
      case 'd':
      case 'c':
      case 'y':
      case '>':
      case '<':
        operator = key;
        opCount = Math.max(1, parseInt(count || '1', 10));
        count = '';
        host.setPending(`${opCount > 1 ? opCount : ''}${key}`);
        return true;
      case 'D':
      case 'C':
      case 'Y': {
        if (key === 'Y') {
          yankBlocks(blocksFromCursor(n));
          resetPending();
          return true;
        }
        const { seg } = lineOf(f, idx);
        const from = flatToPos(f, idx);
        deleteRange(from, seg.start + seg.len);
        if (key === 'C') enterInsert(from);
        else {
          const nf = buildFlat(view);
          setCursor(flatToPos(nf, clampNormal(nf, posToFlat(nf, from))));
          resetPending();
        }
        return true;
      }
      case 'S': {
        operator = 'c';
        opCount = 1;
        return handleNormal(new KeyboardEvent('keydown', { key: 'c' }));
      }
      case 's': {
        const { seg } = lineOf(f, idx);
        const from = flatToPos(f, idx);
        deleteRange(from, Math.min(seg.start + seg.len, from + n));
        enterInsert(from);
        return true;
      }
      case 'x':
      case 'Delete': {
        const { seg } = lineOf(f, idx);
        const from = flatToPos(f, idx);
        deleteRange(from, Math.min(seg.start + seg.len, from + n));
        const nf = buildFlat(view);
        setCursor(flatToPos(nf, clampNormal(nf, posToFlat(nf, from))));
        resetPending();
        return true;
      }
      case 'X': {
        const { seg } = lineOf(f, idx);
        const from = flatToPos(f, Math.max(seg.flat, idx - n));
        deleteRange(from, flatToPos(f, idx));
        setCursor(from);
        resetPending();
        return true;
      }
      case 'r':
        pendingReplace = true;
        host.setPending(`${count}r`);
        return true;
      case '~':
        toggleCase(n, f, idx);
        resetPending();
        return true;
      case 'J':
        joinLines(Math.max(1, n - (count ? 1 : 0)));
        resetPending();
        return true;
      case 'p':
      case 'P':
        for (let k = 0; k < n; k++) put(key === 'P');
        resetPending();
        return true;
      case 'u':
        for (let k = 0; k < n; k++) editor.undo();
        resetPending();
        scheduleCursor();
        return true;
      case 'i':
        enterInsert(flatToPos(f, idx));
        return true;
      case 'a': {
        const { seg } = lineOf(f, idx);
        enterInsert(Math.min(seg.start + seg.len, flatToPos(f, idx) + (seg.len ? 1 : 0)));
        return true;
      }
      case 'I': {
        const { seg, text } = lineOf(f, idx);
        enterInsert(seg.start + firstNonBlank(text));
        return true;
      }
      case 'A': {
        const { seg } = lineOf(f, idx);
        enterInsert(seg.start + seg.len);
        return true;
      }
      case 'o':
      case 'O':
        openLine(key === 'O');
        return true;
      case 'v':
        if (m === 'visual') enterNormal();
        else if (m === 'visual-line') {
          host.setMode('visual');
          showVisual();
        } else enterVisual(false);
        return true;
      case 'V':
        if (m === 'visual-line') enterNormal();
        else if (m === 'visual') {
          host.setMode('visual-line');
          showVisual();
        } else enterVisual(true);
        return true;
      case 'n':
      case 'N':
        if (lastSearch) {
          for (let k = 0; k < n; k++) doSearch(lastSearch.query, key === 'N' ? !lastSearch.backward : lastSearch.backward);
          // keep the original direction for future n/N
        } else host.flash('E35: No previous regular expression', true);
        resetPending();
        return true;
      case '*':
      case '#':
        searchWordUnderCursor(key === '#');
        resetPending();
        return true;
      case '/':
      case '?':
        resetPending();
        host.commandLine(key);
        return true;
      case ':':
        resetPending();
        host.commandLine(':');
        return true;
      case ' ':
        resetPending();
        host.leader();
        return true;
      case 'Escape':
        if (inVisual) enterNormal();
        resetPending();
        return true;
    }
    // Swallow everything else that would type text.
    if (isPrintable(e) || key === 'Tab' || key === 'Enter') {
      resetPending();
      return true;
    }
    return false;
  };

  /** Apply a motion: move the cursor, extend visual selection, or run the pending operator. */
  const moveOrOperate = (res: MotionResult | null, f: Flat, idx: number): boolean => {
    if (!res) {
      resetPending();
      return true;
    }
    const m = mode();
    if (operator) {
      const op = operator;
      let to = res.idx;
      let from = idx;
      if (!res.linewise) {
        if (to < from) [from, to] = [to, from];
        if (res.inclusive) to += 1;
      }
      applyOperator(op, from, to, !!res.linewise, f);
      if (op !== 'c') resetPending();
      return true;
    }
    if (m === 'visual' || m === 'visual-line') {
      visualHead = Math.max(0, Math.min(f.text.length ? f.text.length - 1 : 0, res.idx));
      showVisual();
      resetPending();
      return true;
    }
    setCursor(flatToPos(f, clampNormal(f, res.idx)));
    resetPending();
    return true;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== dom && !dom.contains(e.target as Node)) return;
    if (e.isComposing || e.metaKey) return;
    const m = mode();

    if (m === 'insert') {
      const isEsc = e.key === 'Escape' || (e.ctrlKey && e.key === '[');
      if (!isEsc) return;
      // Let BlockNote close its own menus first.
      if (document.querySelector('.bn-suggestion-menu, .bn-grid-suggestion-menu')) return;
      e.preventDefault();
      e.stopPropagation();
      enterNormal();
      return;
    }

    if (e.altKey) return;
    const handled = handleNormal(e);
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onFocus = () => {
    if (mode() === 'explorer') host.setMode('normal');
    scheduleCursor();
  };
  const onBlur = () => scheduleCursor();
  const onMouseUp = () => {
    const m = mode();
    if (m === 'visual' || m === 'visual-line') {
      // A mouse click leaves visual mode, like in vim.
      host.setMode('normal');
      resetPending();
    }
    scheduleCursor();
  };

  document.addEventListener('keydown', onKeyDown, true);
  dom.addEventListener('focus', onFocus);
  dom.addEventListener('blur', onBlur);
  dom.addEventListener('mouseup', onMouseUp);
  window.addEventListener('scroll', scheduleCursor, true);
  window.addEventListener('resize', scheduleCursor);
  // Layout shifts (sidebar pin/unpin, panel resize) move text without scrolling.
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleCursor) : null;
  resizeObserver?.observe(dom);
  const offSelection = editor.onSelectionChange(() => scheduleCursor());
  const offChange = editor.onChange(() => scheduleCursor());
  scheduleCursor();

  return {
    detach() {
      document.removeEventListener('keydown', onKeyDown, true);
      dom.removeEventListener('focus', onFocus);
      dom.removeEventListener('blur', onBlur);
      dom.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('scroll', scheduleCursor, true);
      window.removeEventListener('resize', scheduleCursor);
      resizeObserver?.disconnect();
      offSelection?.();
      offChange?.();
      document.body.classList.remove('vim-visual-active');
      if (rafId) cancelAnimationFrame(rafId);
      dom.classList.remove('vim-caret-hidden');
      cursorEl.remove();
    },
    search(query, backward) {
      editor.focus();
      doSearch(query, backward);
    },
    gotoLine(line) {
      const f = buildFlat(view);
      const seg = f.segs[Math.min(f.segs.length, Math.max(1, line)) - 1];
      editor.focus();
      if (seg) setCursor(seg.start);
    },
    enterNormal() {
      if (mode() !== 'normal') enterNormal();
      scheduleCursor();
    },
  };
}
