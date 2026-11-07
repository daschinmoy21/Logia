import { useState, useEffect, type ReactNode } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import useUiStore, { type SettingsTab } from '../store/UiStore';
import { isProviderReady, useSettingsStore } from '../store/settingsStore';
import {
  GROUP_LABELS,
  PROVIDERS,
  type ProviderDef,
  type ProviderGroup,
  getProvider,
  resolveBaseUrl,
} from '../lib/ai/providers';
import { complete, friendlyAiError } from '../lib/ai/client';
import { Button, IconButton } from './ui/kit';
import { ConfirmDialog } from './workspace/WorkspaceMenus';
import { ModelPicker } from './ModelPicker';
import { ProviderIcon } from './ProviderIcon';
import { openExternal } from '../lib/utils';
import { RELEASES_URL, useUpdateStore } from '../store/updateStore';
import { EDITOR_KEYS, EXPLORER_KEYS, EX_COMMANDS, GLOBAL_KEYS, LEADER_BINDINGS, type KeyDoc } from '../lib/vim/keymap';
import {
  X,
  Plus,
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
  SlidersHorizontal,
  Info,
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
  { id: 'general', label: 'General', icon: <SlidersHorizontal size={15} /> },
  { id: 'editor', label: 'Editor & Vim', icon: <Keyboard size={15} /> },
  { id: 'transcription', label: 'Transcription', icon: <AudioLines size={15} /> },
  { id: 'sync', label: 'Git sync', icon: <GitBranch size={15} /> },
  { id: 'about', label: 'About', icon: <Info size={15} /> },
];

const inputClass =
  'h-8 w-full rounded-md border border-zinc-800 bg-zinc-925 px-2.5 text-[13px] text-zinc-200 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none focus-visible:outline-none';

/** A label on the left and its control on the right, in a bordered group. */
function SettingRow({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-3.5 py-3">
      <div className="min-w-48 flex-1">
        <h3 className="text-[13px] font-medium text-zinc-100">{title}</h3>
        {description && <p className="mt-0.5 text-xs leading-5 text-zinc-500">{description}</p>}
      </div>
      {children}
    </div>
  );
}

