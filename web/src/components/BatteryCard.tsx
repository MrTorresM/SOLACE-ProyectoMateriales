import { BatteryCharging, BatteryWarning, Battery } from 'lucide-react'
import { useHub } from '../lib/context.tsx'
import { fmt, fmtCurrent, fmtDuration, fmtPower } from '../lib/format.ts'
import { AnimatedNumber, useAnimatedValue } from './AnimatedNumber.tsx'

const R = 70
const C = 2 * Math.PI * R

export function socTone(soc: number, charging: boolean): 'ok' | 'warn' | 'critical' {
  if (charging) return 'ok'
  if (soc < 10) return 'critical'
  if (soc < 20) return 'warn'
  return 'ok'
}

export function BatteryCard() {
  const t = useHub((s) => s.telemetry)
  const soc = t?.bat.soc ?? null
  const state = t?.bat.state ?? 'unknown'
  const charging = state === 'charging'
  const tone = socTone(soc ?? 100, charging)
  const animated = useAnimatedValue(soc ?? 0, 900)
  const Icon = charging ? BatteryCharging : tone === 'ok' ? Battery : BatteryWarning
  const autonomy =
    state === 'charging' ? 'Cargando' : state === 'resting' ? 'En reposo' : state === 'unknown' ? '—' : fmtDuration(t?.bat.autonomyMin ?? null)

  return (
    <section className="card battery" aria-label="Batería">
      <header className="card-head">
        <h2>Batería</h2>
        <span className="muted small">2S2P Li-ion · {fmt(t?.bat.capacityWh ?? 31.5, 1)} Wh útiles</span>
      </header>

      <div className="battery-body">
        <div className={`ring tone-${tone} ${charging ? 'charging' : ''}`}>
          <svg viewBox="0 0 180 180" aria-hidden>
            <circle cx={90} cy={90} r={R} className="ring-track" />
            <circle
              cx={90}
              cy={90}
              r={R}
              className="ring-value"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - Math.max(0, Math.min(100, animated)) / 100)}
              transform="rotate(-90 90 90)"
            />
          </svg>
          <div className="ring-center">
            <Icon size={18} aria-hidden className="ring-icon" />
            <div className="ring-value-text">{t && soc !== null ? <AnimatedNumber value={soc} format={(x) => `${Math.round(x)}%`} /> : '—'}</div>
            <div className="muted small">
              {!t || soc === null ? 'sin datos' : charging ? 'Cargando' : tone === 'critical' ? 'Crítica' : tone === 'warn' ? 'Baja' : 'Carga'}
            </div>
          </div>
        </div>

        <dl className="stats">
          <div>
            <dt>Autonomía estimada</dt>
            <dd className="big">{autonomy}</dd>
          </div>
          <div className="stats-row">
            <div>
              <dt>Voltaje</dt>
              <dd>{t ? <AnimatedNumber value={t.power.bat.v} format={(x) => `${fmt(x, 2)} V`} /> : '—'}</dd>
            </div>
            <div>
              <dt>Corriente</dt>
              <dd>{t ? fmtCurrent(t.power.bat.i) : '—'}</dd>
            </div>
            <div>
              <dt>Potencia media</dt>
              <dd>{t && t.bat.avgPowerW !== null ? fmtPower(t.bat.avgPowerW) : '—'}</dd>
            </div>
          </div>
          <div className="stats-row">
            <div>
              <dt>Energía restante</dt>
              <dd>{t && t.bat.remainingWh !== null ? `${fmt(t.bat.remainingWh, 1)} Wh` : '—'}</dd>
            </div>
            <div>
              <dt>Consumida (sesión)</dt>
              <dd>{t ? `${fmt(t.derived.energyWh, 2)} Wh` : '—'}</dd>
            </div>
          </div>
        </dl>
      </div>
    </section>
  )
}
