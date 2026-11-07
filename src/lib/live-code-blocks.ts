import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { BlockNoteExtension } from '@blocknote/core';
import { isTauri, convertFileSrc } from '@tauri-apps/api/core';
import { codeBlock } from '@blocknote/code-block';

/**
 * Code blocks whose language is `mermaid` or `artifact` render live below their
 * source. The note still stores a plain code block, so Markdown export keeps the
 * fenced source and other apps see ordinary code.
 */
export const LIVE_LANGUAGES = ['mermaid', 'artifact'] as const;
type LiveLanguage = (typeof LIVE_LANGUAGES)[number];

const isLive = (language: unknown): language is LiveLanguage => LIVE_LANGUAGES.includes(language as LiveLanguage);

/** BlockNote code block settings with an `artifact` language highlighted as HTML. */
export const logiaCodeBlock = {
  ...codeBlock,
  supportedLanguages: {
    ...codeBlock.supportedLanguages,
    artifact: { name: 'Artifact (HTML)', aliases: ['artifact'] },
  },
  createHighlighter: async () => {
    const highlighter = await codeBlock.createHighlighter!();
    const { default: html } = await import('@shikijs/langs-precompiled/html');
    await highlighter.loadLanguage(...html.map((lang: any) => lang.name === 'html' ? { ...lang, aliases: [...(lang.aliases || []), 'artifact'] } : lang));
    return highlighter;
  },
};

// ---------------------------------------------------------------------------
// Mermaid

let mermaidReady: Promise<typeof import('mermaid').default> | null = null;
let mermaidQueue: Promise<unknown> = Promise.resolve();
let mermaidCount = 0;

function loadMermaid() {
  mermaidReady ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
      fontFamily: 'inherit',
      themeVariables: { background: 'transparent' },
    });
    return mermaid;
  });
  return mermaidReady;
}

/** Mermaid keeps global render state, so renders run one at a time. */
function renderMermaid(source: string): Promise<string> {
  const run = mermaidQueue.then(async () => {
    const mermaid = await loadMermaid();
    // Parse first so a syntax error throws here instead of leaving an error SVG in <body>.
    await mermaid.parse(source);
    const { svg } = await mermaid.render(`logia-mermaid-${++mermaidCount}`, source);
    return svg;
  });
  mermaidQueue = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------
// Diagram viewer: full-window pan and zoom for a rendered Mermaid SVG.

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

/** Opens a modal viewer. Wheel or +/- zooms, drag pans, 0 fits, Esc closes. */
export function openDiagramViewer(svg: SVGSVGElement, title = 'Diagram') {
  const opener = document.activeElement as HTMLElement | null;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  // Mermaid sizes its SVG to the column; give the clone its natural size instead.
  const box = clone.viewBox.baseVal;
  const rect = svg.getBoundingClientRect();
  const width = box?.width || rect.width || 800;
  const height = box?.height || rect.height || 600;
  clone.removeAttribute('style');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));

  const overlay = document.createElement('div');
  overlay.className = 'logia-diagram-viewer';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', title);
  overlay.tabIndex = -1;

  const bar = document.createElement('div');
  bar.className = 'logia-diagram-viewer-bar';
  const label = document.createElement('span');
  label.textContent = title;
  const level = document.createElement('span');
  level.className = 'logia-diagram-viewer-level';
  const button = (text: string, name: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.setAttribute('aria-label', name);
    b.title = name;
    b.addEventListener('click', onClick);
    return b;
  };

  const stage = document.createElement('div');
  stage.className = 'logia-diagram-viewer-stage';
  const canvas = document.createElement('div');
  canvas.className = 'logia-diagram-viewer-canvas';
  canvas.append(clone);
  stage.append(canvas);

  let scale = 1, x = 0, y = 0;
  const apply = () => {
    canvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    level.textContent = `${Math.round(scale * 100)}%`;
  };
  const zoomAt = (next: number, cx = stage.clientWidth / 2, cy = stage.clientHeight / 2) => {
    next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    // Keep the point under the cursor fixed.
    x = cx - ((cx - x) * next) / scale;
    y = cy - ((cy - y) * next) / scale;
    scale = next;
    apply();
  };
  const fit = () => {
    const pad = 32;
    scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((stage.clientWidth - pad) / width, (stage.clientHeight - pad) / height)));
    x = (stage.clientWidth - width * scale) / 2;
    y = (stage.clientHeight - height * scale) / 2;
    apply();
  };

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    opener?.focus?.({ preventScroll: true });
  };
  const onKey = (event: KeyboardEvent) => {
    const handled = event.key === 'Escape' ? (close(), true)
      : event.key === '+' || event.key === '=' ? (zoomAt(scale * 1.25), true)
      : event.key === '-' ? (zoomAt(scale / 1.25), true)
      : event.key === '0' ? (fit(), true)
      : false;
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  };

  bar.append(
    label, level,
    button('−', 'Zoom out', () => zoomAt(scale / 1.25)),
    button('+', 'Zoom in', () => zoomAt(scale * 1.25)),
    button('Fit', 'Fit to window', fit),
    button('100%', 'Actual size', () => zoomAt(1)),
    button('Close', 'Close viewer', close),
  );

  stage.addEventListener('wheel', (event) => {
    event.preventDefault();
    const r = stage.getBoundingClientRect();
    // Trackpad pinch arrives as ctrl+wheel with small deltas; scale either the same way.
    zoomAt(scale * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015)), event.clientX - r.left, event.clientY - r.top);
  }, { passive: false });

  let drag: { id: number; px: number; py: number } | null = null;
  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    drag = { id: event.pointerId, px: event.clientX, py: event.clientY };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('is-dragging');
  });
  stage.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    x += event.clientX - drag.px;
    y += event.clientY - drag.py;
    drag.px = event.clientX;
    drag.py = event.clientY;
    apply();
  });
  const endDrag = () => { drag = null; stage.classList.remove('is-dragging'); };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('dblclick', fit);

  overlay.append(bar, stage);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey, true);
  overlay.focus({ preventScroll: true });
  fit();
  return close;
}

