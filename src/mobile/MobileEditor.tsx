import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BlockNoteView } from '@blocknote/mantine';
import { SuggestionMenuController, getDefaultReactSlashMenuItems } from '@blocknote/react';
import { filterSuggestionItems, type BlockNoteEditor } from '@blocknote/core';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import {
  ArrowLeft,
  Bold,
  Check,
  Copy,
  EllipsisVertical,
  Heading,
  Italic,
  KeyboardOff,
  List,
  ListChecks,
  ListOrdered,
  Redo2,
  Share2,
  Star,
  StarOff,
  Trash2,
  Undo2,
  PenTool,
} from 'lucide-react';
import { EditorProvider, useEditorContext } from '../components/EditorProvider';
import { useNotesStore } from '../store/notesStore';
import type { Note } from '../types/Note';
import { cn } from '../lib/utils';
import { editedLabel } from './format';
import { deleteWithUndo, describeError, toggleFavorite } from './noteActions';
import { IconTap, OverflowMenu } from './ui';
import { showSnackbar } from './snackbar';

type Editor = BlockNoteEditor<any, any, any>;

/** Slash items that need a mouse, a desktop, or a picker that doesn't fit a phone. */
const HIDDEN_SLASH_ITEMS = new Set(['emoji', 'video', 'audio', 'file', 'toggle_heading', 'toggle_heading_2', 'toggle_heading_3']);

function SaveState() {
  const pending = useNotesStore((s) => !!s.saveTimeout || s.isSaving);
  const error = useNotesStore((s) => s.saveError);
  if (error) {
    return (
      <button
        type="button"
        onClick={() => void useNotesStore.getState().saveCurrentNote().catch(() => {})}
        className="m-press h-9 rounded-full px-2.5 text-[13px] font-semibold text-m-danger"
        aria-label={`Not saved: ${error}. Tap to retry.`}
      >
        Not saved
      </button>
    );
  }
  return (
    <span role="status" className="flex items-center gap-1 px-1 text-[13px] text-m-faint" aria-live="polite">
      {pending ? 'Saving…' : <><Check size={14} aria-hidden="true" />Saved</>}
    </span>
  );
}

type ToolState = { bold: boolean; italic: boolean; type: string; level?: number };

function readTools(editor: Editor): ToolState {
  const styles = editor.getActiveStyles() as Record<string, unknown>;
  const block = editor.getTextCursorPosition().block;
  return {
    bold: !!styles.bold,
    italic: !!styles.italic,
    type: block.type,
    level: (block.props as { level?: number }).level,
  };
}

function ToolButton({ label, active, onPress, children }: { label: string; active?: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      aria-pressed={active}
      // Keep focus (and the keyboard) in the editor.
      onMouseDown={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.pointerType !== 'mouse') event.preventDefault();
      }}
      onClick={onPress}
      className={cn(
        'flex h-11 min-w-10 max-w-[52px] flex-1 items-center justify-center rounded-xl transition-colors duration-100 motion-reduce:transition-none',
        active ? 'bg-m-accent-soft text-m-accent' : 'text-m-text active:bg-m-press',
      )}
    >
      {children}
    </button>
  );
}

