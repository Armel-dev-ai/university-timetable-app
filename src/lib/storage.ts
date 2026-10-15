import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import type { StateStorage } from 'zustand/middleware';

/** Persistance Capacitor Preferences (natif) ou localStorage (web) */
export const capacitorStorage: StateStorage = {
  getItem: async (name) => {
    if (Capacitor.isNativePlatform()) {
      const { value } = await Preferences.get({ key: name });
      return value;
    }
    return localStorage.getItem(name);
  },
  setItem: async (name, value) => {
    if (Capacitor.isNativePlatform()) {
      await Preferences.set({ key: name, value });
      return;
    }
    localStorage.setItem(name, value);
  },
  removeItem: async (name) => {
    if (Capacitor.isNativePlatform()) {
      await Preferences.remove({ key: name });
      return;
    }
    localStorage.removeItem(name);
  },
};