// ---------------------------------------------------------------------------
// Artifacts

const ARTIFACT_SCHEME = 'logia-artifact';
const MAX_ARTIFACT_HEIGHT = 900;

/** Reports the document height to the parent so the frame can fit its content. */
const sizeReporter = (token: string) => `<script>(()=>{const post=()=>parent.postMessage({logiaArtifact:${JSON.stringify(token)},height:Math.ceil(document.documentElement.scrollHeight)},'*');addEventListener('load',post);try{new ResizeObserver(post).observe(document.documentElement)}catch{}post()})()</script>`;

const artifactBase = `<style>:root{color-scheme:dark}html,body{margin:0;background:transparent;color:#e4e4e7;font:14px/1.5 system-ui,sans-serif}</style>`;

function artifactDocument(source: string, token: string) {
  return artifactBase + source + sizeReporter(token);
}

// While anything is dragged, artifact frames ignore the pointer. Otherwise a drag
// that passes over a frame enters its separate document, the editor never sees
// drop/dragend, and WebKitGTK stays stuck mid-drag, swallowing clicks and scrolls.
const DRAGGING_CLASS = 'logia-dragging';
let dragGuard = false;

function installDragGuard() {
  if (dragGuard || typeof window === 'undefined') return;
  dragGuard = true;
  const root = document.documentElement;
  const start = () => root.classList.add(DRAGGING_CLASS);
  const end = () => root.classList.remove(DRAGGING_CLASS);
  window.addEventListener('dragstart', start, true);
  for (const type of ['dragend', 'drop'] as const) window.addEventListener(type, end, true);
  // Fallback if a drag ends without reporting it: any later pointer input ends it.
  window.addEventListener('pointerdown', end, true);
  window.addEventListener('mousemove', (event) => { if (event.buttons === 0) end(); }, true);
}

// ---------------------------------------------------------------------------
// Artifact trust: an artifact runs on its own only if this user wrote or ran
// that exact source here. Anything else (written by an agent through logia-cli,
// synced, imported) waits for one click on Run.

const TRUST_KEY = 'logia.trusted-artifacts.v1';
const TRUST_LIMIT = 1000;
let trusted: string[] | null = null;

