import { BatteryMedium, Cpu, Lightbulb, Radio, Smartphone } from 'lucide-react'
import type { ReactNode } from 'react'
import { useHub } from '../lib/context.tsx'
import { fmt, fmtCurrent, fmtPower } from '../lib/format.ts'
import { AnimatedNumber } from './AnimatedNumber.tsx'

interface Branch {
  key: string
  label: string
  sub: string
  icon: ReactNode
  p: number
  estimated?: boolean
}

/** Duración de un ciclo de la animación del flujo: más potencia → más rápido. */
export function flowDuration(p: number): number {
  return Math.min(6, Math.max(0.35, 2.4 / (p + 0.15)))
}

const ROW_Y = [50, 150, 250, 350]

export function PowerFlow() {
  const t = useHub((s) => s.telemetry)
  const p = t?.power
  const usb = p?.usb.p ?? 0
  const radio = p?.radio.p ?? 0
  const led = p?.led.p ?? 0
  const bat = p?.bat.p ?? 0
  const other = Math.max(0, bat - usb - radio - led)

  const branches: Branch[] = [
    { key: 'usb', label: 'Carga de celular', sub: p ? `5 V · ${fmt(p.usb.v, 2)} V · ${fmtCurrent(p.usb.i)}` : '5 V', icon: <Smartphone size={18} />, p: usb },
    { key: 'radio', label: 'Radio AM', sub: p ? `3 V · ${fmt(p.radio.v, 2)} V · ${fmtCurrent(p.radio.i)}` : '3 V', icon: <Radio size={18} />, p: radio },
    { key: 'led', label: 'Tira LED', sub: 'estimada por modelo', icon: <Lightbulb size={18} />, p: led, estimated: true },
    { key: 'other', label: 'ESP32 y pérdidas', sub: 'diferencia con la batería', icon: <Cpu size={18} />, p: other, estimated: true },
  ]
  const total = Math.max(bat, usb + radio + led, 0.001)

  return (
    <section className="card flow-card" aria-label="Flujo de energía">
      <header className="card-head">
        <h2>Flujo de energía</h2>
        <span className="muted small">INA3221 · 3 canales</span>
      </header>

      <div className="flow">
        <div className="flow-source">
          <BatteryMedium size={26} aria-hidden />
          <div className="flow-source-value">{t ? <AnimatedNumber value={bat} format={fmtPower} /> : '—'}</div>
          <div className="muted small">{p && p.bat.i < 0 ? 'entrando' : 'saliendo'}</div>
        </div>

        <svg className="flow-lines" viewBox="0 0 100 400" preserveAspectRatio="none" aria-hidden>
          {branches.map((b, k) => {
            const y = ROW_Y[k]!
            const active = b.p > 0.02
            const w = active ? 1.5 + Math.min(5, Math.sqrt(b.p) * 2.2) : 1.2
            const d = `M0 200 C 55 200, 45 ${y}, 100 ${y}`
            return (
              <g key={b.key}>
                <path d={d} className="flow-track" strokeWidth={w} />
                {active && (
                  <path
                    d={d}
                    className={`flow-dash flow-${b.key}`}
                    strokeWidth={w}
                    strokeDasharray={b.estimated ? '3 9' : '8 10'}
                    style={{ animationDuration: `${flowDuration(b.p)}s` }}
                  />
                )}
              </g>
            )
          })}
        </svg>

        <ul className="flow-outputs">
          {branches.map((b) => {
            const share = Math.min(100, (b.p / total) * 100)
            return (
              <li key={b.key} className={b.p > 0.02 ? 'active' : 'idle'}>
                <span className={`flow-icon flow-${b.key}`} aria-hidden>
                  {b.icon}
                </span>
                <div className="flow-text">
                  <div className="flow-label">
                    {b.label}
                    {b.estimated && <span className="est" title="Valor estimado, no medido directamente">est.</span>}
                  </div>
                  <div className="muted tiny">{b.sub}</div>
                  <div className="bar" aria-hidden>
                    <span className={`flow-${b.key}`} style={{ width: `${share}%` }} />
                  </div>
                </div>
                <div className="flow-value">{t ? fmtPower(b.p) : '—'}</div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
