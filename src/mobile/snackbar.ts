import { create } from 'zustand';

export type SnackbarClose = 'action' | 'timeout' | 'replaced' | 'dismissed';

export interface Snack {
  id: number;
  message: string;
  actionLabel?: string;
  duration: number;
  onClose?: (reason: SnackbarClose) => void;
}

interface SnackbarState {
  snack: Snack | null;
  show: (snack: Omit<Snack, 'id' | 'duration'> & { duration?: number }) => void;
  close: (reason: SnackbarClose) => void;
}

let nextId = 1;

/** One message at a time, like Android's. A new one settles the previous one first. */
export const useSnackbar = create<SnackbarState>()((set, get) => ({
  snack: null,
  show: (snack) => {
    const previous = get().snack;
    set({ snack: { duration: 4500, ...snack, id: nextId++ } });
    previous?.onClose?.('replaced');
  },
  close: (reason) => {
    const snack = get().snack;
    if (!snack) return;
    set({ snack: null });
    snack.onClose?.(reason);
  },
}));

export const showSnackbar = (message: string) => useSnackbar.getState().show({ message });
