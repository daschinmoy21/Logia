import { useEffect, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle, Description } from '@headlessui/react';
import { invoke } from '@tauri-apps/api/core';
import { Copy, FilePlus2, FolderInput, FolderPlus, Link2, Loader2, PanelTop, Pencil, PenTool, Star, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNotesStore } from '../../store/notesStore';
import useUiStore from '../../store/UiStore';
import type { Folder } from '../../types/Note';
import { Button } from '../ui/kit';
import { AnchoredMenu, MenuItem, MenuSeparator, MenuSub } from '../ui/menu';
import { copyWikiLink, createFolderIn, createIn, duplicateNote, folderPath, moveFolder, moveNote, toggleStar } from './actions';
import { useWorkspaceStore } from './workspaceStore';

interface TrashItem {
  id: string;
  title: string;
  original_type: string;
  filename: string;
  deleted_at: string;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-[1300]">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl shadow-black/60">
          <DialogTitle className="text-sm font-semibold text-zinc-100">{title}</DialogTitle>
          <Description className="mt-1.5 text-[13px] leading-5 text-zinc-400">{body}</Description>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="danger" autoFocus onClick={onConfirm}>{confirmLabel}</Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

function MoveTargets({ current, excluded, onMove }: { current: string | undefined; excluded?: string; onMove: (folderId: string | undefined) => void }) {
  const folders = useNotesStore((s) => s.folders);
  const inExcluded = (folder: Folder) => {
    const seen = new Set<string>();
    for (let id: string | undefined = folder.id; id && !seen.has(id); id = folders.find((f) => f.id === id)?.parent_id) {
      if (id === excluded) return true;
      seen.add(id);
    }
    return false;
  };
  const targets = folders
    .filter((folder) => !inExcluded(folder) && folder.id !== current)
    .map((folder) => ({ id: folder.id, path: folderPath(folder.id, folders, ' / ') }))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
  return (
    <>
      <MenuItem disabled={current === undefined} onSelect={() => onMove(undefined)}>Workspace root</MenuItem>
      {targets.length > 0 && <MenuSeparator />}
      {targets.map((target) => (
        <MenuItem key={target.id} onSelect={() => onMove(target.id)}>{target.path}</MenuItem>
      ))}
    </>
  );
}

/** The one context menu: the tree, Home rows and tabs all open it through UiStore. */
function ContextMenuHost() {
  const menu = useUiStore((s) => s.contextMenu);
  if (!menu) return null;
  const ui = useUiStore.getState();
  const close = () => ui.setContextMenu(null);
  const { note, folder } = menu;

  return (
    <AnchoredMenu
      key={`${menu.x}:${menu.y}`}
      x={menu.x}
      y={menu.y}
      onClose={close}
      onCloseAutoFocus={(event) => {
        // A rename input or dialog is taking focus; don't pull it back to the invisible anchor.
        event.preventDefault();
        const id = note?.id ?? folder?.id;
        const { renamingNoteId, folderRenameRequest, deleteConfirmId, deleteConfirmFolderId } = useUiStore.getState();
        if (!id || renamingNoteId || folderRenameRequest || deleteConfirmId || deleteConfirmFolderId) return;
        document.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      }}
    >
      {note && (
        <>
          <MenuItem icon={<PanelTop size={14} />} onSelect={() => useWorkspaceStore.getState().pinTab(note.id)}>Keep tab open</MenuItem>
          <MenuItem icon={<Star size={14} className={note.starred ? 'fill-current' : ''} />} onSelect={() => void toggleStar(note)}>
            {note.starred ? 'Remove from favorites' : 'Add to favorites'}
          </MenuItem>
          <MenuItem icon={<Link2 size={14} />} onSelect={() => void copyWikiLink(note)}>Copy link</MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Pencil size={14} />} onSelect={() => ui.startRenaming(note.id, note.title || 'Untitled')}>Rename</MenuItem>
          <MenuItem icon={<Copy size={14} />} onSelect={() => void duplicateNote(note)}>Duplicate</MenuItem>
          <MenuSub label="Move to" icon={<FolderInput size={14} />}>
            <MoveTargets current={note.folder_id} onMove={(id) => void moveNote(note.id, id)} />
          </MenuSub>
          <MenuSeparator />
          <MenuItem danger icon={<Trash2 size={14} />} onSelect={() => ui.setDeleteConfirmId(note.id)}>Move to Trash</MenuItem>
        </>
      )}
      {folder && (
        <>
          <MenuItem icon={<FilePlus2 size={14} />} onSelect={() => void createIn('text', folder.id)}>New note</MenuItem>
          <MenuItem icon={<PenTool size={14} />} onSelect={() => void createIn('canvas', folder.id)}>New canvas</MenuItem>
          <MenuItem icon={<FolderPlus size={14} />} onSelect={() => void createFolderIn(folder.id)}>New folder</MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Pencil size={14} />} onSelect={() => ui.setFolderRenameRequest({ id: folder.id, name: folder.name })}>Rename</MenuItem>
          <MenuSub label="Move to" icon={<FolderInput size={14} />}>
            <MoveTargets current={folder.parent_id} excluded={folder.id} onMove={(id) => void moveFolder(folder.id, id)} />
          </MenuSub>
          <MenuSeparator />
          <MenuItem danger icon={<Trash2 size={14} />} onSelect={() => ui.setDeleteConfirmFolderId(folder.id)}>Move to Trash</MenuItem>
        </>
      )}
      {!note && !folder && (
        <>
          <MenuItem icon={<FilePlus2 size={14} />} onSelect={() => void createIn('text')}>New note</MenuItem>
          <MenuItem icon={<PenTool size={14} />} onSelect={() => void createIn('canvas')}>New canvas</MenuItem>
          <MenuItem icon={<FolderPlus size={14} />} onSelect={() => void createFolderIn()}>New folder</MenuItem>
        </>
      )}
    </AnchoredMenu>
  );
}