function trustedList() {
  if (trusted) return trusted;
  try {
    const value = JSON.parse(localStorage.getItem(TRUST_KEY) || '[]');
    trusted = Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
  } catch {
    trusted = [];
  }
  return trusted;
}

async function artifactHash(source: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function isArtifactTrusted(source: string) {
  return trustedList().includes(await artifactHash(source));
}

/** Marks this exact source as safe to run automatically. */
export async function trustArtifact(source: string) {
  const hash = await artifactHash(source);
  const list = [hash, ...trustedList().filter((h) => h !== hash)].slice(0, TRUST_LIMIT);
  trusted = list;
  try {
    localStorage.setItem(TRUST_KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable: trust lasts for this run.
  }
}

// Frames exist only near the viewport, so a note full of artifacts costs only
// what's on screen, and off-screen animations stop.
const visibilityCallbacks = new WeakMap<Element, (visible: boolean) => void>();
const observers = new Map<Element | null, IntersectionObserver>();

/** The note scrolls inside its own container; a margin only works on that root. */
function scrollParent(el: Element): Element | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

function observeVisibility(el: Element, callback: (visible: boolean) => void) {
  const root = scrollParent(el);
  let observer = observers.get(root);
  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) visibilityCallbacks.get(entry.target)?.(entry.isIntersecting);
    }, { root, rootMargin: '300px 0px' });
    observers.set(root, observer);
  }
  visibilityCallbacks.set(el, callback);
  observer.observe(el);
  return () => {
    observer.unobserve(el);
    visibilityCallbacks.delete(el);
  };
}

// ---------------------------------------------------------------------------
// Preview views

type PreviewCallbacks = { edit: () => void; done: () => void };

class LivePreview {
  readonly dom: HTMLElement;
  private body: HTMLElement;
  private status: HTMLElement;
  private toggle: HTMLButtonElement;
  private source: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private onMessage: ((event: MessageEvent) => void) | null = null;
  private generation = 0;
  // Artifacts only
  private visible = false;
  private trusted = false;
  private rendered: string | null = null;
  private lastHeight = 120;
  private unobserve: (() => void) | null = null;
  private destroyed = false;
  editing = false;

  constructor(readonly language: LiveLanguage, private callbacks: PreviewCallbacks) {
    this.dom = document.createElement('div');
    this.dom.className = 'logia-live-preview';
    this.dom.dataset.language = language;
    this.dom.contentEditable = 'false';

    const bar = document.createElement('div');
    bar.className = 'logia-live-preview-bar';
    const label = document.createElement('span');
    label.textContent = language === 'mermaid' ? 'Mermaid' : 'Artifact';
    this.status = document.createElement('span');
    this.status.className = 'logia-live-preview-status';
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.textContent = 'Expand';
    expand.hidden = language !== 'mermaid';
    expand.addEventListener('mousedown', (event) => event.preventDefault());
    expand.addEventListener('click', () => this.expand());
    this.toggle = document.createElement('button');
    this.toggle.type = 'button';
    this.toggle.addEventListener('mousedown', (event) => event.preventDefault());
    this.toggle.addEventListener('click', () => (this.editing ? this.callbacks.done() : this.callbacks.edit()));
    bar.append(label, this.status, expand, this.toggle);

    this.body = document.createElement('div');
    this.body.className = 'logia-live-preview-body';
    // Clicking a rendered diagram opens it in the pan/zoom viewer.
    if (language === 'mermaid') this.body.addEventListener('click', () => this.expand());

    this.dom.append(bar, this.body);
    this.setEditing(false);
    if (language === 'artifact') this.watchVisibility();
  }

  /** Starts once the widget is in the document, so its scroll container is known. */
  private watchVisibility() {
    if (this.destroyed) return;
    if (!this.dom.isConnected) {
      requestAnimationFrame(() => this.watchVisibility());
      return;
    }
    this.unobserve = observeVisibility(this.dom, (visible) => {
      this.visible = visible;
      this.syncArtifact();
    });
  }

  private expand() {
    const svg = this.body.querySelector('svg');
    if (svg) openDiagramViewer(svg, 'Mermaid diagram');
  }

