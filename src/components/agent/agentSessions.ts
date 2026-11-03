import { create } from 'zustand';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import { isPaneNavigationKey } from '../../hooks/usePaneNavigation';
import { openExternal } from '../../lib/utils';
import { createHttpsLinkProvider, safeHttpsUrl } from '../../lib/ai/terminal-links';
import {
  closeAgentTerminal,
  isDesktopAgentHost,
  resizeAgentTerminal,
  startAgentTerminal,
  writeAgentTerminal,
  type AgentTerminalEvent,
  type AgentTool,
} from '../../lib/ai/agent-terminal';
import { useSettingsStore, type CliToolInfo } from '../../store/settingsStore';

export type AgentSessionStatus = 'starting' | 'running' | 'stopped' | 'exited' | 'error';

/** What the UI renders. Terminal output stays in xterm's memory, never in this store. */
export interface AgentSessionView {
  status: AgentSessionStatus;
  login: boolean;
  model: string | null;
  hasTerminal: boolean;
  cwd: string | null;
  snapshotTitle: string | null;
  exitCode: number | null;
  error: string | null;
}

export type AgentAvailability = 'desktop-only' | 'checking' | 'installed' | 'missing' | 'unknown';

export const AVAILABILITY_LABELS: Record<AgentAvailability, string> = {
  'desktop-only': 'Desktop only',
  checking: 'Checking…',
  installed: 'Installed',
  missing: 'Not found',
  unknown: 'Unknown',
};

export function agentAvailability(info: CliToolInfo | undefined, detecting: boolean): AgentAvailability {
  if (!isDesktopAgentHost()) return 'desktop-only';
  if (info) return info.available ? 'installed' : 'missing';
  return detecting ? 'checking' : 'unknown';
}

export const isLiveSession = (session: AgentSessionView | undefined) =>
  session?.status === 'starting' || session?.status === 'running';

interface AgentSessionsState {
  sessions: Partial<Record<AgentTool, AgentSessionView>>;
  detecting: boolean;
}

export const useAgentSessions = create<AgentSessionsState>(() => ({ sessions: {}, detecting: false }));

interface SessionHandle {
  host: HTMLDivElement | null;
  term: Terminal | null;
  fit: FitAddon | null;
  id: string | null;
  /** The process is gone or going; no more input, and late events don't change the status. */
  ended: boolean;
  stopRequested: boolean;
  closed: boolean;
  inputBeforeStart: string;
  writes: Promise<void>;
  fitTimer: ReturnType<typeof setTimeout> | undefined;
}

// One session per agent. These outlive the panel's DOM: closing the panel or
// picking another agent only detaches `host`, so the process and scrollback survive.
const handles = new Map<AgentTool, SessionHandle>();

const patchSession = (tool: AgentTool, patch: Partial<AgentSessionView>) =>
  useAgentSessions.setState((state) => {
    const current = state.sessions[tool];
    return current ? { sessions: { ...state.sessions, [tool]: { ...current, ...patch } } } : state;
  });

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function fitNow(handle: SessionHandle) {
  const { host, fit } = handle;
  // Mid-animation sizes would reflow the agent's TUI for nothing.
  if (!host?.isConnected || !fit || host.clientWidth < 80 || host.clientHeight < 40) return;
  try {
    fit.fit();
  } catch {
    // xterm can't measure until its renderer is ready; the next resize retries.
  }
}

function endHandle(tool: AgentTool, handle: SessionHandle, patch: Partial<AgentSessionView>) {
  handle.ended = true;
  if (handle.term) handle.term.options.disableStdin = true;
  patchSession(tool, patch);
}

/** Closes at most once per success; a failure clears `closed` so "New session" tries again. */
function closeQuietly(tool: AgentTool, handle: SessionHandle) {
  if (!handle.id || handle.closed) return;
  handle.closed = true;
  void closeAgentTerminal(handle.id).catch((error) => {
    handle.closed = false;
    if (handles.get(tool) === handle) patchSession(tool, { error: `Couldn't stop the session: ${errorText(error)}` });
  });
}

function sendInput(tool: AgentTool, handle: SessionHandle, data: string) {
  if (handle.ended) return;
  if (!handle.id) {
    handle.inputBeforeStart += data;
    return;
  }
  const { id } = handle;
  // Native commands run concurrently, so chain writes to keep keystrokes in order.
  handle.writes = handle.writes.then(() =>
    writeAgentTerminal(id, data).catch((error) => {
      // Stop closes the write queue, so a write rejected during Stop isn't a failure of its own.
      if (handles.get(tool) === handle && !handle.ended && !handle.stopRequested) {
        endHandle(tool, handle, { status: 'error', error: errorText(error) });
        closeQuietly(tool, handle);
      }
    }),
  );
}

