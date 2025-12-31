import { useState, useEffect } from 'react';
import { Dialog, DialogPanel, DialogTitle, Description } from '@headlessui/react';
import { invoke } from '@tauri-apps/api/core';
import useUiStore from '../store/UiStore';
import { X, Cloud, CloudOff, RefreshCw, Check, Loader2, AlertTriangle, Download, Upload } from 'lucide-react';
import toast from 'react-hot-toast';

export const Settings = () => {
  const {
    isSettingsOpen,
    setIsSettingsOpen,
    setGoogleApiKey,
    googleDriveConnected,
    setGoogleDriveConnected,
    isSyncing,
    setIsSyncing,
    lastSyncedAt,
    setLastSyncedAt
  } = useUiStore();
  const [apiKey, setApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isConnectingDrive, setIsConnectingDrive] = useState(false); // [NEW]
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [isInstallingDeps, setIsInstallingDeps] = useState(false);
  const [installStatus, setInstallStatus] = useState<'idle' | 'installing' | 'installed' | 'error'>('idle');
  const [installLog, setInstallLog] = useState<string>('');
  const [syncConflict, setSyncConflict] = useState<{ local: number; remote: number } | null>(null);

  useEffect(() => {
    if (isSettingsOpen) {
      loadApiKey();
      checkDriveStatus(); // [NEW]
    }
  }, [isSettingsOpen]);

  const checkDriveStatus = async () => {
    try {
      const status = await invoke<{ is_authenticated: boolean }>('get_google_drive_status');
      setGoogleDriveConnected(status.is_authenticated);
    } catch (e) {
      console.error('Failed to check drive status', e);
    }
  };

  const checkForConflicts = async () => {
    try {
      const status = await invoke<{ local_count: number; remote_count: number; has_conflict: boolean }>('check_sync_status');
      if (status.has_conflict) {
        setSyncConflict({ local: status.local_count, remote: status.remote_count });
      } else {
        setSyncConflict(null);
      }
    } catch (e) {
      console.error('Failed to check sync status', e);
    }
  };

  const loadApiKey = async () => {
    try {
      const key = await invoke<string>('get_google_api_key');
      setApiKey(key);
      setGoogleApiKey(key); // Also update the store
    } catch (error) {
      console.error('Failed to load API key:', error);
      // Don't show error to user if it's just missing (first run)
    }
  };

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setStatus('error');
      toast.error("API Key cannot be empty");
      return;
    }

    setIsLoading(true);
    setStatus('saving');
    try {
      await invoke('save_google_api_key', { key: apiKey });
      // Update store inside a transition or timeout to avoid blocking UI during render if expensive? 
      // Actually standard SetState is fine. 
      setGoogleApiKey(apiKey);
      setStatus('saved');
      toast.success('API Key saved successfully');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (error) {
      console.error('Failed to save API key:', error);
      setStatus('error');
      toast.error('Failed to save API key');
    } finally {
      setIsLoading(false);
    }
  };

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

  const handleRemoveApiKey = async () => {
    setIsLoading(true);
    try {
      await invoke('remove_google_api_key');
      setApiKey('');
      setGoogleApiKey('');
      setStatus('saved');
      toast.success('API key removed successfully!');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (error) {
      console.error('Failed to remove API key:', error);
      setStatus('error');
      toast.error('Failed to remove API key.');
    } finally {
      setIsLoading(false);
    }
  };

  // Poll the backend install log while installation is running so the UI can show progress
  useEffect(() => {
    let timer: number | undefined;
    async function poll() {
      try {
        const content = await invoke<string>('read_install_log');
        setInstallLog(content);
      } catch (e) {
        // ignore errors while polling
      }
    }

    if (isInstallingDeps) {
      poll();
      // poll every second
      timer = window.setInterval(poll, 1000);
    } else {
      // fetch once when not installing
      poll();
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isInstallingDeps]);

  return (
    <Dialog
      open={isSettingsOpen}
      onClose={() => setIsSettingsOpen(false)}
      className="relative z-[1000]"
    >
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />

      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-md rounded-xl bg-zinc-900 border border-zinc-800 p-6 shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <DialogTitle className="text-lg font-medium text-white">Settings</DialogTitle>
            <button
              onClick={() => setIsSettingsOpen(false)}
              className="text-zinc-400 hover:text-white transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-medium text-zinc-300 mb-2">General</h3>
              <div className="space-y-4">
                <div>
                  <label htmlFor="apiKey" className="block text-xs text-zinc-400 mb-1.5">
                    Gemini API Key
                  </label>
                  <Description className="text-xs text-zinc-500 mb-2">
                    Required for AI features. The key is stored locally on your device.
                  </Description>
                  <input
                    id="apiKey"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Enter your API key"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-colors"
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-zinc-300 mb-2">Transcription</h3>
              <div className="space-y-4">
                <div>
                  <Description className="text-xs text-zinc-500 mb-2">
                    Install Python dependencies required for audio transcription. This will download faster-whisper and other required packages.
                  </Description>
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <button
                        onClick={handleInstallTranscriptionDeps}
                        disabled={isInstallingDeps}
                        className={`
                         px-4 py-2 rounded-lg text-sm font-medium transition-all
                         ${installStatus === 'installed'
                            ? 'bg-green-600 text-white hover:bg-green-700'
                            : installStatus === 'error'
                              ? 'bg-red-600 text-white hover:bg-red-700'
                              : 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed'}
                       `}
                      >
                        {isInstallingDeps ? 'Installing...' :
                          installStatus === 'installed' ? 'Installed ✓' :
                            installStatus === 'error' ? 'Error' : 'Install Dependencies'}
                      </button>
                    </div>
                    <div className="w-48 text-xs text-zinc-400">
                      {isInstallingDeps ? 'Downloading / installing...' : ''}
                    </div>
                  </div>
                  <div className="mt-3">
                    <pre className="max-h-40 overflow-auto text-xs bg-zinc-900 border border-zinc-800 p-2 rounded text-zinc-300">{installLog}</pre>
                  </div>
                </div>
              </div>
            </div>

            {/* Google Drive Sync Section */}
            <div className="bg-gradient-to-br from-zinc-800/50 to-zinc-900/50 rounded-xl p-4 border border-zinc-700/50">
              <div className="flex items-center gap-3 mb-4">
                <div className={`p-2 rounded-lg ${googleDriveConnected ? 'bg-green-500/20' : 'bg-zinc-700/50'}`}>
                  {googleDriveConnected ? (
                    <Cloud className="w-5 h-5 text-green-400" />
                  ) : (
                    <CloudOff className="w-5 h-5 text-zinc-400" />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-200">Google Drive Sync</h3>
                  <p className="text-xs text-zinc-500">
                    {googleDriveConnected ? 'Your notes are backed up to the cloud' : 'Connect to backup your notes'}
                  </p>
                </div>
              </div>

              {!googleDriveConnected ? (
                <button
                  onClick={async () => {
                    setIsConnectingDrive(true);
                    const toastId = toast.loading('Check your browser tabs to login...');
                    try {
                      await invoke('connect_google_drive');
                      setGoogleDriveConnected(true);
                      toast.success('Connected to Google Drive!', { id: toastId });
                      // Check for conflicts after connecting
                      await checkForConflicts();
                    } catch (e) {
                      console.error(e);
                      toast.error(`Connection failed: ${e}`, { id: toastId });
                    } finally {
                      setIsConnectingDrive(false);
                    }
                  }}
                  disabled={isConnectingDrive}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-all"
                >
                  {isConnectingDrive ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Cloud className="w-4 h-4" />
                      Connect Google Drive
                    </>
                  )}
                </button>
              ) : (
                <div className="space-y-3">
                  {/* Status Bar */}
                  <div className="flex items-center justify-between px-3 py-2 bg-zinc-800/50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-400" />
                      <span className="text-xs text-zinc-300">Connected</span>
                    </div>
                    <span className="text-xs text-zinc-500">
                      {lastSyncedAt ? `Last sync: ${lastSyncedAt.toLocaleTimeString()}` : 'Not synced yet'}
                    </span>
                  </div>

                  {/* Conflict Resolution */}
                  {syncConflict && (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400" />
                        <span className="text-xs font-medium text-amber-400">Sync Conflict Detected</span>
                      </div>
                      <p className="text-xs text-zinc-400 mb-3">
                        Local: {syncConflict.local} notes • Cloud: {syncConflict.remote} notes
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            try {
                              setIsSyncing(true);
                              const msg = await invoke<string>('force_sync_from_cloud');
                              toast.success(msg);
                              setSyncConflict(null);
                              setLastSyncedAt(new Date());
                            } catch (e) {
                              toast.error(`Failed: ${e}`);
                            } finally {
                              setIsSyncing(false);
                            }
                          }}
                          disabled={isSyncing}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          <Download className="w-3 h-3" />
                          Use Cloud
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              setIsSyncing(true);
                              const msg = await invoke<string>('force_sync_to_cloud');
                              toast.success(msg);
                              setSyncConflict(null);
                              setLastSyncedAt(new Date());
                            } catch (e) {
                              toast.error(`Failed: ${e}`);
                            } finally {
                              setIsSyncing(false);
                            }
                          }}
                          disabled={isSyncing}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-zinc-600 text-white hover:bg-zinc-500 disabled:opacity-50"
                        >
                          <Upload className="w-3 h-3" />
                          Use Local
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Sync Button with Progress Bar */}
                  <button
                    onClick={async () => {
                      setIsSyncing(true);
                      try {
                        const msg = await invoke<string>('sync_notes_to_google_drive');
                        toast.success(msg);
                        setLastSyncedAt(new Date());
                      } catch (e) {
                        console.error(e);
                        toast.error(`Sync failed: ${e}`);
                      } finally {
                        setIsSyncing(false);
                      }
                    }}
                    disabled={isSyncing}
                    className="relative w-full overflow-hidden rounded-lg text-sm font-medium bg-zinc-700 text-zinc-200 hover:bg-zinc-600 disabled:cursor-not-allowed transition-all"
                  >
                    {/* Animated Progress Bar (visible when syncing) */}
                    {isSyncing && (
                      <div className="absolute inset-0 bg-gradient-to-r from-zinc-600/30 via-zinc-500/40 to-zinc-600/30 animate-pulse" />
                    )}
                    {isSyncing && (
                      <div
                        className="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-blue-500 to-cyan-400"
                        style={{
                          animation: 'progress 2s ease-in-out infinite',
                        }}
                      />
                    )}
                    <style>{`
                      @keyframes progress {
                        0% { width: 0%; }
                        50% { width: 80%; }
                        100% { width: 100%; }
                      }
                    `}</style>
                    <div className="relative flex items-center justify-center gap-2 px-4 py-2.5">
                      {isSyncing ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Syncing...</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4" />
                          <span>Sync Now</span>
                        </>
                      )}
                    </div>
                  </button>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-4 border-t border-zinc-800">
              {apiKey && (
                <button
                  onClick={handleRemoveApiKey}
                  disabled={isLoading}
                  className={`
                    mr-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                    bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed
                  `}
                >
                  Remove API Key
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={isLoading || !apiKey}
                className={`
                  px-4 py-2 rounded-lg text-sm font-medium transition-all
                  ${status === 'saved'
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : status === 'error'
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed'}
                `}
              >
                {status === 'saving' ? 'Saving...' :
                  status === 'saved' ? 'Saved!' :
                    status === 'error' ? 'Error' : 'Save Changes'}
              </button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
};
