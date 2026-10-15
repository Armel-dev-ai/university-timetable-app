import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AppSettings, Language, ThemeMode, ViewMode } from '../types';
import { capacitorStorage } from '../lib/storage';

interface SettingsState extends AppSettings {
  setTheme: (theme: ThemeMode) => void;
  setLanguage: (language: Language) => void;
  setReminderMinutes: (n: number) => void;
  setRemindersEnabled: (v: boolean) => void;
  setCaptureMode: (v: boolean) => void;
  setSearchQuery: (q: string) => void;
  setViewMode: (m: ViewMode) => void;
  setSelectedDayId: (id: string | null) => void;
}

type PersistedSettings = Partial<AppSettings> & { anthropicKey?: string };

export const useSettingsStore = create<SettingsState>()(
  persist<SettingsState, [], [], PersistedSettings>(
    (set) => ({
      theme: 'auto',
      language: 'fr',
      reminderMinutes: 15,
      remindersEnabled: false,
      captureMode: false,
      searchQuery: '',
      viewMode: 'week',
      selectedDayId: null,

      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      setReminderMinutes: (reminderMinutes) => set({ reminderMinutes }),
      setRemindersEnabled: (remindersEnabled) => set({ remindersEnabled }),
      setCaptureMode: (captureMode) => set({ captureMode }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setViewMode: (viewMode) => set({ viewMode }),
      setSelectedDayId: (selectedDayId) => set({ selectedDayId }),
    }),
    {
      name: 'edt-settings-v1',
      storage: createJSONStorage<PersistedSettings>(() => capacitorStorage),
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        reminderMinutes: state.reminderMinutes,
        remindersEnabled: state.remindersEnabled,
        captureMode: state.captureMode,
        searchQuery: state.searchQuery,
        viewMode: state.viewMode,
        selectedDayId: state.selectedDayId,
      }),
      version: 2,
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== 'object') return {};
        const migrated = { ...(persistedState as PersistedSettings) };
        delete migrated.anthropicKey;
        return migrated;
      },
    },
  ),
);
