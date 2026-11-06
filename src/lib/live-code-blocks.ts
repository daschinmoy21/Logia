import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
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
// Artifacts

const ARTIFACT_SCHEME = 'logia-artifact';
const MAX_ARTIFACT_HEIGHT = 900;

/** Reports the document height to the parent so the frame can fit its content. */
const sizeReporter = (token: string) => `<script>(()=>{const post=()=>parent.postMessage({logiaArtifact:${JSON.stringify(token)},height:Math.ceil(document.documentElement.scrollHeight)},'*');addEventListener('load',post);try{new ResizeObserver(post).observe(document.documentElement)}catch{}post()})()</script>`;

const artifactBase = `<style>:root{color-scheme:dark}html,body{margin:0;background:transparent;color:#e4e4e7;font:14px/1.5 system-ui,sans-serif}</style>`;

function artifactDocument(source: string, token: string) {
  return artifactBase + source + sizeReporter(token);
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
    this.toggle = document.createElement('button');
    this.toggle.type = 'button';
    this.toggle.addEventListener('mousedown', (event) => event.preventDefault());
    this.toggle.addEventListener('click', () => (this.editing ? this.callbacks.done() : this.callbacks.edit()));
    bar.append(label, this.status, this.toggle);

    this.body = document.createElement('div');
    this.body.className = 'logia-live-preview-body';
    // Clicking a rendered diagram opens its source, like clicking text would.
    if (language === 'mermaid') this.body.addEventListener('click', () => this.callbacks.edit());

    this.dom.append(bar, this.body);
    this.setEditing(false);
  }

  setEditing(editing: boolean) {
    this.editing = editing;
    this.toggle.textContent = editing ? 'Done' : 'Edit source';
  }

  setSource(source: string) {
    if (source === this.source) return;
    const first = this.source === null;
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
    this.renderArtifact(source);
  }

  private renderArtifact(source: string) {
    this.disposeFrame();
    const token = crypto.randomUUID();
    const frame = document.createElement('iframe');
    // No allow-same-origin: the artifact gets an opaque origin, so it can't reach
    // the app, its storage, or Tauri's IPC.
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.title = 'Artifact preview';
    frame.style.height = '120px';
    const html = artifactDocument(source, token);

    this.onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.logiaArtifact !== token) return;
      const height = Number(event.data.height);
      if (Number.isFinite(height)) frame.style.height = `${Math.max(40, Math.min(MAX_ARTIFACT_HEIGHT, height))}px`;
    };
    window.addEventListener('message', this.onMessage);

    if (isTauri()) {
      // The app's CSP blocks inline scripts, and srcdoc frames inherit it. The
      // shell page comes from its own scheme with a CSP meant for artifacts.
      let sent = false;
      frame.addEventListener('load', () => {
        if (sent) return;
        sent = true;
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

const blockAtSelection = (state: EditorState) => {
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
        stopEvent: () => true,
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
    this.addProsemirrorPlugin(createPlugin());
  }
}
