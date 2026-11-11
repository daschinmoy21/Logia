import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type MobileTab = 'notes' | 'tasks' | 'settings';
export type ThemePreference = 'system' | 'light' | 'dark';
export type TextSize = 'small' | 'default' | 'large';

export const TEXT_SIZES: Record<TextSize, number> = { small: 16, default: 17, large: 19 };

interface MobileState {
  tab: MobileTab;
  theme: ThemePreference;
  textSize: TextSize;
  setTab: (tab: MobileTab) => void;
  setTheme: (theme: ThemePreference) => void;
  setTextSize: (size: TextSize) => void;
}

/** Phone-only preferences. The desktop workspace keeps its own settings store. */
export const useMobileStore = create<MobileState>()(
  persist(
    (set) => ({
      tab: 'notes',
      theme: 'system',
      textSize: 'default',
      setTab: (tab) => set({ tab }),
      setTheme: (theme) => set({ theme }),
      setTextSize: (textSize) => set({ textSize }),
    }),
    {
      name: 'logia-mobile',
      version: 1,
      partialize: (s) => ({ theme: s.theme, textSize: s.textSize }),
    },
  ),
);
