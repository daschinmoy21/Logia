import { memo, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2, LogIn, PencilLine, Play, RefreshCw, Settings2, Square } from 'lucide-react';
import { AGENT_TOOLS, isDesktopAgentHost, type AgentTool } from '../../lib/ai/agent-terminal';
import { noteToMarkdown } from '../../lib/note-markdown';
import { openExternal } from '../../lib/utils';
import { useNotesStore } from '../../store/notesStore';
import { useSettingsStore } from '../../store/settingsStore';
import useUiStore from '../../store/UiStore';
import { AgentComposer } from './AgentComposer';
import { ProviderIcon } from '../ProviderIcon';
import { ModelPicker } from '../ModelPicker';
import {
  AVAILABILITY_LABELS,
  agentAvailability,
  attachAgentSession,
  dismissAgentSession,
  isLiveSession,
  refreshAgentDetection,
  scheduleAgentFit,
  sendAgentPrompt,
  startAgentSession,
  stopAgentSession,
  useAgentSessions,
  type AgentSessionView,
} from './agentSessions';

function statusText(session: AgentSessionView): string {
  switch (session.status) {
    case 'starting':
      return 'Starting…';
    case 'running':
      return session.login ? 'Sign-in running' : 'Running';
    case 'stopped':
      return 'Stopped';
    case 'exited':
      return `Exited (code ${session.exitCode})`;
    case 'error':
      return 'Error';
  }
}

/** One external agent: its start screen, or its live terminal once explicitly started. */
export const AgentTerminalPane = memo(function AgentTerminalPane({ tool }: { tool: AgentTool }) {
  const def = AGENT_TOOLS.find((t) => t.id === tool)!;
  const session = useAgentSessions((s) => s.sessions[tool]);
  const hasTerminal = !!session?.hasTerminal;
  const live = isLiveSession(session);
  const containerRef = useRef<HTMLDivElement>(null);
  const [composerOpen, setComposerOpen] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasTerminal) return;
    const detach = attachAgentSession(tool, container);
    const observer = new ResizeObserver(() => scheduleAgentFit(tool));
    observer.observe(container);
    return () => {
      observer.disconnect();
      detach();
    };
  }, [tool, hasTerminal]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {session && hasTerminal && (
        <div className="border-b border-zinc-900 px-3 py-1.5">
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`size-1.5 flex-shrink-0 rounded-full ${
                session.status === 'running'
                  ? 'bg-emerald-400'
                  : session.status === 'starting'
                    ? 'bg-amber-400 animate-pulse'
                    : session.status === 'error'
                      ? 'bg-red-400'
                      : 'bg-zinc-600'
              }`}
            />
            <span className="min-w-0 flex-1 truncate text-zinc-300" role="status">
              {def.label} · {statusText(session)}
            </span>
            {live && !session.login && (
              <button
                type="button"
                onClick={() => setComposerOpen((o) => !o)}
                aria-pressed={composerOpen}
                title={composerOpen ? 'Hide the prompt composer' : 'Show the prompt composer'}
                aria-label={composerOpen ? 'Hide the prompt composer' : 'Show the prompt composer'}
                className={`rounded p-1 transition-colors hover:bg-zinc-900 ${composerOpen ? 'text-blue-300' : 'text-zinc-500'}`}
              >
                <PencilLine size={13} />
              </button>
            )}
            {live ? (
              <button
                type="button"
                onClick={() => void stopAgentSession(tool)}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 px-2 py-0.5 text-zinc-300 transition-colors hover:border-red-500/50 hover:text-red-300"
              >
                <Square size={9} className="fill-current" /> Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => dismissAgentSession(tool)}
                className="rounded-md border border-zinc-800 px-2 py-0.5 text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
              >
                New session
              </button>
            )}
          </div>
          {session.cwd && (
            <p className="mt-1 truncate font-mono text-[10px] text-zinc-500" title={session.cwd}>
              Folder: {session.cwd}
            </p>
          )}
          {!session.login && <p className="truncate text-[11px] text-zinc-400" title={session.model ?? undefined}>Model at start: {session.model || 'CLI default'} · Change models in the CLI with /model{tool === 'opencode' ? 's' : ''}.</p>}
          <p className="truncate text-[10px] text-zinc-500">
            {session.snapshotTitle
              ? `Snapshot of “${session.snapshotTitle}” in note-context.md. Edits don't sync either way.`
              : 'No note attached.'}
          </p>
          {live && <p className="truncate text-[10px] text-zinc-600">Ctrl+H/L moves between panes · Ctrl+J/K cycles · Ctrl+Shift+L hides this panel.</p>}
          {session.error && (
            <p role="alert" className="mt-1 text-xs text-red-300">
              {session.error}
            </p>
          )}
          {session.status === 'exited' && session.login && (
            <p className="mt-1 text-[11px] text-zinc-400">
              Sign-in ended. Logia can't see the result, so start a session to check it.
            </p>
          )}
        </div>
      )}

      <div className="relative isolate min-h-0 flex-1 bg-zinc-950 p-1.5">
        {/* xterm mounts here; it needs a measurable box before the start screen goes away. */}
        <div
          ref={containerRef}
          role="group"
          aria-label={`${def.label} terminal`}
          className="h-full w-full overflow-hidden"
          data-testid="agent-terminal"
        />
        {!hasTerminal && <AgentStartScreen tool={tool} containerRef={containerRef} />}
      </div>

      {session?.status === 'running' && !session.login && composerOpen && (
        <AgentComposer
          draftKey={`agent:${tool}`}
          label={`Prompt for ${def.label}`}
          placeholder={`Compose a prompt for ${def.label}…`}
          sendLabel={`Send to ${def.label}`}
          onSend={(text) => sendAgentPrompt(tool, text)}
        />
      )}
    </div>
  );
});

