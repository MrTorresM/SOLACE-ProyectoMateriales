import { Activity } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { Command, HubEvent } from '../../../shared/protocol.ts'
import { useHub, useNow } from '../lib/context.tsx'
import { colorName, timeAgo } from '../lib/format.ts'

export function describeCommand(cmd: Command): string {
  switch (cmd.type) {
    case 'setMode':
      return cmd.mode === 'auto' ? 'activó el modo automático' : 'pasó a modo manual'
    case 'setLight': {
      const parts: string[] = []
      if (cmd.on !== undefined) parts.push(cmd.on ? 'encendió la luz' : 'apagó la luz')
      if (cmd.color) parts.push(`color ${colorName(cmd.color)}`)
      if (cmd.brightness !== undefined) parts.push(`brillo ${cmd.brightness}%`)
      return parts.join(' · ')
    }
    case 'setAuto':
      return `ajustó el modo automático (${cmd.luxOn}–${cmd.luxOff} lx)`
    case 'setUsb':
      return cmd.on ? 'encendió la carga de celular (USB)' : 'apagó la carga de celular (USB)'
    case 'setTempGuard':
      return cmd.mode === 'auto' ? 'activó las protecciones automáticas del USB' : 'pasó el USB a manual (sin protecciones)'
    case 'identify':
      return 'pidió identificar el dispositivo'
  }
}

function describe(e: HubEvent): { text: string; color?: string } {
  if (e.kind === 'device') return { text: e.online ? 'El dispositivo se conectó' : 'El dispositivo se desconectó' }
  return { text: `Control ${describeCommand(e.cmd)}`, color: e.cmd.type === 'setLight' ? e.cmd.color : undefined }
}

export function ActivityFeed() {
  const events = useHub((s) => s.events)
  const now = useNow(5000)
  return (
    <section className="card activity" aria-label="Actividad">
      <header className="card-head">
        <h2>Actividad</h2>
        <Activity size={16} aria-hidden className="muted" />
      </header>
      {events.length === 0 ? (
        <p className="muted small">Aquí aparecen los cambios que hace el panel de control.</p>
      ) : (
        <ul className="feed">
          <AnimatePresence initial={false}>
            {events.slice(0, 8).map((e) => {
              const d = describe(e)
              return (
                <motion.li key={`${e.at}-${e.kind}`} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                  {d.color ? <span className="swatch" style={{ background: d.color }} aria-hidden /> : <span className="feed-dot" aria-hidden />}
                  <span className="feed-text">{d.text}</span>
                  <span className="muted tiny">{timeAgo(e.at, now)}</span>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  )
}
