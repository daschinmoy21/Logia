import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { GitBranch, Globe, Loader2, Square } from 'lucide-react';
import { countWordsInNoteContent, footerSaveLabel } from '../../lib/note-utils';
import { formatTime } from '../../lib/utils';
import { useNotesStore } from '../../store/notesStore';
import { useSettingsStore } from '../../store/settingsStore';
import useUiStore from '../../store/UiStore';
import { useVimStore, type VimMode } from '../../store/vimStore';
import { Tip } from '../ui/kit';
import { stopRecording } from './recording';

const MODE_LABEL: Record<VimMode, string> = {
  normal: 'NORMAL',
  insert: 'INSERT',
  visual: 'VISUAL',
  'visual-line': 'V-LINE',
  explorer: 'EXPLORER',
};

const MODE_TONE: Record<VimMode, string> = {
  normal: 'text-blue-300',
  insert: 'text-emerald-300',
  visual: 'text-amber-300',
  'visual-line': 'text-amber-300',
  explorer: 'text-violet-300',
};

const statusButton = 'flex h-full items-center gap-1.5 px-2 hover:bg-white/[0.06] hover:text-zinc-200';

function VimStatus() {
  const vimEnabled = useSettingsStore((s) => s.vimEnabled);
  const setVimEnabled = useSettingsStore((s) => s.setVimEnabled);
  const mode = useVimStore((s) => s.mode);
  const pending = useVimStore((s) => s.pending);
  const commandOpen = useVimStore((s) => !!s.commandLine);

  if (!vimEnabled) {
    return (
      <Tip label="Enable vim mode" side="top">
        <button type="button" onClick={() => setVimEnabled(true)} aria-label="Enable vim mode" className={`${statusButton} font-mono`}>
          VIM
        </button>
      </Tip>
    );
  }

  const label = commandOpen ? 'COMMAND' : MODE_LABEL[mode];
  return (
    <>
      {pending && <span className="px-1 font-mono text-zinc-400">{pending}</span>}
      <Tip label="Click for keybindings, right-click to turn off" side="top">
        <button
          type="button"
          onClick={() => useUiStore.getState().setIsSettingsOpen(true, 'editor')}
          onContextMenu={(event) => {
            event.preventDefault();
            setVimEnabled(false);
          }}
          aria-label={`Vim mode: ${label}`}
          className={`${statusButton} font-mono font-medium ${commandOpen ? 'text-zinc-200' : MODE_TONE[mode]}`}
        >
          {label}
        </button>
      </Tip>
    </>
  );
}

function RecordingStatus() {
  const isRecording = useUiStore((s) => s.isRecording);
  const isProcessing = useUiStore((s) => s.isProcessingRecording);
  const startedAt = useUiStore((s) => s.recordingStartTime);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isRecording || !startedAt) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [isRecording, startedAt]);

  if (isProcessing) {
    return (
      <span className="flex items-center gap-1.5 px-2 text-zinc-300">
        <Loader2 size={11} className="animate-spin" /> Transcribing…
      </span>
    );
  }
  if (!isRecording) return null;
  return (
    <button type="button" onClick={() => void stopRecording()} aria-label="Stop recording" className={`${statusButton} text-red-300`}>
      <span className="size-1.5 rounded-full bg-red-400 motion-safe:animate-pulse" aria-hidden="true" />
      <span className="tabular-nums">{formatTime(elapsed)}</span>
      <Square size={9} className="fill-current" aria-hidden="true" />
    </button>
  );
}

function NoteStatus() {
  // Word counts parse the note, so they only run for what's actually shown.
  const content = useNotesStore((s) => (s.currentNote?.note_type === 'canvas' ? null : s.currentNote?.content ?? null));
  const pending = useNotesStore((s) => !!s.saveTimeout || s.isSaving);
  const saveError = useNotesStore((s) => s.saveError);
  if (content === null) return null;
  const words = countWordsInNoteContent(content);
  const label = saveError ? 'Not saved' : footerSaveLabel(!pending);

  return (
    <>
      {saveError && (
        <button
          type="button"
          onClick={() => void useNotesStore.getState().saveCurrentNote().catch(() => {})}
          className={`${statusButton} text-zinc-200 underline underline-offset-2`}
          title={saveError}
        >
          Retry
        </button>
      )}
      <span
        aria-live="polite"
        data-testid="footer-save-status"
        className={`px-2 ${saveError ? 'text-red-300' : pending ? 'text-amber-300/90' : ''}`}
      >
        {label}
      </span>
      <span className="px-2 tabular-nums">{words.toLocaleString()} {words === 1 ? 'word' : 'words'}</span>
    </>
  );
}

export function StatusBar() {
  const gitSyncConfigured = useUiStore((s) => s.gitSyncConfigured);
  const isSyncing = useUiStore((s) => s.isSyncing);
  const lastSyncedAt = useUiStore((s) => s.lastSyncedAt);
  const uiScale = useSettingsStore((s) => s.uiScale);
  const browser = !isTauri();

  return (
    <footer className="flex h-[26px] flex-shrink-0 items-stretch justify-between overflow-hidden border-t border-zinc-800 bg-zinc-925 font-mono text-[11px] text-zinc-500">
      <div className="flex min-w-0 items-stretch">
        {browser && (
          <Tip label="Notes are kept only in this browser. Trash, audio capture, tasks, Git sync and saved AI keys need the desktop app." side="top">
            <span className="flex items-center gap-1.5 px-2 text-amber-200/80" role="img" aria-label="Browser workspace: notes are kept only in this browser">
              <Globe size={11} aria-hidden="true" />
              <span className="hidden whitespace-nowrap sm:inline">Browser workspace</span>
            </span>
          </Tip>
        )}
        {gitSyncConfigured && (
          <button type="button" onClick={() => useUiStore.getState().setIsSettingsOpen(true, 'sync')} className={statusButton}>
            <GitBranch size={11} aria-hidden="true" className={isSyncing ? 'motion-safe:animate-pulse' : ''} />
            <span className="whitespace-nowrap">
              {isSyncing ? 'Syncing…' : lastSyncedAt ? `Synced ${lastSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Not synced'}
            </span>
          </button>
        )}
        <RecordingStatus />
      </div>
      <div className="flex flex-shrink-0 items-stretch whitespace-nowrap">
        <span className="flex items-center"><NoteStatus /></span>
        {uiScale !== 1 && (
          <button type="button" onClick={() => useSettingsStore.getState().setUiScale(1)} title="Reset zoom" className={`${statusButton} tabular-nums`}>
            {Math.round(uiScale * 100)}%
          </button>
        )}
        <VimStatus />
      </div>
    </footer>
  );
}
