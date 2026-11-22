import { BatteryCharging, BatteryMedium, CircleDashed, House, Plug, Sun, SunMoon, Zap } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import type { ChargeSource, Telemetry } from '../../../shared/protocol.ts'
import { useHub } from '../lib/context.tsx'
import { fmtCurrent, fmtPower } from '../lib/format.ts'
import { flowDuration } from './PowerFlow.tsx'

export type ChargeMode = 'charging' | 'operating' | 'resting' | 'unknown'

export const SOURCE_LABEL: Record<ChargeSource, string> = {
  solar: 'Panel solar',
  usb: 'Cargador USB',
  unknown: 'Panel solar o USB',
}

/** Resume el estado de la batería a partir de la dirección de la corriente del CH1. */
export function chargeSummary(t: Telemetry | null): { mode: ChargeMode; title: string; detail: string; watts: number } {
  if (!t || t.bat.state === 'unknown') return { mode: 'unknown', title: 'Sin datos de la batería', detail: 'Esperando al sensor de potencia (INA3221)', watts: 0 }
  const b = t.power.bat
  if (t.bat.state === 'charging') {
    const w = t.bat.chargeW ?? Math.abs(b.p)
    const src = SOURCE_LABEL[t.bat.source ?? 'unknown']
    return { mode: 'charging', title: 'Cargando batería', detail: `${src} · entran ${fmtPower(w)} (${fmtCurrent(Math.abs(b.i))})`, watts: w }
  }
  if (t.bat.state === 'resting') return { mode: 'resting', title: 'En reposo', detail: 'Sin carga ni consumo apreciable', watts: 0 }
  return { mode: 'operating', title: 'En operación', detail: `La batería alimenta el sistema · salen ${fmtPower(b.p)}`, watts: b.p }
}

function Node({ icon, label, active, tone }: { icon: ReactNode; label: string; active: boolean; tone: string }) {
  return (
    <div className={`cs-node ${active ? 'active' : ''} tone-${tone}`}>
      <span className="cs-node-icon" aria-hidden>
        {active && <span className="cs-ping" />}
        {icon}
      </span>
      <span className="cs-node-label">{label}</span>
    </div>
  )
}

function Link({ active, watts, tone }: { active: boolean; watts: number; tone: string }) {
  return (
    <svg className="cs-link" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden>
      <path d="M0 5 H100" className="flow-track" strokeWidth={3} />
      {active && <path d="M0 5 H100" className={`flow-dash cs-dash tone-${tone}`} strokeWidth={3} strokeDasharray="8 10" style={{ animationDuration: `${flowDuration(watts)}s` }} />}
    </svg>
  )
}

export function ChargeStatus() {
  const t = useHub((s) => s.telemetry)
  const { mode, title, detail, watts } = chargeSummary(t)
  const source = t?.bat.source ?? null
  const charging = mode === 'charging'
  const operating = mode === 'operating'
  const srcTone = source === 'solar' ? 'solar' : 'usb'
  const SrcIcon = source === 'solar' ? Sun : source === 'usb' ? Plug : SunMoon
  const soc = t?.bat.soc
  // Mientras carga, las cargas (USB, luz) pueden seguir funcionando con parte de esa energía
  const loadsW = t ? t.power.usb.p + t.power.led.p : 0
  const loadsActive = operating || (charging && loadsW > 0.05)

  return (
    <section className={`card charge-status mode-${mode}`} aria-label="Estado de carga" aria-live="polite">
      <div className="cs-text">
        <span className={`cs-badge mode-${mode}`}>
          {charging ? <Zap size={14} aria-hidden /> : operating ? <BatteryMedium size={14} aria-hidden /> : <CircleDashed size={14} aria-hidden />}
          {charging ? 'Cargando' : operating ? 'En operación' : mode === 'resting' ? 'En reposo' : 'Sin datos'}
        </span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={title + (source ?? '')} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }}>
            <h2 className="cs-title">{title}</h2>
            <p className="muted small cs-detail">{detail}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="cs-diagram" role="img" aria-label={charging ? `Energía entrando a la batería desde ${SOURCE_LABEL[source ?? 'unknown']}` : operating ? 'Energía saliendo de la batería hacia el sistema' : 'Sin flujo de energía'}>
        <Node icon={<SrcIcon size={20} />} label={charging ? SOURCE_LABEL[source ?? 'unknown'] : 'Panel / USB'} active={charging} tone={srcTone} />
        <Link active={charging} watts={watts} tone={srcTone} />
        <Node
          icon={charging ? <BatteryCharging size={20} /> : <BatteryMedium size={20} />}
          label={soc === null || soc === undefined ? 'Batería' : `Batería ${Math.round(soc)}%`}
          active={charging || operating}
          tone={charging ? srcTone : 'bat'}
        />
        <Link active={loadsActive} watts={operating ? watts : loadsW} tone="bat" />
        <Node icon={<House size={20} />} label="USB · luz · ESP32" active={loadsActive} tone="bat" />
      </div>
    </section>
  )
}