function disposeHandle(tool: AgentTool) {
  const handle = handles.get(tool);
  if (!handle) return;
  handles.delete(tool);
  handle.ended = true;
  clearTimeout(handle.fitTimer);
  closeQuietly(tool, handle);
  handle.term?.dispose();
  handle.host?.remove();
}

/** Lets the App handle these; everything else belongs to the CLI. */
const isAppKey = (e: KeyboardEvent) =>
  isPaneNavigationKey(e) || e.metaKey || (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l');

/** Only ever runs from a click on a link; terminal output can't open anything by itself. */
function openTerminalLink(uri: string) {
  const url = safeHttpsUrl(uri);
  if (url) void openExternal(url);
}

function createTerminal(TerminalClass: typeof Terminal, FitAddonClass: typeof FitAddon, container: HTMLElement) {
  const host = document.createElement('div');
  host.className = 'h-full w-full';
  const term = new TerminalClass({
    cursorBlink: true,
    fontFamily: 'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
    fontSize: 12,
    lineHeight: 1.15,
    scrollback: 5000,
    // OSC 8 links can show one address and point at another, so the real target goes in the tooltip.
    linkHandler: {
      activate: (_event, uri) => openTerminalLink(uri),
      hover: (_event, uri) => {
        host.title = safeHttpsUrl(uri) ?? '';
      },
      leave: () => {
        host.title = '';
      },
    },
    theme: {
      background: '#1a1916',
      foreground: '#e6e2d9',
      cursor: '#e8743b',
      selectionBackground: "#4a3a2c",
    },
  });
  const fit = new FitAddonClass();
  term.loadAddon(fit);
  term.registerLinkProvider(createHttpsLinkProvider(term, openTerminalLink));

  // Pane keys are captured by the App. Other CLI keys stop here after xterm reads them.
  host.addEventListener('keydown', (e) => {
    if (!isAppKey(e)) e.stopPropagation();
  });
  container.appendChild(host);
  term.open(host);

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    if (isAppKey(e) && !e.metaKey) return false;
    if (e.ctrlKey && e.shiftKey && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 'c') {
        const selection = term.getSelection();
        if (selection) {
          e.preventDefault();
          void navigator.clipboard?.writeText(selection).catch(() => {});
        }
        return false;
      }
      if (key === 'v') {
        e.preventDefault();
        void navigator.clipboard
          ?.readText()
          .then((text) => text && term.paste(text))
          .catch(() => {});
        return false;
      }
    }
    return true;
  });

  return { term, fit, host };
}

export async function startAgentSession(
  tool: AgentTool,
  options: {
    container: HTMLElement;
    binary?: string;
    model?: string;
    login?: boolean;
    context?: { title: string; markdown: string };
  },
): Promise<void> {
  if (!isDesktopAgentHost() || isLiveSession(useAgentSessions.getState().sessions[tool])) return;
  const { container, binary, model, login = false, context } = options;

  disposeHandle(tool);
  const handle: SessionHandle = {
    host: null,
    term: null,
    fit: null,
    id: null,
    ended: false,
    stopRequested: false,
    closed: false,
    inputBeforeStart: '',
    writes: Promise.resolve(),
    fitTimer: undefined,
  };
  handles.set(tool, handle);
  useAgentSessions.setState((state) => ({
    sessions: {
      ...state.sessions,
      [tool]: {
        status: 'starting',
        login,
        model: login ? null : model ?? null,
        hasTerminal: false,
        cwd: null,
        snapshotTitle: context?.title ?? null,
        exitCode: null,
        error: null,
      },
    },
  }));

  try {
    const [{ Terminal: TerminalClass }, { FitAddon: FitAddonClass }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/xterm/css/xterm.css'),
    ]);
    if (handles.get(tool) !== handle || handle.stopRequested) return;

    const { term, fit, host } = createTerminal(TerminalClass, FitAddonClass, container);
    handle.term = term;
    handle.fit = fit;
    handle.host = host;
    patchSession(tool, { hasTerminal: true });
    fitNow(handle);
    term.focus();
    const { cols, rows } = term;

    term.onData((data) => sendInput(tool, handle, data));
    term.onResize((size) => {
      if (handle.id && !handle.ended) void resizeAgentTerminal(handle.id, size.cols, size.rows).catch(() => {});
    });

    // Events can arrive before the start promise resolves; the handlers only need `term`.
    const onEvent = (event: AgentTerminalEvent) => {
      if (handles.get(tool) !== handle) return;
      if (event.kind === 'data') {
        term.write(Uint8Array.from(event.data));
      } else if (handle.ended) {
        return;
      } else if (event.kind === 'exit') {
        endHandle(tool, handle, { status: handle.stopRequested ? 'stopped' : 'exited', exitCode: event.code });
      } else {
        endHandle(tool, handle, { status: 'error', error: event.message });
        closeQuietly(tool, handle);
      }
    };

    const { id, cwd } = await startAgentTerminal({ tool, binary, model: login ? undefined : model, cols, rows, login, context }, onEvent);
    handle.id = id;
    if (handles.get(tool) !== handle || handle.ended) {
      // Stopped, failed or disposed while the process was spawning; only now can it be closed.
      closeQuietly(tool, handle);
      if (handles.get(tool) === handle) patchSession(tool, { cwd });
      return;
    }
    patchSession(tool, { status: 'running', cwd });
    if (handle.inputBeforeStart) {
      sendInput(tool, handle, handle.inputBeforeStart);
      handle.inputBeforeStart = '';
    }
    if (term.cols !== cols || term.rows !== rows) void resizeAgentTerminal(id, term.cols, term.rows).catch(() => {});
  } catch (error) {
    if (handles.get(tool) !== handle) return;
    // Nothing ran, so go back to the start screen rather than show an empty terminal.
    const { stopRequested } = handle;
    disposeHandle(tool);
    patchSession(tool, stopRequested ? { status: 'stopped', hasTerminal: false } : { status: 'error', hasTerminal: false, error: errorText(error) });
  }
}

