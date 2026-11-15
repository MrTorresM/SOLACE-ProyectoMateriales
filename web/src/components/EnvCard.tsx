import { Droplets, Sun, Thermometer } from 'lucide-react'
import { useHub } from '../lib/context.tsx'
import { fmt, fmtLux, luxLabel } from '../lib/format.ts'
import { AnimatedNumber } from './AnimatedNumber.tsx'
import { ALERT_THRESHOLDS } from '../../../shared/deviceLogic.ts'

/** Posición 0–100 % de un valor de lux en escala logarítmica (0.1 lx … 100 klx). */
export function luxToPct(lux: number | null): number {
  if (lux === null || lux <= 0.1) return 0
  return Math.min(100, (Math.log10(lux / 0.1) / 6) * 100)
}

function Scale({ pct, marks, tone }: { pct: number; marks?: { at: number; label: string }[]; tone?: 'warn' }) {
  return (
    <div className={`scale ${tone ?? ''}`} aria-hidden>
      <div className="scale-track" />
      <div className="scale-fill" style={{ width: `${pct}%` }} />
      <div className="scale-thumb" style={{ left: `${pct}%` }} />
      {marks?.map((m) => (
        <span key={m.label} className="scale-mark" style={{ left: `${m.at}%` }}>
          {m.label}
        </span>
      ))}
    </div>
  )
}

export function EnvCard() {
  const t = useHub((s) => s.telemetry)
  const temp = t?.env.tempC ?? null
  const hum = t?.env.hum ?? null
  const lux = t ? (t.env.luxAmbient ?? t.env.lux) : null
  const hot = temp !== null && temp >= ALERT_THRESHOLDS.tempHighC

  return (
    <section className="card env" aria-label="Ambiente">
      <header className="card-head">
        <h2>Ambiente</h2>
        <span className="muted small">DHT11 · BH1750</span>
      </header>

      <div className="env-item">
        <div className="env-head">
          <Thermometer size={18} aria-hidden />
          <span>Temperatura</span>
          <strong className="env-value">{temp === null ? '—' : <AnimatedNumber value={temp} format={(x) => `${fmt(x, 1)} °C`} />}</strong>
        </div>
        <Scale
          pct={temp === null ? 0 : Math.max(0, Math.min(100, (temp / 60) * 100))}
          tone={hot ? 'warn' : undefined}
          marks={[{ at: (ALERT_THRESHOLDS.tempHighC / 60) * 100, label: `${ALERT_THRESHOLDS.tempHighC}°` }]}
        />
      </div>

      <div className="env-item">
        <div className="env-head">
          <Droplets size={18} aria-hidden />
          <span>Humedad relativa</span>
          <strong className="env-value">{hum === null ? '—' : <AnimatedNumber value={hum} format={(x) => `${fmt(x, 0)} %`} />}</strong>
        </div>
        <Scale pct={hum ?? 0} />
      </div>

      <div className="env-item">
        <div className="env-head">
          <Sun size={18} aria-hidden />
          <span>Luz ambiente</span>
          <strong className="env-value">{fmtLux(lux)}</strong>
        </div>
        <Scale
          pct={luxToPct(lux)}
          marks={[
            { at: luxToPct(1), label: '1' },
            { at: luxToPct(100), label: '100' },
            { at: luxToPct(10000), label: '10k lx' },
          ]}
        />
        <p className="muted tiny">{luxLabel(lux)}</p>
      </div>
    </section>
  )
}