function AgentStartScreen({ tool, containerRef }: { tool: AgentTool; containerRef: React.RefObject<HTMLDivElement | null> }) {
  const def = AGENT_TOOLS.find((t) => t.id === tool)!;
  const session = useAgentSessions((s) => s.sessions[tool]);
  const detecting = useAgentSessions((s) => s.detecting);
  const info = useSettingsStore((s) => s.cliStatus[tool]);
  const binary = useSettingsStore((s) => s.cliBinaries[tool]);
  const noteTitle = useNotesStore((s) => s.currentNote?.title);
  const noteId = useNotesStore((s) => s.currentNote?.id);
  const isCanvas = useNotesStore((s) => s.currentNote?.note_type === 'canvas');
  const [attach, setAttach] = useState(false);

  const desktop = isDesktopAgentHost();
  const availability = agentAvailability(info, detecting);
  const canAttach = !!noteId && !isCanvas;
  const starting = session?.status === 'starting';
  const canLaunch = desktop && availability !== 'missing' && !starting;

  useEffect(() => {
    void refreshAgentDetection();
  }, []);

  const start = (login: boolean) => {
    const container = containerRef.current;
    if (!container) return;
    // Read the note only now: the snapshot is a one-off, not a subscription to its body.
    const note = useNotesStore.getState().currentNote;
    const context =
      !login && attach && canAttach && note
        ? { title: note.title || 'Untitled', markdown: noteToMarkdown(note.content) }
        : undefined;
    const model = useSettingsStore.getState().models[tool]?.trim() || undefined;
    void startAgentSession(tool, { container, binary: binary?.trim() || undefined, model: login ? undefined : model, login, context });
  };

  return (
    <div className="absolute inset-0 overflow-y-auto bg-zinc-950 p-4">
      <div className="flex items-center gap-2">
        <ProviderIcon providerId={tool} size={22} />
        <h3 className="flex-1 truncate text-sm font-semibold text-zinc-100">{def.label}</h3>
        <span
          data-testid="agent-availability"
          className={`rounded px-1.5 py-0.5 text-[11px] ${
            availability === 'installed'
              ? 'bg-emerald-500/10 text-emerald-300'
              : availability === 'missing'
                ? 'bg-amber-500/10 text-amber-300'
                : 'bg-zinc-800 text-zinc-400'
          }`}
        >
          {AVAILABILITY_LABELS[availability]}
        </span>
      </div>

      {!desktop && (
        <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400">
          Terminal sessions only work in the Logia desktop app. Logia chat still works here.
        </p>
      )}
      {info?.available && info.path && (
        <p className="mt-2 truncate font-mono text-[11px] text-zinc-500" title={info.path}>
          {info.path}
        </p>
      )}
      {availability === 'missing' && (
        <p className="mt-2 text-xs text-zinc-400">
          <code className="rounded bg-zinc-800 px-1 text-zinc-300">{info?.binary ?? def.binary}</code> isn't on your PATH.
          Install it, or set its path in settings.
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-2 text-xs text-zinc-500">
        <span>Session model</span><ModelPicker providerId={tool} disabled={starting} placement="below" />
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          disabled={!canLaunch}
          onClick={() => start(false)}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          {starting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {starting ? 'Starting…' : 'Start session'}
        </button>
        <button
          type="button"
          disabled={!canLaunch}
          onClick={() => start(true)}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 disabled:text-zinc-600 disabled:hover:border-zinc-800"
        >
          <LogIn size={14} /> Sign in
        </button>
        <p className="text-xs text-zinc-500">
          {def.loginHint} {def.label} keeps its own credentials; Sign-in is managed by the CLI.
        </p>
      </div>

      <label className={`mt-4 flex items-start gap-2 text-xs ${canAttach ? 'text-zinc-300' : 'text-zinc-600'}`}>
        <input
          type="checkbox"
          checked={attach && canAttach}
          disabled={!canAttach}
          onChange={(e) => setAttach(e.target.checked)}
          className="mt-0.5"
        />
        <span className="min-w-0">
          {canAttach ? (
            <>
              Attach “<span className="break-words">{noteTitle || 'Untitled'}</span>” as{' '}
              <code className="text-zinc-400">note-context.md</code>
            </>
          ) : isCanvas ? (
            "Canvas notes can't be attached"
          ) : (
            'Open a note to attach it'
          )}
        </span>
      </label>
      <p className="mt-2 text-xs text-zinc-500">
        Sessions run in a separate scratch folder, not your vault. An attached note is a copy taken at start. This isn't a
        sandbox: the CLI keeps its own permissions. Use logia-cli to read and edit live notes through the running app.
      </p>

      {session?.status === 'error' && session.error && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          <span className="min-w-0 break-words">{session.error}</span>
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
        <button
          type="button"
          disabled={!desktop}
          onClick={() => void refreshAgentDetection()}
          className="inline-flex items-center gap-1 transition-colors hover:text-zinc-200 disabled:text-zinc-600"
        >
          <RefreshCw size={11} className={detecting ? 'animate-spin' : ''} /> Refresh
        </button>
        <button
          type="button"
          onClick={() => useUiStore.getState().setIsSettingsOpen(true, 'ai')}
          className="inline-flex items-center gap-1 transition-colors hover:text-zinc-200"
        >
          <Settings2 size={11} /> Binary path
        </button>
        <button
          type="button"
          onClick={() => void openExternal(def.installUrl)}
          className="inline-flex items-center gap-1 transition-colors hover:text-zinc-200"
        >
          <ExternalLink size={11} /> Install guide
        </button>
      </div>
    </div>
  );
}