  setEditing(editing: boolean) {
    this.editing = editing;
    this.toggle.textContent = editing ? 'Done' : 'Edit source';
  }

  setSource(source: string) {
    if (source === this.source) return;
    const first = this.source === null;
    // Typing in the open source is the user writing it, so it may run.
    if (!first && this.editing && this.language === 'artifact') void trustArtifact(source);
    this.source = source;
    clearTimeout(this.timer);
    // Render at once on load; wait for a pause while typing.
    this.timer = setTimeout(() => void this.render(source), first ? 0 : 400);
  }

  private setStatus(text: string) {
    this.status.textContent = text;
    this.dom.classList.toggle('has-error', Boolean(text));
  }

  private async render(source: string) {
    const generation = ++this.generation;
    if (!source.trim()) {
      this.body.replaceChildren();
      this.setStatus('Empty');
      return;
    }
    if (this.language === 'mermaid') {
      try {
        const svg = await renderMermaid(source);
        if (generation !== this.generation) return;
        this.body.innerHTML = svg;
        this.setStatus('');
      } catch (error) {
        if (generation !== this.generation) return;
        // Keep the last good diagram visible while the source is mid-edit.
        this.setStatus(String((error as Error)?.message || error).split('\n')[0]);
      }
      return;
    }
    let trusted = false;
    try {
      trusted = await isArtifactTrusted(source);
    } catch {
      // No WebCrypto: never auto-run.
    }
    if (generation !== this.generation) return;
    this.trusted = trusted;
    this.syncArtifact();
  }

  /** Shows the frame, a Run prompt, or an off-screen placeholder for the current source. */
  private syncArtifact() {
    const source = this.source;
    if (this.language !== 'artifact' || source === null || !source.trim()) return;
    if (!this.trusted) {
      if (this.body.querySelector('.logia-artifact-gate')) return;
      this.unloadFrame();
      const gate = document.createElement('div');
      gate.className = 'logia-artifact-gate';
      const text = document.createElement('span');
      text.textContent = 'This artifact runs code that wasn\u2019t written here. Review the source, then run it.';
      const run = document.createElement('button');
      run.type = 'button';
      run.textContent = 'Run';
      run.addEventListener('mousedown', (event) => event.preventDefault());
      run.addEventListener('click', () => {
        const current = this.source;
        if (current === null) return;
        void trustArtifact(current).then(() => {
          if (this.source !== current) return;
          this.trusted = true;
          this.syncArtifact();
        });
      });
      gate.append(text, run);
      this.body.replaceChildren(gate);
      this.setStatus('Not run');
      return;
    }
    if (!this.visible) {
      this.unloadFrame();
      if (!this.body.querySelector('.logia-artifact-placeholder')) {
        const placeholder = document.createElement('div');
        placeholder.className = 'logia-artifact-placeholder';
        placeholder.style.height = `${this.lastHeight}px`;
        this.body.replaceChildren(placeholder);
      }
      this.setStatus('');
      return;
    }
    if (this.rendered === source && this.body.querySelector('iframe')) return;
    this.renderArtifact(source);
  }

  private unloadFrame() {
    this.disposeFrame();
    this.rendered = null;
  }

  private renderArtifact(source: string) {
    this.disposeFrame();
    this.rendered = source;
    const token = crypto.randomUUID();
    const frame = document.createElement('iframe');
    // No allow-same-origin: the artifact gets an opaque origin, so it can't reach
    // the app, its storage, or Tauri's IPC.
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.title = 'Artifact preview';
    frame.style.height = `${this.lastHeight}px`;
    const html = artifactDocument(source, token);

    this.onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.logiaArtifact !== token) return;
      const height = Number(event.data.height);
      if (!Number.isFinite(height)) return;
      this.lastHeight = Math.max(40, Math.min(MAX_ARTIFACT_HEIGHT, height));
      frame.style.height = `${this.lastHeight}px`;
    };
    window.addEventListener('message', this.onMessage);

    if (isTauri()) {
      // The app's CSP blocks inline scripts, and srcdoc frames inherit it. The
      // shell page comes from its own scheme with a CSP meant for artifacts.
      // Send the HTML on every load: moving the block re-attaches the frame,
      // which reloads the blank shell.
      frame.addEventListener('load', () => {
        frame.contentWindow?.postMessage({ type: 'logia-artifact-render', html }, '*');
      });
      frame.src = convertFileSrc('', ARTIFACT_SCHEME);
    } else {
      frame.srcdoc = html;
    }
    this.body.replaceChildren(frame);
    this.setStatus('');
  }

  private disposeFrame() {
    if (this.onMessage) window.removeEventListener('message', this.onMessage);
    this.onMessage = null;
  }

  destroy() {
    clearTimeout(this.timer);
    this.generation++;
    this.disposeFrame();
    this.unobserve?.();
    this.unobserve = null;
    this.destroyed = true;
  }
}

