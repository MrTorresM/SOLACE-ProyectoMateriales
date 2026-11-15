import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import { useHub, useStore } from '../lib/context.tsx'
import type { Toast } from '../lib/store.ts'

function ToastItem({ toast }: { toast: Toast }) {
  const store = useStore()
  useEffect(() => {
    const t = setTimeout(() => store.dispatch({ type: 'dismiss', id: toast.id }), 4500)
    return () => clearTimeout(t)
  }, [store, toast.id])
  const Icon = toast.kind === 'error' ? CircleAlert : toast.kind === 'ok' ? CircleCheck : Info
  return (
    <motion.div layout className={`toast toast-${toast.kind}`} initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.96 }} role="status">
      <Icon size={18} aria-hidden />
      <span>{toast.text}</span>
      <button className="icon-btn small" onClick={() => store.dispatch({ type: 'dismiss', id: toast.id })} aria-label="Cerrar">
        <X size={14} />
      </button>
    </motion.div>
  )
}

export function Toasts() {
  const toasts = useHub((s) => s.toasts)
  return (
    <div className="toasts">
      <AnimatePresence>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </AnimatePresence>
    </div>
  )
}
