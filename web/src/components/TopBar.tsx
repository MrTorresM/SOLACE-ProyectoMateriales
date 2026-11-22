import { Download, Eye, Moon, SlidersHorizontal, Sun } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { useHub, useNow } from '../lib/context.tsx'
import { Emblem, Wordmark } from './Logo.tsx'

interface Props {
  role: 'main' | 'listener'
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}

export const STALE_MS = 10000 // > 3 periodos de telemetría de la ESP32 (3 s)

export function TopBar({ role, theme, onToggleTheme }: Props) {
  const conn = useHub((s) => s.conn)
  const device = useHub((s) => s.device)
  const hub = useHub((s) => s.hub)
  const telemetry = useHub((s) => s.telemetry)
  const now = useNow()

  const stale = device.online && telemetry !== null && now - telemetry.receivedAt > STALE_MS
  let status: { text: string; tone: 'ok' | 'warn' | 'off' }
  if (conn !== 'online') status = { text: 'Reconectando con el hub…', tone: 'warn' }
  else if (!device.online) status = { text: 'Sin dispositivo', tone: 'off' }
  else if (stale) status = { text: 'Sin datos recientes', tone: 'warn' }
  else status = { text: 'ESP32 en línea', tone: 'ok' }

  const viewers = hub ? hub.listeners + hub.mains : null

  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="SOLACE inicio">
        <Emblem size={30} />
        <Wordmark size={19} />
      </a>

      <div className="topbar-right">
        <div className={`pill status-${status.tone}`} role="status" aria-live="polite">
          <span className="dot" aria-hidden />
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={status.text} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
              {status.text}
            </motion.span>
          </AnimatePresence>
        </div>

        {viewers !== null && (
          <div className="pill subtle hide-sm" title="Personas conectadas a este hub">
            <Eye size={15} aria-hidden />
            <span>{viewers}</span>
          </div>
        )}

        <div className={`pill role role-${role}`}>
          {role === 'main' ? <SlidersHorizontal size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
          <span>{role === 'main' ? 'Control' : 'Espectador'}</span>
        </div>

        <a className="icon-btn hide-sm" href="/api/export.csv" title="Descargar historial (CSV)" aria-label="Descargar historial CSV">
          <Download size={18} />
        </a>
        <button className="icon-btn" onClick={onToggleTheme} aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema oscuro'}>
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  )
}