// ---------------------------------------------------------------------------
// ProseMirror plugin

type LiveBlock = { id: string; language: LiveLanguage; from: number; to: number; source: string; editing: boolean };
type LiveState = { focused: boolean; editing: string | null; decorations: DecorationSet };

const key = new PluginKey<LiveState>('logiaLiveCodeBlocks');

function findLiveBlocks(state: EditorState, editing: string | null): LiveBlock[] {
  const blocks: LiveBlock[] = [];
  state.doc.descendants((node, pos, parent) => {
    if (node.type.name !== 'codeBlock') return true;
    const language = node.attrs.language;
    if (isLive(language)) {
      const end = pos + node.nodeSize;
      const id = String(parent?.attrs.id ?? pos);
      blocks.push({ id, language, from: pos, to: end, source: node.textContent, editing: id === editing });
    }
    return false;
  });
  return blocks;
}

/**
 * ProseMirror can't map a point inside a preview widget to a document position,
 * so a block dropped on a preview lands above it (top half) or below it (bottom half).
 */
function dropOnPreview(view: EditorView, event: DragEvent) {
  const preview = (event.target as Element | null)?.closest?.('.logia-live-preview');
  const slice = view.dragging?.slice;
  if (!preview || !slice || !view.dom.contains(preview)) return false;
  const inside = view.posAtDOM(preview, 0);
  const block = findLiveBlocks(view.state, null).find((b) => inside >= b.from && inside <= b.to);
  if (!block) return false;
  const $code = view.state.doc.resolve(block.from);
  const rect = preview.getBoundingClientRect();
  const target = event.clientY < rect.top + rect.height / 2 ? $code.before() : $code.after();
  const tr = view.state.tr;
  if (view.dragging?.move) tr.deleteSelection();
  const pos = tr.mapping.map(target);
  tr.replaceRange(pos, pos, slice);
  const $inserted = tr.doc.resolve(tr.mapping.map(target, -1));
  if ($inserted.nodeAfter) tr.setSelection(NodeSelection.create(tr.doc, $inserted.pos));
  view.dispatch(tr.scrollIntoView());
  event.preventDefault();
  view.focus();
  return true;
}

const blockAtSelection = (state: EditorState) => {
  // Only a text cursor opens the source; selecting the whole block (e.g. after
  // dropping it) keeps it rendered.
  if (!(state.selection instanceof TextSelection)) return null;
  const { from, to } = state.selection;
  return findLiveBlocks(state, null).find((block) => from >= block.from && to <= block.to)?.id ?? null;
};

/**
 * Which block shows its source. A block opens when the cursor is moved into it
 * (arrow keys, Edit source) and closes when the cursor leaves or the editor blurs.
 * Swapping a note's content can also leave the cursor inside one; that doesn't open it.
 */
function nextEditing(tr: Transaction, old: LiveState, state: EditorState, focused: boolean) {
  if (!focused) return null;
  const inside = blockAtSelection(state);
  if (inside === old.editing) return inside;
  return inside && tr.selectionSet && !tr.docChanged ? inside : null;
}

