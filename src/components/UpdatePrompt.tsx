import { useEffect } from 'react';
import { Description, Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { isTauri } from '@tauri-apps/api/core';
import { Download, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from './ui/kit';
import { openExternal } from '../lib/utils';
import { useSettingsStore } from '../store/settingsStore';
import { RELEASES_URL, useUpdateStore } from '../store/updateStore';

/** Long enough that launch work settles first; checks then repeat while the app stays open. */
const FIRST_CHECK_MS = 8_000;
const RECHECK_MS = 6 * 60 * 60 * 1000;

const NIX_COMMAND = 'nix profile upgrade --all';

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Offers new releases: installs them in place where it can, or points to the download. */
export function UpdatePrompt() {
  const autoCheck = useSettingsStore((s) => s.autoCheckUpdates);
  const { status, update, installMode, downloaded, total, error, promptOpen, check, install, skip, dismiss } =
    useUpdateStore();

  useEffect(() => {
    if (!isTauri() || !autoCheck || import.meta.env.DEV) return;
    const first = window.setTimeout(() => void check(), FIRST_CHECK_MS);
    const repeat = window.setInterval(() => void check(), RECHECK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(repeat);
    };
  }, [autoCheck, check]);

  if (!update) return null;

  const busy = status === 'downloading' || status === 'installing';
  const percent = total ? Math.min(100, Math.round((downloaded / total) * 100)) : null;
  const notes = update.body?.trim();

  return (
    <Dialog open={promptOpen} onClose={dismiss} className="relative z-[1300]">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl shadow-black/60">
          <DialogTitle className="text-sm font-semibold text-zinc-100">Logia {update.version} is available</DialogTitle>
          <Description className="mt-1.5 text-[13px] leading-5 text-zinc-400">
            You have {update.currentVersion}.{' '}
            {installMode === 'auto' && 'Logia will download the update and restart. Your notes are saved first.'}
            {installMode === 'nix' && 'This copy was installed with Nix, so update it from your terminal:'}
            {installMode === 'manual' && "This copy can't update itself. Download the new version from GitHub."}
          </Description>

          {installMode === 'nix' && (
            <pre className="mt-3 select-text overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200">
              {NIX_COMMAND}
            </pre>
          )}

          {notes && (
            <div className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs leading-5 text-zinc-400">
              {notes}
            </div>
          )}

          {busy && (
            <div className="mt-4">
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full rounded-full bg-zinc-200 transition-[width] ${percent === null ? 'w-1/3 animate-pulse' : ''}`}
                  style={percent === null ? undefined : { width: `${percent}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-zinc-500">
                {status === 'installing'
                  ? 'Installing…'
                  : `Downloading ${formatBytes(downloaded)}${total ? ` of ${formatBytes(total)}` : ''}`}
              </p>
            </div>
          )}

          {status === 'error' && error && <p className="mt-3 text-xs leading-5 text-red-400">Update failed: {error}</p>}

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={skip} disabled={busy}>
              Skip this version
            </Button>
            <Button variant="ghost" onClick={dismiss} disabled={busy}>
              Later
            </Button>
            {installMode === 'auto' ? (
              <Button variant="primary" autoFocus onClick={() => void install()} disabled={busy}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                {status === 'error' ? 'Try again' : 'Update and restart'}
              </Button>
            ) : (
              <Button variant="primary" autoFocus onClick={() => void openExternal(RELEASES_URL)}>
                <ExternalLink size={13} /> Open download page
              </Button>
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
