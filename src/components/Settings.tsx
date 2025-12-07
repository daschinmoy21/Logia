import { useState, useEffect } from 'react';
import { Dialog, DialogPanel, DialogTitle, Description } from '@headlessui/react';
import { invoke } from '@tauri-apps/api/core';
import useUiStore from '../store/UiStore';
import { X } from 'lucide-react';

export const Settings = () => {
  const { isSettingsOpen, setIsSettingsOpen, setGoogleApiKey } = useUiStore();
  const [apiKey, setApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [isInstallingDeps, setIsInstallingDeps] = useState(false);
  const [installStatus, setInstallStatus] = useState<'idle' | 'installing' | 'installed' | 'error'>('idle');

  useEffect(() => {
    if (isSettingsOpen) {
      loadApiKey();
    }
  }, [isSettingsOpen]);

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
    setIsLoading(true);
    setStatus('saving');
    try {
      await invoke('save_google_api_key', { key: apiKey });
      setGoogleApiKey(apiKey); // Update the store
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (error) {
      console.error('Failed to save API key:', error);
      setStatus('error');
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
               </div>
             </div>

            <div className="flex justify-end pt-4 border-t border-zinc-800">
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
