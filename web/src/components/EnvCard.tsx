import { Gauge, Sun, Thermometer } from 'lucide-react'
import { useHub } from '../lib/context.tsx'
import { fmt, fmtLux, luxLabel } from '../lib/format.ts'
import { AnimatedNumber } from './AnimatedNumber.tsx'
import { ALERT_THRESHOLDS } from '../../../shared/deviceLogic.ts'
import type { TempState } from '../../../shared/protocol.ts'

/** Posición 0–100 % de un valor de lux en escala logarítmica (0.1 lx … 100 klx). */
export function luxToPct(lux: number | null): number {
  if (lux === null || lux <= 0.1) return 0
  return Math.min(100, (Math.log10(lux / 0.1) / 6) * 100)
}

/** Con el USB en manual la temperatura no corta el USB. */
export const TEMP_LABEL_MANUAL: Record<TempState, string> = {
  NORMAL: 'manual · normal',
  ALARMA: 'manual · alarma (≥ 45 °C)',
  CORTE: 'manual · sobre el corte (≥ 50 °C), el USB no se apaga',
  SIN_DATO: 'manual · sin dato del sensor, el USB no se apaga',
}

export const TEMP_LABEL: Record<TempState, string> = {
  NORMAL: 'normal',
  ALARMA: 'alarma (≥ 45 °C)',
  CORTE: 'corte: USB apagado hasta bajar de 40 °C',
  SIN_DATO: 'sin dato del sensor: USB apagado',
}

/** Posición 0–100 % de la presión entre 700 y 1050 hPa (de ~3000 m a nivel del mar). */
export function pressToPct(hPa: number | null): number {
  if (hPa === null) return 0
  return Math.max(0, Math.min(100, ((hPa - 700) / 350) * 100))
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
  const press = t?.env.pressHpa ?? null
  const lux = t?.env.lux ?? null
  const tempState = t?.protect.temp ?? null
  const manual = t?.protect.tempGuard === 'manual'
  const hot = temp !== null && temp >= ALERT_THRESHOLDS.tempHighC

  return (
    <section className="card env" aria-label="Ambiente">
      <header className="card-head">
        <h2>Ambiente</h2>
        <span className="muted small">BMP280 · BH1750</span>
      </header>

      <div className="env-item">
        <div className="env-head">
          <Thermometer size={18} aria-hidden />
          <span>Temperatura del banco</span>
          <strong className="env-value">{temp === null ? '—' : <AnimatedNumber value={temp} format={(x) => `${fmt(x, 1)} °C`} />}</strong>
        </div>
        <Scale
          pct={temp === null ? 0 : Math.max(0, Math.min(100, (temp / 60) * 100))}
          tone={hot ? 'warn' : undefined}
          marks={[
            { at: (ALERT_THRESHOLDS.tempHighC / 60) * 100, label: `${ALERT_THRESHOLDS.tempHighC}°` },
            { at: (ALERT_THRESHOLDS.tempCutC / 60) * 100, label: `${ALERT_THRESHOLDS.tempCutC}°` },
          ]}
        />
        {tempState && <p className={`muted tiny temp-state temp-${tempState.toLowerCase()}`}>Protección térmica: {(manual ? TEMP_LABEL_MANUAL : TEMP_LABEL)[tempState]}</p>}
      </div>

      <div className="env-item">
        <div className="env-head">
          <Gauge size={18} aria-hidden />
          <span>Presión</span>
          <strong className="env-value">{press === null ? '—' : <AnimatedNumber value={press} format={(x) => `${fmt(x, 0)} hPa`} />}</strong>
        </div>
        <Scale
          pct={pressToPct(press)}
          marks={[
            { at: pressToPct(750), label: '750' },
            { at: pressToPct(1013), label: '1013 hPa' },
          ]}
        />
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