function DeleteDialogs() {
  const noteId = useUiStore((s) => s.deleteConfirmId);
  const folderId = useUiStore((s) => s.deleteConfirmFolderId);
  const ui = useUiStore.getState();

  const confirmNote = async () => {
    if (!noteId) return;
    ui.setDeleteConfirmId(null);
    try {
      await useNotesStore.getState().deleteNote(noteId);
    } catch (error) {
      console.error('Failed to delete note', error);
      toast.error(`Couldn't delete the note: ${error}`);
    }
  };

  const confirmFolder = async () => {
    if (!folderId) return;
    ui.setDeleteConfirmFolderId(null);
    try {
      await useNotesStore.getState().deleteFolder(folderId);
    } catch (error) {
      console.error('Failed to delete folder', error);
      toast.error(`Couldn't delete the folder: ${error}`);
    }
  };

  return (
    <>
      <ConfirmDialog
        open={noteId !== null}
        title="Move this note to Trash?"
        body="You can restore it from Trash for 14 days."
        confirmLabel="Move to Trash"
        onConfirm={() => void confirmNote()}
        onClose={() => ui.setDeleteConfirmId(null)}
      />
      <ConfirmDialog
        open={folderId !== null}
        title="Move this folder to Trash?"
        body="Everything inside goes with it. You can restore it from Trash for 14 days."
        confirmLabel="Move to Trash"
        onConfirm={() => void confirmFolder()}
        onClose={() => ui.setDeleteConfirmFolderId(null)}
      />
    </>
  );
}

function TrashDialog() {
  const open = useUiStore((s) => s.isTrashOpen);
  const setOpen = useUiStore((s) => s.setIsTrashOpen);
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await invoke<TrashItem[]>('get_trash_items'));
    } catch (error) {
      console.error('Failed to load trash:', error);
      toast.error('Failed to load trash items');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  const restore = async (item: TrashItem) => {
    try {
      await invoke('restore_from_trash', { itemId: item.id, itemType: item.original_type });
      toast.success(item.original_type === 'note' ? 'Note restored' : 'Folder and contents restored');
      await load();
      const store = useNotesStore.getState();
      void store.loadNotes();
      void store.loadFolders();
    } catch (error) {
      console.error('Failed to restore:', error);
      toast.error('Failed to restore item');
    }
  };

  const emptyTrash = async () => {
    setConfirmEmpty(false);
    try {
      const count = await invoke<number>('empty_trash');
      toast.success(`Permanently deleted ${count} ${count === 1 ? 'item' : 'items'}`);
      setItems([]);
    } catch (error) {
      console.error('Failed to empty trash:', error);
      toast.error('Failed to empty trash');
    }
  };

  return (
    <Dialog open={open} onClose={() => setOpen(false)} className="relative z-[1000]">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="flex max-h-[70dvh] w-full max-w-md flex-col rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/60">
          <div className="border-b border-zinc-800 px-4 py-3">
            <DialogTitle className="text-sm font-semibold text-zinc-100">Trash</DialogTitle>
            <Description className="mt-0.5 text-xs text-zinc-500">Items are permanently deleted after 14 days.</Description>
          </div>
          <div className="min-h-32 flex-1 overflow-y-auto p-1.5">
            {loading && items.length === 0 ? (
              <div className="flex justify-center py-10"><Loader2 size={16} className="animate-spin text-zinc-500" /></div>
            ) : items.length === 0 ? (
              <p className="py-10 text-center text-[13px] text-zinc-500">Trash is empty</p>
            ) : (
              items.map((item) => (
                <div key={item.id} className="group flex items-center gap-3 rounded-md px-2.5 py-2 hover:bg-white/[0.04]">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-zinc-200">{item.title}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {item.original_type === 'note' ? 'Note' : 'Folder'} · Deleted {new Date(item.deleted_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => void restore(item)}>Restore</Button>
                </div>
              ))
            )}
          </div>
          <div className="flex items-center justify-between border-t border-zinc-800 px-3 py-2.5">
            <Button variant="danger-ghost" size="sm" disabled={items.length === 0} onClick={() => setConfirmEmpty(true)}>Empty Trash</Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
          </div>
          <ConfirmDialog
            open={confirmEmpty}
            title="Empty Trash?"
            body="Everything in Trash is deleted permanently. This can't be undone."
            confirmLabel="Empty Trash"
            onConfirm={() => void emptyTrash()}
            onClose={() => setConfirmEmpty(false)}
          />
        </DialogPanel>
      </div>
    </Dialog>
  );
}

export function WorkspaceMenus() {
  return (
    <>
      <ContextMenuHost />
      <DeleteDialogs />
      <TrashDialog />
    </>
  );
}
