import { useState, useEffect, type ReactNode } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { invoke } from '@tauri-apps/api/core';
import useUiStore, { type SettingsTab } from '../store/UiStore';
import { isProviderReady, useSettingsStore } from '../store/settingsStore';
import {
  GROUP_LABELS,
  PROVIDERS,
  type ProviderDef,
  type ProviderGroup,
  getProvider,
  resolveBaseUrl,
  resolveModel,
} from '../lib/ai/providers';
import { complete, friendlyAiError } from '../lib/ai/client';
import { EDITOR_KEYS, EXPLORER_KEYS, EX_COMMANDS, GLOBAL_KEYS, LEADER_BINDINGS, type KeyDoc } from '../lib/vim/keymap';
import {
  X,
  RefreshCw,
  Check,
  Loader2,
  AlertTriangle,
  Download,
  Upload,
  GitBranch,
  Link2,
  Unlink,
  Sparkles,
  Keyboard,
  AudioLines,
  ExternalLink,
  Terminal,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';

// Git sync status from backend
interface GitSyncStatus {
  configured: boolean;
  remote_url: string | null;
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  last_sync: string | null;
  git_available: boolean;
  message: string;
}

interface GitSyncResult {
  message: string;
  needs_reload: boolean;
}

const TABS: Array<{ id: SettingsTab; label: string; icon: ReactNode }> = [
  { id: 'ai', label: 'AI providers', icon: <Sparkles size={15} /> },
  { id: 'editor', label: 'Editor & Vim', icon: <Keyboard size={15} /> },
  { id: 'transcription', label: 'Transcription', icon: <AudioLines size={15} /> },
  { id: 'sync', label: 'Git sync', icon: <GitBranch size={15} /> },
];

const inputClass =
  'w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-colors';

const openExternal = async (url: string) => {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
};

export const Settings = () => {
  const isSettingsOpen = useUiStore((s) => s.isSettingsOpen);
  const setIsSettingsOpen = useUiStore((s) => s.setIsSettingsOpen);
  const settingsTab = useUiStore((s) => s.settingsTab);
  const [tab, setTab] = useState<SettingsTab>(settingsTab);

  useEffect(() => {
    if (isSettingsOpen) setTab(settingsTab);
  }, [isSettingsOpen, settingsTab]);

  return (
    <Dialog open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} className="relative z-[1000]">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />

      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-3xl h-[min(680px,88vh)] rounded-xl bg-zinc-900 border border-zinc-800 shadow-2xl flex overflow-hidden">
          {/* Tab rail */}
          <nav className="w-48 flex-shrink-0 border-r border-zinc-800 bg-zinc-950/40 p-3 flex flex-col gap-0.5">
            <DialogTitle className="px-2 pb-3 text-sm font-semibold text-zinc-200">Settings</DialogTitle>
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                  tab === t.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                }`}
                aria-current={tab === t.id ? 'page' : undefined}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </nav>

          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <h2 className="text-base font-medium text-white">{TABS.find((t) => t.id === tab)?.label}</h2>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                aria-label="Close settings"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {tab === 'ai' && <AiSettings />}
              {tab === 'editor' && <EditorSettings />}
              {tab === 'transcription' && <TranscriptionSettings />}
              {tab === 'sync' && <SyncSettings />}
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
};

/* ------------------------------------------------------------------ AI -- */

function AiSettings() {
  const settings = useSettingsStore();
  const [selectedId, setSelectedId] = useState(settings.activeProvider);
  const provider = getProvider(selectedId) ?? PROVIDERS[0];

  useEffect(() => {
    settings.refreshKeyStatus();
    settings.refreshCliStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups: ProviderGroup[] = ['cloud', 'local', 'cli'];

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-400">
        Pick where AI chat, the <code className="rounded bg-zinc-800 px-1 text-zinc-300">/ai</code> editor menu and transcript structuring get their answers.
        Keys are stored encrypted in your OS keychain.
      </p>

      {groups.map((group) => (
        <div key={group}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">{GROUP_LABELS[group]}</p>
          <div className="flex flex-wrap gap-2">
            {PROVIDERS.filter((p) => p.group === group).map((p) => {
              const ready = isProviderReady(p.id, settings);
              const isActive = settings.activeProvider === p.id;
              const isSelected = selectedId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`group flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-all ${
                    isSelected
                      ? 'border-blue-500/60 bg-blue-500/10 text-zinc-100'
                      : 'border-zinc-800 bg-zinc-950/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                  }`}
                  aria-pressed={isSelected}
                >
                  <span className={`size-1.5 rounded-full ${ready ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
                  {p.label}
                  {isActive && (
                    <span className="rounded bg-blue-500/20 px-1.5 text-[10px] font-medium uppercase tracking-wide text-blue-300">
                      active
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <ProviderDetails key={provider.id} provider={provider} />
    </div>
  );
}

function ProviderDetails({ provider }: { provider: ProviderDef }) {
  const settings = useSettingsStore();
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ state: 'idle' | 'running' | 'ok' | 'error'; message?: string }>({ state: 'idle' });

  const ready = isProviderReady(provider.id, settings);
  const isActive = settings.activeProvider === provider.id;
  const hasKey = !!settings.keyStatus[provider.id];
  const showKey = provider.needsKey || provider.id === 'custom';
  const cli = settings.cliStatus[provider.id];
  const modelListId = `models-${provider.id}`;

  const saveKey = async () => {
    if (!keyInput.trim()) return;
    setBusy(true);
    try {
      await settings.saveKey(provider.id, keyInput.trim());
      setKeyInput('');
      toast.success(`${provider.label} key saved`);
    } catch (e) {
      toast.error(`Failed to save key: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async () => {
    setBusy(true);
    try {
      await settings.removeKey(provider.id);
      toast.success(`${provider.label} key removed`);
    } catch (e) {
      toast.error(`Failed to remove key: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setTest({ state: 'running' });
    const started = performance.now();
    try {
      const reply = await complete({
        system: 'You are a connectivity check. Reply with the single word OK.',
        prompt: 'ping',
        provider,
      });
      const ms = Math.round(performance.now() - started);
      setTest({ state: 'ok', message: `${reply.trim().slice(0, 80) || '(empty reply)'} — ${ms} ms` });
    } catch (e) {
      setTest({ state: 'error', message: friendlyAiError(e, provider).replace(/[*`#]/g, '').trim() });
    }
  };

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            {provider.kind === 'cli' ? <Terminal size={14} /> : <Sparkles size={14} className="text-blue-400" />}
            {provider.label}
          </h3>
          {provider.hint && <p className="mt-1 text-xs text-zinc-500">{provider.hint}</p>}
        </div>
        {isActive ? (
          <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-md bg-blue-500/15 px-2 py-1 text-xs text-blue-300">
            <Check size={12} /> Active
          </span>
        ) : (
          <button
            type="button"
            onClick={() => settings.setActiveProvider(provider.id)}
            className="flex-shrink-0 rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white transition-colors"
          >
            Use this provider
          </button>
        )}
      </div>

      {provider.kind === 'cli' && (
        <div className="space-y-3">
          <div
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
              cli?.available ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'
            }`}
          >
            {cli?.available ? <Check size={14} /> : <AlertTriangle size={14} />}
            <span className="truncate">
              {cli?.available ? `Found at ${cli.path}` : `\`${cli?.binary ?? provider.binary}\` not found on PATH`}
            </span>
            <button
              type="button"
              onClick={() => settings.refreshCliStatus()}
              className="ml-auto p-1 rounded hover:bg-white/10"
              title="Detect again"
              aria-label="Detect again"
            >
              <RefreshCw size={12} />
            </button>
          </div>
          {!cli?.available && provider.installHint && (
            <p className="text-xs text-zinc-500">
              Install: <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">{provider.installHint}</code>
            </p>
          )}
          <Field label="Binary or full path" hint="Leave empty to look it up on PATH.">
            <input
              className={inputClass}
              value={settings.cliBinaries[provider.id] ?? ''}
              placeholder={provider.binary}
              onChange={(e) => settings.setCliBinary(provider.id, e.target.value)}
              onBlur={() => settings.refreshCliStatus()}
            />
          </Field>
        </div>
      )}

      {showKey && (
        <Field
          label={provider.needsKey ? 'API key' : 'API key (optional)'}
          hint={
            provider.keyUrl ? (
              <button type="button" onClick={() => openExternal(provider.keyUrl!)} className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300">
                Get a key <ExternalLink size={11} />
              </button>
            ) : undefined
          }
        >
          <div className="flex gap-2">
            <input
              type="password"
              className={inputClass}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveKey()}
              placeholder={hasKey ? '•••••••• saved — paste a new key to replace' : 'Paste your API key'}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={saveKey}
              disabled={busy || !keyInput.trim()}
              className="rounded-lg bg-zinc-100 px-3 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-40 transition-colors"
            >
              Save
            </button>
            {hasKey && (
              <button
                type="button"
                onClick={removeKey}
                disabled={busy}
                className="rounded-lg px-3 text-sm text-zinc-400 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
              >
                Remove
              </button>
            )}
          </div>
        </Field>
      )}

      {provider.editableBaseUrl && (
        <Field label="Base URL">
          <input
            className={inputClass}
            value={settings.baseUrls[provider.id] ?? ''}
            placeholder={provider.defaultBaseUrl}
            onChange={(e) => settings.setBaseUrl(provider.id, e.target.value)}
          />
        </Field>
      )}

      <Field
        label={provider.kind === 'cli' ? 'Model (optional)' : 'Model'}
        hint={provider.kind === 'cli' ? "Leave empty to use the CLI's own default." : undefined}
      >
        <input
          className={inputClass}
          list={modelListId}
          value={settings.models[provider.id] ?? ''}
          placeholder={provider.defaultModel || 'default'}
          onChange={(e) => settings.setModel(provider.id, e.target.value)}
        />
        <datalist id={modelListId}>
          {provider.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        {provider.models.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {provider.models.map((m) => {
              const current = resolveModel(provider, settings.models) === m;
              return (
                <button
                  type="button"
                  key={m}
                  onClick={() => settings.setModel(provider.id, m)}
                  className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                    current
                      ? 'border-blue-500/50 bg-blue-500/10 text-blue-200'
                      : 'border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
                  }`}
                >
                  {m}
                </button>
              );
            })}
          </div>
        )}
      </Field>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={runTest}
          disabled={!ready || test.state === 'running'}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-40 transition-colors"
          title={ready ? 'Send a tiny test request' : 'Finish setup first'}
        >
          {test.state === 'running' ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
          Test connection
        </button>
        {test.state === 'ok' && <span className="text-xs text-emerald-400 truncate">✓ {test.message}</span>}
        {test.state === 'error' && <span className="text-xs text-red-400 line-clamp-2">{test.message}</span>}
        {!ready && test.state === 'idle' && provider.kind === 'api' && (
          <span className="text-xs text-zinc-500">
            {provider.needsKey ? 'Add an API key to enable.' : `Uses ${resolveBaseUrl(provider, settings.baseUrls)}`}
          </span>
        )}
      </div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-xs font-medium text-zinc-400">{label}</label>
        {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------- Editor -- */

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-blue-500' : 'bg-zinc-700'
      }`}
    >
      <span
        className={`inline-block size-4 rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function KeyTable({ title, rows }: { title: string; rows: KeyDoc[] }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">{title}</p>
      <div className="rounded-lg border border-zinc-800 divide-y divide-zinc-800/70">
        {rows.map((r) => (
          <div key={r.keys + r.label} className="flex items-center gap-4 px-3 py-1.5">
            <code className="w-36 flex-shrink-0 font-mono text-xs text-blue-300">{r.keys}</code>
            <span className="text-xs text-zinc-400">{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EditorSettings() {
  const vimEnabled = useSettingsStore((s) => s.vimEnabled);
  const setVimEnabled = useSettingsStore((s) => s.setVimEnabled);
  const sidebarFloating = useSettingsStore((s) => s.sidebarFloating);
  const setSidebarFloating = useSettingsStore((s) => s.setSidebarFloating);

  const leaderRows: KeyDoc[] = LEADER_BINDINGS.filter((b) => b.key !== ' ').map((b) => ({
    keys: `Space ${b.key}`,
    label: b.label,
  }));

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Sidebar</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Auto-hide keeps the sidebar out of the way; move the pointer to the left edge to reveal it.
            </p>
          </div>
          <div className="flex flex-shrink-0 rounded-lg border border-zinc-800 p-0.5 text-xs">
            {[
              { v: false, label: 'Pinned' },
              { v: true, label: 'Auto-hide' },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                onClick={() => setSidebarFloating(o.v)}
                className={`whitespace-nowrap rounded-md px-3 py-1 transition-colors ${
                  sidebarFloating === o.v ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                }`}
                aria-pressed={sidebarFloating === o.v}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Vim mode</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Modal editing in notes plus keyboard navigation for the whole app. Toggle anytime from the
              mode badge in the header or with <code className="text-zinc-300">:set novim</code>.
            </p>
          </div>
          <Toggle checked={vimEnabled} onChange={setVimEnabled} label="Vim mode" />
        </div>

        <div className={`space-y-5 transition-opacity ${vimEnabled ? '' : 'opacity-50'}`}>
          <KeyTable title="Anywhere" rows={GLOBAL_KEYS} />
          <KeyTable title="Leader (Space)" rows={leaderRows} />
          <KeyTable title="Editor — normal mode" rows={EDITOR_KEYS} />
          <KeyTable title="File explorer (Space e)" rows={EXPLORER_KEYS} />
          <KeyTable title="Command line (:)" rows={EX_COMMANDS} />
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------- Transcription -- */

function TranscriptionSettings() {
  const [isInstallingDeps, setIsInstallingDeps] = useState(false);
  const [installStatus, setInstallStatus] = useState<'idle' | 'installing' | 'installed' | 'error'>('idle');
  const [installLog, setInstallLog] = useState<string>('');

  const handleInstallTranscriptionDeps = async () => {
    setIsInstallingDeps(true);
    setInstallStatus('installing');
    try {
      await invoke('install_transcription_dependencies');
      setInstallStatus('installed');
      setTimeout(() => setInstallStatus('idle'), 2000);
    } catch (error) {
      console.error('Failed to install transcription dependencies:', error);
      setInstallStatus('error');
    } finally {
      setIsInstallingDeps(false);
    }
  };

  // Poll the backend install log while installation is running so the UI can show progress
  useEffect(() => {
    let timer: number | undefined;
    async function poll() {
      try {
        const content = await invoke<string>('read_install_log');
        setInstallLog(content);
      } catch {
        // ignore errors while polling
      }
    }

    poll();
    if (isInstallingDeps) {
      timer = window.setInterval(poll, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isInstallingDeps]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-400">
        Install the Python dependencies used for local audio transcription (faster-whisper and friends).
        Transcripts are structured into notes by your active AI provider.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleInstallTranscriptionDeps}
          disabled={isInstallingDeps}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            installStatus === 'installed'
              ? 'bg-green-600 text-white hover:bg-green-700'
              : installStatus === 'error'
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed'
          }`}
        >
          {isInstallingDeps && <Loader2 size={14} className="animate-spin" />}
          {isInstallingDeps
            ? 'Installing…'
            : installStatus === 'installed'
              ? 'Installed ✓'
              : installStatus === 'error'
                ? 'Error — retry'
                : 'Install dependencies'}
        </button>
      </div>
      {installLog && (
        <pre className="max-h-72 overflow-auto text-xs bg-zinc-950 border border-zinc-800 p-3 rounded-lg text-zinc-400 whitespace-pre-wrap">
          {installLog}
        </pre>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Sync -- */

function SyncSettings() {
  const { gitSyncConfigured, setGitSyncConfigured, isSyncing, setIsSyncing, lastSyncedAt, setLastSyncedAt } =
    useUiStore();
  const [remoteUrl, setRemoteUrl] = useState('');
  const [branchName, setBranchName] = useState('main');
  const [gitStatus, setGitStatus] = useState<GitSyncStatus | null>(null);

  const checkGitStatus = async () => {
    try {
      const status = await invoke<GitSyncStatus>('git_sync_status');
      setGitStatus(status);
      setGitSyncConfigured(status.configured);
      if (status.remote_url) setRemoteUrl(status.remote_url);
      if (status.branch) setBranchName(status.branch);
      if (status.last_sync) setLastSyncedAt(new Date(status.last_sync));
    } catch (e) {
      console.error('Failed to check git status', e);
    }
  };

  useEffect(() => {
    checkGitStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reloadNotes = async () => {
    const { loadNotes, loadFolders } = (await import('../store/notesStore')).useNotesStore.getState();
    await loadNotes();
    await loadFolders();
  };

  const handleGitConfigure = async () => {
    if (!remoteUrl.trim()) {
      toast.error('Remote URL is required');
      return;
    }
    setIsSyncing(true);
    try {
      const result = await invoke<GitSyncStatus>('git_sync_configure', {
        remoteUrl: remoteUrl.trim(),
        branch: branchName.trim() || 'main',
      });
      setGitStatus(result);
      setGitSyncConfigured(result.configured);
      toast.success('Git sync configured!');
    } catch (e) {
      toast.error(`Configure failed: ${e}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleGitSyncNow = async () => {
    setIsSyncing(true);
    try {
      const result = await invoke<GitSyncResult>('git_sync_now');
      toast.success(result.message);
      setLastSyncedAt(new Date());
      await checkGitStatus();
      if (result.needs_reload) await reloadNotes();
    } catch (e) {
      toast.error(`Sync failed: ${e}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleGitForcePull = async () => {
    if (!confirm('This will discard ALL local changes and replace them with the remote state. Continue?')) return;
    setIsSyncing(true);
    try {
      const result = await invoke<GitSyncResult>('git_sync_force_pull');
      toast.success(result.message);
      setLastSyncedAt(new Date());
      await checkGitStatus();
      await reloadNotes();
    } catch (e) {
      toast.error(`Force pull failed: ${e}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleGitForcePush = async () => {
    if (!confirm('This will force-push your local state to the remote, overwriting remote changes. Continue?')) return;
    setIsSyncing(true);
    try {
      const result = await invoke<GitSyncResult>('git_sync_force_push');
      toast.success(result.message);
      setLastSyncedAt(new Date());
      await checkGitStatus();
    } catch (e) {
      toast.error(`Force push failed: ${e}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleGitDisconnect = async () => {
    setIsSyncing(true);
    try {
      const msg = await invoke<string>('git_sync_disconnect');
      toast.success(msg);
      setGitSyncConfigured(false);
      setGitStatus(null);
      setLastSyncedAt(null);
      setRemoteUrl('');
    } catch (e) {
      toast.error(`Disconnect failed: ${e}`);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-zinc-400">
        {gitSyncConfigured ? 'Notes are synced via git.' : 'Back up and sync your notes to any git remote.'}
      </p>

      {gitStatus && !gitStatus.git_available && (
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <span className="text-xs text-amber-400">git not found on PATH. Install git to enable sync.</span>
        </div>
      )}

      <div className="space-y-3">
        <Field label="Remote URL">
          <input
            type="text"
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
            placeholder="git@github.com:user/logia-notes.git"
            className={inputClass}
          />
        </Field>
        <Field label="Branch">
          <input
            type="text"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            placeholder="main"
            className={inputClass}
          />
        </Field>
      </div>

      {gitSyncConfigured && gitStatus && (
        <div className="flex items-center justify-between px-3 py-2 bg-zinc-800/50 rounded-lg">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-green-400" />
            <span className="text-xs text-zinc-300">
              {gitStatus.branch}
              {gitStatus.ahead > 0 && <span className="text-blue-400 ml-1">↑{gitStatus.ahead}</span>}
              {gitStatus.behind > 0 && <span className="text-amber-400 ml-1">↓{gitStatus.behind}</span>}
              {gitStatus.dirty && <span className="text-yellow-400 ml-1">•</span>}
            </span>
          </div>
          <span className="text-xs text-zinc-500">
            {lastSyncedAt ? `Last sync: ${lastSyncedAt.toLocaleTimeString()}` : 'Not synced yet'}
          </span>
        </div>
      )}

      <div className="space-y-2">
        {!gitSyncConfigured ? (
          <button
            type="button"
            onClick={handleGitConfigure}
            disabled={isSyncing || !remoteUrl.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-all"
          >
            {isSyncing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Configuring...
              </>
            ) : (
              <>
                <Link2 className="w-4 h-4" /> Connect Remote
              </>
            )}
          </button>
        ) : (
          <>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleGitSyncNow}
                disabled={isSyncing}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-zinc-100 text-zinc-900 hover:bg-white disabled:opacity-50 transition-all"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Syncing...' : 'Sync Now'}
              </button>
              <button
                type="button"
                onClick={handleGitConfigure}
                disabled={isSyncing}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-zinc-700 text-zinc-200 hover:bg-zinc-600 disabled:opacity-50 transition-all"
                title="Update remote URL"
                aria-label="Update remote URL"
              >
                <Link2 className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleGitForcePull}
                disabled={isSyncing}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50 transition-all"
                title="Discard local changes, use remote"
              >
                <Download className="w-3 h-3" />
                Use Remote
              </button>
              <button
                type="button"
                onClick={handleGitForcePush}
                disabled={isSyncing}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-zinc-600 text-white hover:bg-zinc-500 disabled:opacity-50 transition-all"
                title="Overwrite remote with local"
              >
                <Upload className="w-3 h-3" />
                Use Local
              </button>
            </div>

            <button
              type="button"
              onClick={handleGitDisconnect}
              disabled={isSyncing}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
            >
              <Unlink className="w-3 h-3" />
              Disconnect Remote
            </button>
          </>
        )}
      </div>
    </div>
  );
}
