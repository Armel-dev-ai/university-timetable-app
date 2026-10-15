import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { translate } from '../../lib/i18n';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  tall?: boolean;
}

export function BottomSheet({ open, onClose, title, children, tall }: Props) {
  const language = useSettingsStore((state) => state.language);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label={translate(language, 'Fermer')}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal
            aria-label={title}
            className={`fixed inset-x-0 bottom-0 z-50 glass rounded-t-4xl shadow-glass safe-pb max-h-[92vh] flex flex-col ${
              tall ? 'min-h-[70vh]' : ''
            }`}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1.5 w-10 rounded-full bg-ink-faint/40" />
            </div>
            <div className="flex items-center justify-between px-5 pb-3">
              <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                className="text-sm font-medium text-accent px-2 py-1"
              >
                {translate(language, 'Fermer')}
              </button>
            </div>
            <div className="overflow-y-auto px-5 pb-4 flex-1">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
