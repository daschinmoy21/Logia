import { expect, type Page } from '@playwright/test';

export async function openAgentWorkspace(page: Page) {
  await page.addInitScript(() => {
    const now = '2026-11-02T12:00:00Z';
    localStorage.setItem('logia.browser-workspace.v1', JSON.stringify({ folders: [], notes: [{
      id: 'agent-note', title: 'Agent collaboration', note_type: 'text', starred: false,
      created_at: now, updated_at: now, content: JSON.stringify([
        { id: 'agent-title', type: 'heading', props: { level: 1 }, content: 'Agent collaboration', children: [] },
        { id: 'agent-body', type: 'paragraph', props: {}, content: 'Keep notes local. Share context deliberately. #logia', children: [] },
      ]),
    }] }));
  });
  await page.goto('/');
  await page.getByRole('list', { name: 'Notes', exact: true }).getByRole('button', { name: /^Agent collaboration / }).click();
  await expect(page.locator('[data-note-editor="agent-note"]')).toBeVisible();
}

/** Simulates only the native IPC boundary. Never runs an agent or handles real credentials. */
export async function installAgentFixture(page: Page) {
  await page.evaluate(() => {
    const win = window as any;
    let counter = 0;
    const channels = new Map<string, any>();
    win.__agentCalls = [];
    win.__agentStartDelay = 25;
    win.__agentFailStart = false;
    win.__agentEarlyError = false;
    win.__agentFailWrite = false;
    win.__agentEmit = (id: string, event: any) => channels.get(id)?.onmessage(event);
    win.__TAURI_INTERNALS__ = {
      transformCallback: () => ++counter,
      unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        win.__agentCalls.push({ command, args: command === 'agent_terminal_start' ? { options: args.options } : args });
        if (command === 'ai_cli_detect') return ['codex', 'claude-code', 'pi', 'opencode'].map(id => ({ id, binary: id, available: true, path: `/fixture/bin/${id}` }));
        if (command === 'agent_terminal_start') {
          if (win.__agentFailStart) throw new Error('Fixture: executable could not be started');
          const id = `fixture-${++counter}`;
          channels.set(id, args.onEvent);
          const bytes = Array.from(new TextEncoder().encode('Fixture PTY — early output π\r\n'));
          args.onEvent.onmessage({ kind: 'data', data: bytes.slice(0, bytes.length - 3) });
          args.onEvent.onmessage({ kind: 'data', data: bytes.slice(bytes.length - 3) });
          if (win.__agentEarlyError) args.onEvent.onmessage({ kind: 'error', message: 'Fixture early channel error' });
          await new Promise(resolve => setTimeout(resolve, win.__agentStartDelay));
          return { id, cwd: `/fixture/agent-sessions/${id}` };
        }
        if (command === 'agent_terminal_close') { channels.get(args.id)?.onmessage({ kind: 'exit', code: 1 }); return; }
        if (command === 'agent_terminal_write' && win.__agentFailWrite) throw new Error('Fixture broken terminal input');
        if (command === 'agent_terminal_write' || command === 'agent_terminal_resize') return;
        throw new Error(`Unexpected fixture IPC: ${command}`);
      },
    };
  });
}

export async function agentCalls(page: Page) {
  return page.evaluate(() => (window as any).__agentCalls as Array<{ command: string; args: any }>);
}
