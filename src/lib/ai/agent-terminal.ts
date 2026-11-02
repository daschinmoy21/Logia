import { Channel, invoke } from '@tauri-apps/api/core';

export type AgentTool = 'codex' | 'claude-code' | 'pi' | 'opencode';
export type AgentTerminalEvent =
  | { kind: 'data'; data: number[] }
  | { kind: 'exit'; code: number }
  | { kind: 'error'; message: string };

export const AGENT_TOOLS = [
  { id: 'codex', label: 'Codex', binary: 'codex', loginHint: 'Sign in with a device code using your ChatGPT account.', installUrl: 'https://developers.openai.com/codex/cli/' },
  { id: 'claude-code', label: 'Claude Code', binary: 'claude', loginHint: 'Sign in through Claude Code’s browser login.', installUrl: 'https://code.claude.com/docs/en/setup' },
  { id: 'pi', label: 'Pi', binary: 'pi', loginHint: 'Run /login in Pi to choose a provider and sign in.', installUrl: 'https://pi.dev' },
  { id: 'opencode', label: 'OpenCode', binary: 'opencode', loginHint: 'Choose a provider in OpenCode’s login flow.', installUrl: 'https://opencode.ai/docs/' },
] as const;

export function isDesktopAgentHost(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function startAgentTerminal(options: {
  tool: AgentTool; binary?: string; cols: number; rows: number; login?: boolean;
  context?: { title: string; markdown: string };
}, onEvent: (event: AgentTerminalEvent) => void): Promise<{ id: string; cwd: string }> {
  if (!isDesktopAgentHost()) throw new Error('Agent terminals require the Logia desktop app.');
  const channel = new Channel<AgentTerminalEvent>();
  channel.onmessage = onEvent;
  return invoke('agent_terminal_start', { options, onEvent: channel });
}

// Keep rapid keystrokes and multi-part pastes in order across asynchronous IPC.
const writes = new Map<string, { tail: Promise<void>; closed: boolean }>();
export function writeAgentTerminal(id: string, data: string): Promise<void> {
  let queue = writes.get(id);
  if (!queue) { queue = { tail: Promise.resolve(), closed: false }; writes.set(id, queue); }
  const entry = queue;
  const next = entry.tail.catch(() => {}).then(async () => {
    if (entry.closed) throw new Error('Agent session has ended.');
    await invoke('agent_terminal_write', { id, data });
  });
  entry.tail = next;
  void next.then(() => {
    if (writes.get(id) === entry && entry.tail === next) writes.delete(id);
  }, () => {
    if (writes.get(id) === entry && entry.tail === next) writes.delete(id);
  });
  return next;
}

export async function resizeAgentTerminal(id: string, cols: number, rows: number): Promise<void> {
  await invoke('agent_terminal_resize', { id, cols, rows });
}

export async function closeAgentTerminal(id: string): Promise<void> {
  const pending = writes.get(id);
  if (pending) { pending.closed = true; writes.delete(id); }
  await invoke('agent_terminal_close', { id });
}
