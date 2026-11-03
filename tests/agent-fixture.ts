import { expect, type Page } from '@playwright/test';

export async function openAgentWorkspace(page: Page) {
  await page.addInitScript(() => {
    const now = '2026-11-02T12:00:00Z';
    if (!localStorage.getItem('logia.browser-workspace.v1')) localStorage.setItem('logia.browser-workspace.v1', JSON.stringify({ folders: [], notes: [{
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
    const callbacks = new Map<number, (event: any) => void>();
    const listeners = new Map<number, number>();
    win.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_event: string, id: number) => { callbacks.delete(listeners.get(id)!); listeners.delete(id); } };
    const chatReplies = new Map<string, (text: string) => void>();
    win.__agentCompleteChat = (id: string, text: string) => { chatReplies.get(id)?.(text); chatReplies.delete(id); };
    win.__agentChatChunk = (id: string, data: string) => {
      for (const callback of callbacks.values()) callback({ event: 'ai-cli-event', id: 0, payload: { request_id: id, kind: 'chunk', data } });
    };
    win.__agentCalls = [];
    win.__agentStartDelay = 25;
    win.__agentFailStart = false;
    win.__agentEarlyError = false;
    win.__agentFailWrite = false;
    win.__agentEmit = (id: string, event: any) => channels.get(id)?.onmessage(event);
    win.__TAURI_INTERNALS__ = {
      metadata: { currentWebview: { label: 'main' }, currentWindow: { label: 'main' } },
      transformCallback: (callback: (event: any) => void) => { const id = ++counter; callbacks.set(id, callback); return id; },
      unregisterCallback: (id: number) => { callbacks.delete(id); },
      invoke: async (command: string, args: any) => {
        win.__agentCalls.push({ command, args: command === 'agent_terminal_start' ? { options: args.options } : args });
        if (command === 'ai_cli_detect') return (win.__agentInstalledTools ?? ['codex', 'claude-code', 'pi', 'opencode']).map((id: string) => ({ id, binary: id, available: true, path: `/fixture/bin/${id}` }));
        if (command === 'ai_cli_models') {
          if (win.__agentModelError) throw new Error('Fixture: model discovery unavailable');
          return win.__agentModels?.[args.tool] ?? [{ id: 'fixture-model', label: 'Fixture Model', isDefault: true, reasoningEfforts: ['low', 'medium', 'high'] }, { id: 'provider/second-model', label: 'Second Model' }];
        }
        if (command === 'plugin:webview|set_webview_zoom') return;
        if (command === 'plugin:event|listen') { const id = ++counter; listeners.set(id, args.handler); return id; }
        if (command === 'plugin:event|unlisten') return;
        if (command === 'ai_cli_run') {
          if (win.__agentHoldChat) return new Promise<string>((resolve) => chatReplies.set(args.requestId, resolve));
          return 'Fixture chat reply';
        }
        if (command === 'ai_cli_cancel') return true;
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