const settingGroup = 'divide-y divide-zinc-800/70 rounded-lg border border-zinc-800 bg-zinc-925';


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
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />

      <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-6">
        <DialogPanel className="flex h-[min(720px,92dvh)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60 sm:flex-row">
          <nav className="flex w-full flex-shrink-0 gap-0.5 overflow-x-auto border-b border-zinc-800 bg-zinc-925 p-1.5 sm:w-48 sm:flex-col sm:border-b-0 sm:border-r">
            <DialogTitle className="hidden px-2 pb-2 pt-1.5 text-xs font-medium text-zinc-500 sm:block">Settings</DialogTitle>
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex h-7 shrink-0 items-center gap-2 whitespace-nowrap rounded-[5px] px-2 text-[13px] ${
                  tab === t.id ? 'bg-white/[0.13] text-zinc-50' : 'text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-100'
                }`}
                aria-current={tab === t.id ? 'page' : undefined}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </nav>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex h-11 flex-shrink-0 items-center justify-between pl-5 pr-2">
              <h2 className="text-[13px] font-medium text-zinc-100">{TABS.find((t) => t.id === tab)?.label}</h2>
              <IconButton label="Close settings" hint="Close" onClick={() => setIsSettingsOpen(false)}>
                <X size={15} />
              </IconButton>
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-6 pt-1">
              {tab === 'ai' && <AiSettings />}
              {tab === 'general' && <GeneralSettings />}
              {tab === 'editor' && <EditorSettings />}
              {tab === 'transcription' && (isTauri() ? <TranscriptionSettings /> : <DesktopOnly feature="Audio transcription" />)}
              {tab === 'sync' && (isTauri() ? <SyncSettings /> : <DesktopOnly feature="Git sync" />)}
              {tab === 'about' && <AboutSettings />}
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
};

function DesktopOnly({ feature }: { feature: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-925 p-3">
      <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-300/80" />
      <p className="text-[13px] text-zinc-300">
        {feature} needs the Logia desktop app. This browser workspace can't reach it.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ AI -- */

function AiSettings() {
  const settings = useSettingsStore();
  const [selectedId, setSelectedId] = useState(settings.activeProvider);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const provider = getProvider(selectedId) ?? PROVIDERS[0];

  useEffect(() => {
    if (!isTauri()) return;
    void settings.refreshKeyStatus();
    void settings.refreshCliStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const configured = PROVIDERS.filter((p) => p.id === settings.activeProvider ||
    settings.addedProviders.includes(p.id) || settings.keyStatus[p.id] ||
    settings.cliStatus[p.id]?.available || settings.models[p.id] || settings.baseUrls[p.id] || settings.cliBinaries[p.id]);
  const groups: ProviderGroup[] = ['cli', 'cloud', 'local'];
  const status = (p: ProviderDef) => p.kind === 'cli'
    ? !isTauri() ? 'Desktop app required' : settings.cliStatus[p.id]?.available ? 'CLI installed' : settings.cliStatus[p.id] ? 'CLI not detected' : 'Checking CLI…'
    : p.needsKey ? settings.keyStatus[p.id] ? 'API key saved' : 'Add an API key' : 'Local endpoint';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-zinc-500">Set up agent CLIs, and choose what powers editor AI and transcription.</p>
        <Button size="sm" onClick={() => { setAdding(true); setSearch(''); }}><Plus size={13} /> Add provider</Button>
      </div>
      <div className="grid min-w-0 overflow-hidden rounded-lg border border-zinc-800 md:grid-cols-[12rem_minmax(0,1fr)]">
        <div aria-label="Your providers" className="max-h-52 overflow-y-auto border-b border-zinc-800 bg-zinc-925 p-1 md:max-h-none md:border-b-0 md:border-r">
          {configured.map((p) => <button key={p.id} type="button" onClick={() => setSelectedId(p.id)} aria-pressed={selectedId === p.id}
            className={`flex w-full items-start gap-2.5 rounded-[5px] px-2 py-2 text-left ${selectedId === p.id ? 'bg-white/[0.13] text-zinc-50' : 'text-zinc-300 hover:bg-white/[0.07]'}`}>
            <ProviderIcon providerId={p.id} size={16} className="mt-px" />
            <span className="min-w-0 flex-1"><span className="block truncate text-[13px]">{p.label}</span><span className="mt-0.5 block truncate text-[11px] text-zinc-500">{status(p)}</span></span>
            {settings.activeProvider === p.id && <Check size={13} className="mt-0.5 shrink-0 text-blue-400" aria-label="Active provider" />}
          </button>)}
        </div>
        <div className="min-w-0 p-4 sm:p-5"><ProviderDetails key={provider.id} provider={provider} /></div>
      </div>
      {adding && <Dialog open onClose={() => setAdding(false)} className="relative z-[1100]">
        <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="flex max-h-[85dvh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/60">
            <div className="flex items-start justify-between border-b border-zinc-800 px-4 py-3">
              <div><DialogTitle className="text-sm font-semibold text-zinc-100">Add provider</DialogTitle><p className="mt-0.5 text-xs text-zinc-500">Choose a CLI agent, cloud API, or local server.</p></div>
              <button type="button" aria-label="Close add provider" onClick={() => setAdding(false)} className="rounded p-1 text-zinc-400 hover:bg-white/[0.07]"><X size={15} /></button>
            </div>
            <div className="overflow-y-auto p-4">
              <input autoFocus aria-label="Search providers" placeholder="Search providers…" value={search} onChange={(e) => setSearch(e.target.value)} className={inputClass} />
              {groups.map((group) => <div key={group} className="mt-4">
                <p className="mb-2 text-xs font-medium text-zinc-500">{GROUP_LABELS[group]}</p>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {PROVIDERS.filter((p) => p.group === group && p.label.toLowerCase().includes(search.toLowerCase())).map((p) => <button key={p.id} type="button" onClick={() => { settings.addProvider(p.id); setSelectedId(p.id); setAdding(false); }}
                    className="flex h-9 items-center gap-2.5 rounded-md border border-zinc-800 px-2.5 text-left text-[13px] text-zinc-200 hover:border-zinc-700 hover:bg-white/[0.07]">
                    <ProviderIcon providerId={p.id} size={16} /><span className="flex-1">{p.label}</span>{configured.some((item) => item.id === p.id) && <Check size={14} className="text-blue-400" />}
                  </button>)}
                </div>
              </div>)}
              {!PROVIDERS.some((p) => p.label.toLowerCase().includes(search.toLowerCase())) && <p className="mt-4 text-sm text-zinc-500">No providers match your search.</p>}
            </div>
          </DialogPanel>
        </div>
      </Dialog>}
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
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[13px] font-medium text-zinc-100">
            <ProviderIcon providerId={provider.id} size={16} />
            {provider.label}
          </h3>
          {provider.hint && <p className="mt-1 text-xs text-zinc-500">{provider.hint}</p>}
        </div>
        {isActive ? (
          <span className="inline-flex h-7 flex-shrink-0 items-center gap-1 px-1 text-xs text-zinc-400">
            <Check size={12} /> Active
          </span>
        ) : (
          <Button variant="primary" size="sm" onClick={() => settings.setActiveProvider(provider.id)}>Use this provider</Button>
        )}
      </div>

      {provider.kind === 'cli' && (
        <div className="space-y-3">
          <div
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
              cli?.available ? 'bg-emerald-500/10 text-emerald-300' : !isTauri() || !cli ? 'bg-white/[0.04] text-zinc-400' : 'bg-amber-500/10 text-amber-300'
            }`}
          >
            {cli?.available ? <Check size={14} /> : !isTauri() || !cli ? <Terminal size={14} /> : <AlertTriangle size={14} />}
            <span className="truncate">
              {!isTauri() ? 'CLI detection is available in the desktop app.' : cli?.available ? `Found at ${cli.path}` : cli ? `\`${cli.binary}\` not found on PATH` : 'Checking PATH…'}
            </span>
            <button
              type="button"
              disabled={!isTauri()}
              onClick={() => settings.refreshCliStatus()}
              className="ml-auto p-1 rounded hover:bg-white/10"
              title="Detect again"
              aria-label="Detect again"
            >
              <RefreshCw size={12} />
            </button>
          </div>
          {isTauri() && cli?.available === false && provider.installHint && (
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
            <Button variant="primary" onClick={saveKey} disabled={busy || !keyInput.trim()}>Save</Button>
            {hasKey && (
              <Button variant="danger-ghost" onClick={removeKey} disabled={busy}>Remove</Button>
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

      <Field label="Default model" hint="Also available directly in chat.">
        <div className="flex h-9 items-center justify-between rounded-md border border-zinc-800 bg-zinc-925 pl-2.5 pr-1">
          <span className="text-xs text-zinc-500">Model</span>
          <ModelPicker key={provider.id} providerId={provider.id} placement="below" />
        </div>
      </Field>

      <div className="flex items-center gap-3 pt-1">
        <Button
          size="sm"
          onClick={runTest}
          disabled={!ready || test.state === 'running'}
          title={ready ? 'Send a tiny test request' : 'Finish setup first'}
        >
          {test.state === 'running' ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
          Test connection
        </Button>
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
      className={`relative inline-flex h-[18px] w-8 flex-shrink-0 items-center rounded-full ${
        checked ? 'bg-blue-500' : 'bg-zinc-700'
      }`}
    >
      <span
        className={`inline-block size-3.5 rounded-full transition-transform duration-100 ${
          checked ? 'translate-x-4 bg-zinc-950' : 'translate-x-0.5 bg-zinc-300'
        }`}
      />
    </button>
  );
}

function KeyTable({ title, rows }: { title: string; rows: KeyDoc[] }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-zinc-500">{title}</p>
      <div className="divide-y divide-zinc-800/70 rounded-lg border border-zinc-800 bg-zinc-925">
        {rows.map((r) => (
          <div key={r.keys + r.label} className="flex items-center gap-4 px-3 py-1.5">
            <code className="w-36 flex-shrink-0 font-mono text-xs text-zinc-200">{r.keys}</code>
            <span className="text-xs text-zinc-400">{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GeneralSettings() {
  const uiScale = useSettingsStore((s) => s.uiScale);
  const setUiScale = useSettingsStore((s) => s.setUiScale);
  const sidebarFloating = useSettingsStore((s) => s.sidebarFloating);
  const setSidebarFloating = useSettingsStore((s) => s.setSidebarFloating);

  return (
    <div className={settingGroup}>
      <SettingRow title="UI scale" description="Ctrl/Cmd +/− changes the whole interface. Ctrl/Cmd+0 resets it.">
        <div className="flex items-center gap-1 text-[13px] text-zinc-300">
          <Button size="sm" aria-label="Zoom out" disabled={uiScale <= 0.5} onClick={() => setUiScale(uiScale - 0.1)}>−</Button>
          <output aria-label="UI scale" className="w-11 text-center tabular-nums">{Math.round(uiScale * 100)}%</output>
          <Button size="sm" aria-label="Zoom in" disabled={uiScale >= 2} onClick={() => setUiScale(uiScale + 0.1)}>+</Button>
          <Button size="sm" variant="ghost" onClick={() => setUiScale(1)}>Reset</Button>
        </div>
      </SettingRow>
      <SettingRow title="Sidebar" description="Auto-hide keeps it out of the way; move the pointer to the left edge to reveal it.">
        <div className="flex h-7 items-center rounded-md border border-zinc-800 p-0.5 text-xs">
          {[
            { v: false, label: 'Pinned' },
            { v: true, label: 'Auto-hide' },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => setSidebarFloating(o.v)}
              className={`h-full whitespace-nowrap rounded-[4px] px-2 ${
                sidebarFloating === o.v ? 'bg-white/[0.13] text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
              }`}
              aria-pressed={sidebarFloating === o.v}
            >
              {o.label}
            </button>
          ))}
        </div>
      </SettingRow>
    </div>
  );
}

function EditorSettings() {
  const vimEnabled = useSettingsStore((s) => s.vimEnabled);
  const setVimEnabled = useSettingsStore((s) => s.setVimEnabled);

  const leaderRows: KeyDoc[] = LEADER_BINDINGS.filter((b) => b.key !== ' ').map((b) => ({
    keys: `Space ${b.key}`,
    label: b.label,
  }));

  return (
    <div className="space-y-5">
      <div className={settingGroup}>
        <SettingRow
          title="Vim mode"
          description={<>Modal editing in notes plus keyboard navigation for the whole app. Toggle anytime from the status bar or with <code className="text-zinc-300">:set novim</code>.</>}
        >
          <Toggle checked={vimEnabled} onChange={setVimEnabled} label="Vim mode" />
        </SettingRow>
      </div>
      <div className={`space-y-5 ${vimEnabled ? '' : 'opacity-50'}`}>
        <KeyTable title="Anywhere" rows={GLOBAL_KEYS} />
        <KeyTable title="Leader (Space)" rows={leaderRows} />
        <KeyTable title="Editor — normal mode" rows={EDITOR_KEYS} />
        <KeyTable title="File explorer (Space e)" rows={EXPLORER_KEYS} />
        <KeyTable title="Command line (:)" rows={EX_COMMANDS} />
      </div>
    </div>
  );
}

function AboutSettings() {
  return (
    <div className="space-y-4">
      <div className={settingGroup}>
        <SettingRow title="Logia" description={`Version ${__APP_VERSION__}`}>
          <img src="/logo.png" alt="" className="size-7 rounded-md" />
        </SettingRow>
        <SettingRow title="Source code" description="Logia is open source under the AGPL-3.0.">
          <Button size="sm" onClick={() => void openExternal('https://github.com/daschinmoy21/Logia')}>
            <ExternalLink size={12} /> GitHub
          </Button>
        </SettingRow>
      </div>
      {isTauri() && <UpdateSettings />}
    </div>
  );
}

function UpdateSettings() {
  const autoCheck = useSettingsStore((s) => s.autoCheckUpdates);
  const setAutoCheck = useSettingsStore((s) => s.setAutoCheckUpdates);
  const { status, update, error, check } = useUpdateStore();
  const checking = status === 'checking';

  const description =
    status === 'checking'
      ? 'Checking…'
      : status === 'up-to-date'
        ? "You're on the latest version."
        : status === 'error'
          ? `Couldn't check for updates: ${error}`
          : update
            ? `Version ${update.version} is available.`
            : 'Look for a new release on GitHub.';

  return (
    <div className={settingGroup}>
      <SettingRow title="Updates" description={description}>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => void openExternal(RELEASES_URL)}>
            <ExternalLink size={12} /> Releases
          </Button>
          {update && status !== 'checking' ? (
            <Button size="sm" variant="primary" onClick={() => useUpdateStore.setState({ promptOpen: true })}>
              <Download size={12} /> Update
            </Button>
          ) : (
            <Button size="sm" onClick={() => void check({ manual: true })} disabled={checking}>
              {checking ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Check now
            </Button>
          )}
        </div>
      </SettingRow>
      <SettingRow title="Check automatically" description="On launch and every few hours while Logia is open.">
        <Toggle checked={autoCheck} onChange={setAutoCheck} label="Check for updates automatically" />
      </SettingRow>
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
      <p className="text-[13px] leading-5 text-zinc-400">
        Install the Python dependencies used for local audio transcription (faster-whisper and friends).
        Transcripts are structured into notes by your active AI provider.
      </p>
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={handleInstallTranscriptionDeps} disabled={isInstallingDeps}>
          {isInstallingDeps && <Loader2 size={13} className="animate-spin" />}
          {isInstallingDeps
            ? 'Installing…'
            : installStatus === 'installed'
              ? 'Installed'
              : installStatus === 'error'
                ? 'Failed. Retry'
                : 'Install dependencies'}
        </Button>
      </div>
      {installLog && (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-925 p-3 text-xs text-zinc-400">
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
  const [confirmForce, setConfirmForce] = useState<'pull' | 'push' | null>(null);

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
      <p className="text-[13px] text-zinc-400">
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
        <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-925 px-3 py-2">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-green-400" />
            <span className="text-xs text-zinc-300">
              {gitStatus.branch}
              {gitStatus.ahead > 0 && <span className="ml-1 text-zinc-300">↑{gitStatus.ahead}</span>}
              {gitStatus.behind > 0 && <span className="text-amber-400 ml-1">↓{gitStatus.behind}</span>}
              {gitStatus.dirty && <span className="text-yellow-400 ml-1">•</span>}
            </span>
          </div>
          <span className="text-xs text-zinc-500">
            {lastSyncedAt ? `Last sync: ${lastSyncedAt.toLocaleTimeString()}` : 'Not synced yet'}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {!gitSyncConfigured ? (
          <Button variant="primary" onClick={handleGitConfigure} disabled={isSyncing || !remoteUrl.trim()}>
            {isSyncing ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
            {isSyncing ? 'Connecting…' : 'Connect remote'}
          </Button>
        ) : (
          <>
            <Button variant="primary" onClick={handleGitSyncNow} disabled={isSyncing}>
              <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
              {isSyncing ? 'Syncing…' : 'Sync now'}
            </Button>
            <Button onClick={handleGitConfigure} disabled={isSyncing} title="Save this remote URL and branch">
              <Link2 size={13} /> Update remote
            </Button>
            <Button onClick={() => setConfirmForce('pull')} disabled={isSyncing} title="Discard local changes, use remote">
              <Download size={13} /> Use remote
            </Button>
            <Button onClick={() => setConfirmForce('push')} disabled={isSyncing} title="Overwrite remote with local">
              <Upload size={13} /> Use local
            </Button>
            <Button variant="danger-ghost" onClick={handleGitDisconnect} disabled={isSyncing}>
              <Unlink size={13} /> Disconnect
            </Button>
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirmForce === 'pull'}
        title="Replace local notes with the remote?"
        body="All local changes are discarded and replaced with the remote state."
        confirmLabel="Use remote"
        onConfirm={() => { setConfirmForce(null); void handleGitForcePull(); }}
        onClose={() => setConfirmForce(null)}
      />
      <ConfirmDialog
        open={confirmForce === 'push'}
        title="Overwrite the remote?"
        body="This force-pushes your local notes, replacing whatever is on the remote."
        confirmLabel="Use local"
        onConfirm={() => { setConfirmForce(null); void handleGitForcePush(); }}
        onClose={() => setConfirmForce(null)}
      />
    </div>
  );
}