/** Formatting for thumbs, pinned to the top of the keyboard while the editor has focus. */
function KeyboardToolbar({ editor, onHide }: { editor: Editor; onHide: () => void }) {
  const [tools, setTools] = useState<ToolState>(() => readTools(editor));

  useEffect(() => {
    const update = () => setTools(readTools(editor));
    const offSelection = editor.onSelectionChange(update);
    const offChange = editor.onChange(update);
    return () => {
      offSelection?.();
      offChange?.();
    };
  }, [editor]);

  const refocus = () => {
    if (!editor.isFocused()) editor.focus();
  };

  const selectedBlocks = () => editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];

  const setBlockType = (type: string, props: Record<string, unknown> = {}) => {
    const blocks = selectedBlocks();
    const first = blocks[0];
    const same = first.type === type && (type !== 'heading' || (first.props as { level?: number }).level === props.level);
    for (const block of blocks) {
      editor.updateBlock(block, same ? { type: 'paragraph', props: {} } : ({ type, props } as any));
    }
    refocus();
    setTools(readTools(editor));
  };

  const cycleHeading = () => {
    // Paragraph → H2 → H3 → paragraph. The title stays an H1 by default.
    if (tools.type !== 'heading') return setBlockType('heading', { level: 2 });
    if (tools.level === 2) return setBlockType('heading', { level: 3 });
    setBlockType('paragraph');
  };

  const toggleStyle = (style: 'bold' | 'italic') => {
    editor.toggleStyles({ [style]: true } as any);
    refocus();
    setTools(readTools(editor));
  };

  const headingLabel = tools.type === 'heading' ? `Heading ${tools.level ?? 1}` : 'Heading';

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="m-chrome flex flex-shrink-0 items-center border-t border-m-line bg-m-surface pl-[var(--m-safe-left)] pr-[var(--m-safe-right)]"
      style={{ paddingBottom: 'max(0px, calc(var(--m-safe-bottom) - var(--m-kb, 0px)))' }}
    >
      <div className="flex h-[52px] min-w-0 flex-1 items-center justify-between overflow-x-auto px-1">
        <ToolButton label="Undo" onPress={() => { editor.undo(); refocus(); }}><Undo2 size={20} /></ToolButton>
        <ToolButton label="Redo" onPress={() => { editor.redo(); refocus(); }}><Redo2 size={20} /></ToolButton>
        <span className="mx-0.5 h-6 w-px flex-shrink-0 bg-m-line" aria-hidden="true" />
        <ToolButton label={headingLabel} active={tools.type === 'heading'} onPress={cycleHeading}>
          <span className="flex items-baseline">
            <Heading size={19} />
            {tools.type === 'heading' && <span className="-ml-0.5 text-[11px] font-bold">{tools.level ?? 1}</span>}
          </span>
        </ToolButton>
        <ToolButton label="Bold" active={tools.bold} onPress={() => toggleStyle('bold')}><Bold size={19} /></ToolButton>
        <ToolButton label="Italic" active={tools.italic} onPress={() => toggleStyle('italic')}><Italic size={19} /></ToolButton>
        <ToolButton label="Bulleted list" active={tools.type === 'bulletListItem'} onPress={() => setBlockType('bulletListItem')}><List size={20} /></ToolButton>
        <ToolButton label="Numbered list" active={tools.type === 'numberedListItem'} onPress={() => setBlockType('numberedListItem')}><ListOrdered size={20} /></ToolButton>
        <ToolButton label="Checklist" active={tools.type === 'checkListItem'} onPress={() => setBlockType('checkListItem')}><ListChecks size={20} /></ToolButton>
      </div>
      <span className="h-6 w-px flex-shrink-0 bg-m-line" aria-hidden="true" />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Hide keyboard"
        onClick={onHide}
        className="m-press mx-1.5 flex size-11 flex-shrink-0 items-center justify-center rounded-xl text-m-muted"
      >
        <KeyboardOff size={20} />
      </button>
    </div>
  );
}

