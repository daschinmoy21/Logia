import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { executeGuiCommand } from './gui.ts';
import type { GuiRequest } from './protocol.ts';

/** Register before advertising readiness; clean up on reload/unmount. */
export async function startDesktopCliBridge(): Promise<() => void> {
  if (!isTauri()) return () => {};
  let active = true;
  const unlisten = await listen<GuiRequest>('logia-cli-request', event => {
    if (!active) return;
    void executeGuiCommand(event.payload).then(response => invoke('cli_bridge_reply', { id: event.payload.id, response })).catch(error => console.error('CLI response failed:', error));
  });
  try { await invoke('cli_bridge_ready', { ready: true }); }
  catch (error) { unlisten(); throw error; }
  return () => { active = false; unlisten(); void invoke('cli_bridge_ready', { ready: false }).catch(() => {}); };
}
