import { AnimatePresence, motion } from 'framer-motion';
import { useToast } from '../../store/toastStore';

export function ToastHost() {
  const message = useToast((s) => s.message);
  return (
    <div className="fixed inset-x-0 bottom-24 z-[60] flex justify-center pointer-events-none px-4 no-capture">
      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            className="glass rounded-2xl px-4 py-2.5 text-sm font-medium shadow-soft max-w-sm text-center"
          >
            {message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