function EditorScreen({ note, theme, onBack }: { note: Note; theme: 'light' | 'dark'; onBack: () => void }) {
  const { editor } = useEditorContext() as { editor: Editor };
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const starred = useNotesStore((s) => (s.currentNote?.id === note.id ? !!s.currentNote.starred : !!note.starred));

  /** Keep the caret clear of the top bar and of the keyboard toolbar. */
  const revealCaret = useCallback(() => {
    const scroller = scrollRef.current;
    const selection = window.getSelection();
    if (!scroller || !selection?.rangeCount || !scroller.contains(selection.focusNode)) return;
    let rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.height) {
      const node = selection.focusNode;
      const element = node instanceof Element ? node : node?.parentElement;
      if (!element) return;
      rect = element.getBoundingClientRect();
    }
    const box = scroller.getBoundingClientRect();
    const bottom = box.bottom - 20;
    const top = box.top + 12;
    if (rect.bottom > bottom) scroller.scrollTop += rect.bottom - bottom;
    else if (rect.top < top) scroller.scrollTop -= top - rect.top;
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      // Wait for the shell to take its new height.
      frame = requestAnimationFrame(() => requestAnimationFrame(revealCaret));
    };
    vv?.addEventListener('resize', onResize);
    window.addEventListener('resize', onResize);
    const offSelection = editor.onSelectionChange(() => {
      if (editor.isFocused()) requestAnimationFrame(revealCaret);
    });
    return () => {
      cancelAnimationFrame(frame);
      vv?.removeEventListener('resize', onResize);
      window.removeEventListener('resize', onResize);
      offSelection?.();
    };
  }, [editor, revealCaret]);

  // Typing straight away: a new note opens with the cursor on its title.
  useEffect(() => {
    const first = editor.document[0];
    const firstText = Array.isArray(first?.content) ? first.content.map((c: any) => c.text ?? '').join('') : '';
    const fresh = editor.document.length <= 2 && !firstText && Date.now() - Date.parse(note.created_at) < 10_000;
    if (!fresh) return;
    const timer = window.setTimeout(() => {
      editor.setTextCursorPosition(first, 'end');
      editor.focus();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [editor, note.created_at]);

  const focusEnd = () => {
    const last = editor.document[editor.document.length - 1];
    if (last) editor.setTextCursorPosition(last, 'end');
    editor.focus();
  };

  const hideKeyboard = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  };

  const share = async () => {
    try {
      const markdown = await editor.blocksToMarkdownLossy(editor.document);
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: note.title, text: markdown });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return;
        }
      }
      await navigator.clipboard.writeText(markdown);
      showSnackbar('Copied as Markdown');
    } catch (error) {
      showSnackbar(`Couldn't share: ${describeError(error)}`);
    }
  };

  const canShare = typeof navigator.share === 'function';

  return (
    <div
      className="flex h-full flex-col bg-m-bg"
      data-mobile-editor={note.id}
      onFocusCapture={(event) => {
        if ((event.target as HTMLElement).closest('.bn-editor')) setFocused(true);
      }}
      onBlurCapture={(event) => {
        const next = event.relatedTarget as HTMLElement | null;
        if (!next?.closest('.bn-editor')) setFocused(false);
      }}
    >
      <header
        className={cn(
          'm-chrome relative z-10 flex flex-shrink-0 items-center gap-1 bg-m-bg pl-[calc(4px+var(--m-safe-left))] pr-[calc(4px+var(--m-safe-right))] pt-(--m-safe-top) transition-[box-shadow] duration-200',
          scrolled && 'shadow-[0_1px_0_var(--m-line)]',
        )}
      >
        <div className="flex h-14 w-full items-center gap-0.5">
          <IconTap label="Back to notes" onClick={onBack}><ArrowLeft size={23} /></IconTap>
          <span
            aria-hidden="true"
            className={cn('min-w-0 flex-1 truncate px-1 text-[17px] font-semibold transition-opacity duration-200', scrolled ? 'opacity-100' : 'opacity-0')}
          >
            {note.title && note.title !== 'Untitled' ? note.title : ''}
          </span>
          <SaveState />
          <IconTap
            label={starred ? 'Remove from favorites' : 'Add to favorites'}
            pressed={starred}
            onClick={() => void toggleFavorite(note)}
            className={starred ? 'text-m-star' : undefined}
          >
            <Star size={21} className={starred ? 'fill-current' : undefined} />
          </IconTap>
          <IconTap label="More options" onClick={() => setMenuOpen(true)}><EllipsisVertical size={21} /></IconTap>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="m-scroll min-h-0 flex-1"
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 56)}
      >
        <p className="m-chrome px-[calc(20px+var(--m-safe-left))] pb-2 pt-1 text-[13px] text-m-faint">
          {note.updated_at === note.created_at ? 'New note' : editedLabel(note.updated_at)}
        </p>
        <BlockNoteView
          editor={editor}
          theme={theme}
          className="m-editor-view"
          sideMenu={false}
          formattingToolbar={false}
          slashMenu={false}
          emojiPicker={false}
          tableHandles={false}
        >
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) =>
              filterSuggestionItems(
                getDefaultReactSlashMenuItems(editor).filter((item) => !HIDDEN_SLASH_ITEMS.has((item as { key?: string }).key ?? '')),
                query,
              )
            }
          />
        </BlockNoteView>
        {/* Tapping below the text continues it. Also leaves room to scroll the end above the keyboard. */}
        <div className="min-h-[45vh]" onClick={focusEnd} aria-hidden="true" />
      </div>

      {focused && <KeyboardToolbar editor={editor} onHide={hideKeyboard} />}

      <OverflowMenu
        open={menuOpen}
        label="Note options"
        onClose={() => setMenuOpen(false)}
        actions={[
          {
            label: starred ? 'Remove from favorites' : 'Add to favorites',
            icon: starred ? <StarOff size={20} /> : <Star size={20} />,
            onSelect: () => void toggleFavorite(note),
          },
          { label: canShare ? 'Share' : 'Copy as Markdown', icon: canShare ? <Share2 size={20} /> : <Copy size={20} />, onSelect: () => void share() },
          { label: 'Delete', icon: <Trash2 size={20} />, danger: true, onSelect: () => void deleteWithUndo(note) },
        ]}
      />
    </div>
  );
}

function CanvasPlaceholder({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex h-full flex-col bg-m-bg">
      <header className="m-chrome flex flex-shrink-0 items-center pl-[calc(4px+var(--m-safe-left))] pt-(--m-safe-top)">
        <div className="flex h-14 items-center">
          <IconTap label="Back to notes" onClick={onBack}><ArrowLeft size={23} /></IconTap>
        </div>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-10 pb-20 text-center">
        <PenTool size={34} strokeWidth={1.6} className="text-m-faint" aria-hidden="true" />
        <p className="mt-4 text-[17px] font-semibold">Canvases open on the desktop</p>
        <p className="mt-1.5 text-[15px] leading-relaxed text-m-muted">Sketching needs more room than a phone screen. Your canvas is safe and unchanged.</p>
      </div>
    </div>
  );
}

export function MobileEditor({ note, theme, onBack }: { note: Note; theme: 'light' | 'dark'; onBack: () => void }) {
  const updateCurrentNoteContent = useNotesStore((s) => s.updateCurrentNoteContent);
  const updateCurrentNoteTitle = useNotesStore((s) => s.updateCurrentNoteTitle);
  if (note.note_type === 'canvas') return <CanvasPlaceholder onBack={onBack} />;
  return (
    <EditorProvider
      variant="mobile"
      currentNote={note}
      aiModel={null}
      updateCurrentNoteContent={updateCurrentNoteContent}
      updateCurrentNoteTitle={updateCurrentNoteTitle}
    >
      <EditorScreen note={note} theme={theme} onBack={onBack} />
    </EditorProvider>
  );
}