/** Ends the process but keeps the output on screen until the session is dismissed. */
export async function stopAgentSession(tool: AgentTool): Promise<void> {
  const handle = handles.get(tool);
  if (!handle || handle.ended || handle.stopRequested) return;
  handle.stopRequested = true;
  if (!handle.id) {
    // Still spawning: startAgentSession closes it as soon as it has an id.
    endHandle(tool, handle, { status: 'stopped' });
    return;
  }
  try {
    handle.closed = true;
    await closeAgentTerminal(handle.id);
    if (handles.get(tool) === handle && !handle.ended) endHandle(tool, handle, { status: 'stopped' });
  } catch (error) {
    handle.closed = false;
    handle.stopRequested = false;
    if (handles.get(tool) === handle) patchSession(tool, { error: `Couldn't stop the session: ${errorText(error)}` });
  }
}

/** Forgets a finished session and its output. */
export function dismissAgentSession(tool: AgentTool) {
  disposeHandle(tool);
  useAgentSessions.setState((state) => {
    const { [tool]: _gone, ...sessions } = state.sessions;
    return { sessions };
  });
}

/** Shows a session's terminal in `container`; returns the matching detach. */
export function attachAgentSession(tool: AgentTool, container: HTMLElement): () => void {
  const handle = handles.get(tool);
  if (!handle?.host || !handle.term) return () => {};
  const { host, term } = handle;
  // Re-appending in place would drop keyboard focus.
  if (host.parentElement !== container) container.appendChild(host);
  const frame = requestAnimationFrame(() => {
    fitNow(handle);
    term.refresh(0, term.rows - 1);
    if (!handle.ended) term.focus();
  });
  return () => {
    cancelAnimationFrame(frame);
    if (host.parentElement === container) host.remove();
  };
}

export function scheduleAgentFit(tool: AgentTool) {
  const handle = handles.get(tool);
  if (!handle) return;
  clearTimeout(handle.fitTimer);
  handle.fitTimer = setTimeout(() => fitNow(handle), 60);
}

/** Pastes a composed prompt into the CLI and submits it. */
export function sendAgentPrompt(tool: AgentTool, text: string): boolean {
  const handle = handles.get(tool);
  if (!handle?.term || !handle.id || handle.ended) return false;
  handle.term.paste(text);
  // TUIs treat an Enter glued to a paste as part of it, so give them a beat.
  setTimeout(() => sendInput(tool, handle, '\r'), 80);
  return true;
}

export function closeAllAgentSessions() {
  for (const tool of [...handles.keys()]) disposeHandle(tool);
  useAgentSessions.setState({ sessions: {} });
}

export async function refreshAgentDetection(): Promise<void> {
  if (!isDesktopAgentHost() || useAgentSessions.getState().detecting) return;
  useAgentSessions.setState({ detecting: true });
  try {
    await useSettingsStore.getState().refreshCliStatus();
  } finally {
    useAgentSessions.setState({ detecting: false });
  }
}