function createPlugin() {
  const previews = new Map<string, LivePreview>();
  let view: EditorView | null = null;

  const editingId = (state: EditorState) => key.getState(state)?.editing ?? null;
  const blockById = (id: string) => (view ? findLiveBlocks(view.state, null).find((block) => block.id === id) : undefined);

  const edit = (id: string) => {
    const block = blockById(id);
    if (!view || !block) return;
    view.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, block.to - 1)).scrollIntoView());
  };

  const done = (id: string) => {
    const block = blockById(id);
    if (!view || !block) return;
    // The code block sits inside a blockContainer; step past it to the next block.
    const $after = view.state.doc.resolve(Math.min(view.state.doc.content.size, block.to + 1));
    const next = TextSelection.findFrom($after, 1, true);
    if (next && next.from > block.to) {
      view.dispatch(view.state.tr.setSelection(next).scrollIntoView());
      view.focus();
    } else {
      (view.dom as HTMLElement).blur();
    }
  };

  const previewFor = (block: LiveBlock, previewKey: string) => {
    let preview = previews.get(previewKey);
    if (!preview) {
      preview = new LivePreview(block.language, { edit: () => edit(block.id), done: () => done(block.id) });
      previews.set(previewKey, preview);
    }
    return preview;
  };

  const build = (state: EditorState, editing: string | null) => {
    const decos: Decoration[] = [];
    for (const block of findLiveBlocks(state, editing)) {
      const previewKey = `${block.language}:${block.id}`;
      decos.push(Decoration.node(block.from, block.to, { class: block.editing ? 'logia-live-editing' : 'logia-live-collapsed' }));
      decos.push(Decoration.widget(block.to, () => {
        const preview = previewFor(block, previewKey);
        preview.setEditing(block.editing);
        preview.setSource(block.source);
        return preview.dom;
      }, {
        key: previewKey,
        side: -1,
        ignoreSelection: true,
        // Keep clicks and keys inside the preview, but let block drags pass so
        // other blocks can be dropped above or below it.
        stopEvent: (event) => !(event.type.startsWith('drag') || event.type === 'drop'),
        // ProseMirror may hand this DOM to a replacement widget before destroying
        // the old one (e.g. when a note's blocks are replaced), so only clean up
        // once nothing shows it any more.
        destroy: () => {
          setTimeout(() => {
            const preview = previews.get(previewKey);
            if (preview && !preview.dom.isConnected) {
              preview.destroy();
              previews.delete(previewKey);
            }
          });
        },
      }));
    }
    return DecorationSet.create(state.doc, decos);
  };

  return new Plugin<LiveState>({
    key,
    state: {
      init: (_, state) => ({ focused: false, editing: null, decorations: build(state, null) }),
      apply: (tr, old, _, state) => {
        const meta = tr.getMeta(key) as { focused: boolean } | undefined;
        const focused = meta?.focused ?? old.focused;
        if (!tr.docChanged && !tr.selectionSet && focused === old.focused) return old;
        const editing = nextEditing(tr, old, state, focused);
        const decorations = tr.docChanged || editing !== old.editing ? build(state, editing) : old.decorations;
        return { focused, editing, decorations };
      },
    },
    props: {
      decorations: (state) => key.getState(state)?.decorations,
      handleDOMEvents: {
        focus: (v) => { v.dispatch(v.state.tr.setMeta(key, { focused: true })); return false; },
        blur: (v) => { v.dispatch(v.state.tr.setMeta(key, { focused: false })); return false; },
        drop: (v, event) => dropOnPreview(v, event as DragEvent),
      },
    },
    view: (editorView) => {
      view = editorView;
      if (editorView.hasFocus()) queueMicrotask(() => view?.dispatch(view.state.tr.setMeta(key, { focused: true })));
      return {
        // Widgets keep their DOM while their key is stable, so push new source here.
        update: (updated) => {
          for (const block of findLiveBlocks(updated.state, editingId(updated.state))) {
            const preview = previews.get(`${block.language}:${block.id}`);
            preview?.setEditing(block.editing);
            preview?.setSource(block.source);
          }
        },
        destroy: () => {
          if (view === editorView) view = null;
        },
      };
    },
  });
}

export class LiveCodeBlocksExtension extends BlockNoteExtension {
  static key() {
    return 'logiaLiveCodeBlocks';
  }

  constructor() {
    super();
    installDragGuard();
    this.addProsemirrorPlugin(createPlugin());
  }
}
