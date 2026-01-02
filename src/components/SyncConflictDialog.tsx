import { useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { invoke } from '@tauri-apps/api/core';
import { Cloud, HardDrive, X, Loader2, ArrowUp, ArrowDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNotesStore } from '../store/notesStore';

interface SyncAction {
    path: string;
    status: string;
    local_modified: string | null;
    cloud_modified: string | null;
}

interface SyncPlan {
    uploads: SyncAction[];
    downloads: SyncAction[];
    conflicts: SyncAction[];
    deletions_local: SyncAction[];
    deletions_cloud: SyncAction[];
}

interface SyncResult {
    needs_reload: boolean;
    message: string;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    syncPlan: SyncPlan | null;
    onSyncComplete: () => void;
}

export function SyncConflictDialog({ isOpen, onClose, syncPlan, onSyncComplete }: Props) {
    const [resolutions, setResolutions] = useState<Record<string, 'local' | 'cloud'>>({});
    const [isSyncing, setIsSyncing] = useState(false);

    if (!syncPlan) return null;

    const hasConflicts = syncPlan.conflicts.length > 0;
    const totalChanges = syncPlan.uploads.length + syncPlan.downloads.length +
        syncPlan.deletions_local.length + syncPlan.deletions_cloud.length;
    const allResolved = syncPlan.conflicts.every(c => resolutions[c.path]);

    const handleSync = async () => {
        if (hasConflicts && !allResolved) {
            toast.error('Resolve all conflicts first');
            return;
        }

        setIsSyncing(true);
        try {
            const resolutionList = Object.entries(resolutions).map(([path, choice]) => ({ path, choice }));
            const result = await invoke<SyncResult>('execute_sync_with_resolutions', { resolutions: resolutionList });
            toast.success(result.message);

            if (result.needs_reload) {
                const { loadNotes, loadFolders } = useNotesStore.getState();
                await loadNotes();
                await loadFolders();
            }

            onSyncComplete();
            onClose();
        } catch (e) {
            toast.error(`Sync failed: ${e}`);
        } finally {
            setIsSyncing(false);
        }
    };

    const getName = (path: string) => path.split('/').pop()?.replace('.json', '') || path;

    return (
        <Dialog open={isOpen} onClose={onClose} className="relative z-[1000]">
            <div className="fixed inset-0 bg-black/40" aria-hidden="true" />

            <div className="fixed inset-0 flex items-center justify-center p-4">
                <DialogPanel className="w-full max-w-sm rounded-lg bg-zinc-900 border border-zinc-800 shadow-lg">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                        <DialogTitle className="text-sm font-medium text-zinc-100">
                            Sync Changes
                        </DialogTitle>
                        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
                            <X size={16} />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="px-4 py-3 max-h-[50vh] overflow-y-auto">
                        {/* Stats row */}
                        <div className="flex gap-4 text-xs text-zinc-400 mb-4">
                            <span className="flex items-center gap-1">
                                <ArrowUp size={12} className="text-blue-400" />
                                {syncPlan.uploads.length} up
                            </span>
                            <span className="flex items-center gap-1">
                                <ArrowDown size={12} className="text-green-400" />
                                {syncPlan.downloads.length} down
                            </span>
                            {hasConflicts && (
                                <span className="text-amber-400">
                                    {syncPlan.conflicts.length} conflicts
                                </span>
                            )}
                        </div>

                        {/* Conflicts */}
                        {hasConflicts && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-zinc-500">Resolve conflicts</span>
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => {
                                                const r: Record<string, 'local' | 'cloud'> = {};
                                                syncPlan.conflicts.forEach(c => r[c.path] = 'local');
                                                setResolutions(r);
                                            }}
                                            className="px-2 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded"
                                        >
                                            All local
                                        </button>
                                        <button
                                            onClick={() => {
                                                const r: Record<string, 'local' | 'cloud'> = {};
                                                syncPlan.conflicts.forEach(c => r[c.path] = 'cloud');
                                                setResolutions(r);
                                            }}
                                            className="px-2 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded"
                                        >
                                            All cloud
                                        </button>
                                    </div>
                                </div>

                                {syncPlan.conflicts.map((c) => (
                                    <div key={c.path} className="flex items-center justify-between py-2 border-b border-zinc-800/50 last:border-0">
                                        <span className="text-xs text-zinc-300 truncate max-w-[140px]" title={c.path}>
                                            {getName(c.path)}
                                        </span>
                                        <div className="flex gap-1">
                                            <button
                                                onClick={() => setResolutions(p => ({ ...p, [c.path]: 'local' }))}
                                                className={`p-1.5 rounded ${resolutions[c.path] === 'local'
                                                        ? 'bg-zinc-700 text-zinc-100'
                                                        : 'text-zinc-500 hover:text-zinc-300'
                                                    }`}
                                                title="Use local"
                                            >
                                                <HardDrive size={12} />
                                            </button>
                                            <button
                                                onClick={() => setResolutions(p => ({ ...p, [c.path]: 'cloud' }))}
                                                className={`p-1.5 rounded ${resolutions[c.path] === 'cloud'
                                                        ? 'bg-blue-600 text-white'
                                                        : 'text-zinc-500 hover:text-zinc-300'
                                                    }`}
                                                title="Use cloud"
                                            >
                                                <Cloud size={12} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* No conflicts message */}
                        {!hasConflicts && totalChanges > 0 && (
                            <p className="text-xs text-zinc-500 text-center py-2">
                                {totalChanges} changes ready to sync
                            </p>
                        )}

                        {!hasConflicts && totalChanges === 0 && (
                            <p className="text-xs text-zinc-500 text-center py-2">
                                Everything is in sync
                            </p>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-800">
                        <button
                            onClick={onClose}
                            className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSync}
                            disabled={isSyncing || (hasConflicts && !allResolved)}
                            className="px-3 py-1.5 text-xs font-medium bg-zinc-100 text-zinc-900 rounded hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                        >
                            {isSyncing ? (
                                <>
                                    <Loader2 size={12} className="animate-spin" />
                                    Syncing
                                </>
                            ) : (
                                'Sync'
                            )}
                        </button>
                    </div>
                </DialogPanel>
            </div>
        </Dialog>
    );
}
