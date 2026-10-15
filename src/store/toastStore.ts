import { create } from 'zustand';

interface ToastState {
  message: string | null;
  show: (msg: string, ms?: number) => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useToast = create<ToastState>((set) => ({
  message: null,
  show: (msg, ms = 2600) => {
    if (timer) clearTimeout(timer);
    set({ message: msg });
    timer = setTimeout(() => set({ message: null }), ms);
  },
}));
