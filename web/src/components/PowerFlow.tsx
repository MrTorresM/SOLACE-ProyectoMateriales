import { BatteryCharging, BatteryMedium, Cpu, Lightbulb, Smartphone } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import type { InaRange, Telemetry } from '../../../shared/protocol.ts'
import { useHub } from '../lib/context.tsx'
import { fmt, fmtCurrent, fmtPower } from '../lib/format.ts'
import { AnimatedNumber } from './AnimatedNumber.tsx'

type Tone = 'ok' | 'warn' | 'off'

interface Branch {
  key: 'usb' | 'led' | 'other'
  label: string
  sub: string
  state?: { text: string; tone: Tone }
  icon: ReactNode
  p: number
  estimated?: boolean
  range?: InaRange
}

/** Duración de un ciclo de la animación del flujo: más potencia → más rápido. */
export function flowDuration(p: number): number {
  return Math.min(6, Math.max(0.35, 2.4 / (p + 0.15)))
}

/** Grosor del cable animado (px) según la potencia. */
export function wireWidth(p: number): number {
  return p > 0.02 ? Math.round((2 + Math.min(4, Math.sqrt(p) * 1.6)) * 10) / 10 : 2
}

const RANGE_TEXT: Record<InaRange, string> = { OK: '', FUERA_CAL: 'fuera de calibración', SATURADO: 'saturado' }

/** Estado de la salida USB (interruptor físico o app + MOSFET) y, si está bloqueada, el motivo. */
export function usbState(t: Telemetry): { text: string; tone: Tone } {
  const pr = t.protect
  const hot = pr.temp === 'CORTE' || pr.temp === 'SIN_DATO'
  if (pr.usbOn) return pr.tempGuard === 'manual' ? { text: 'activa · manual, sin protecciones', tone: 'warn' } : { text: 'activa', tone: 'ok' }
  if (!pr.usbRequested) return { text: 'apagada', tone: 'off' }
  if (hot) return { text: 'bloqueada · protección térmica', tone: 'warn' }
  if (pr.usbBlocked) return { text: 'bloqueada · sobrecorriente (30 s)', tone: 'warn' }
  if (pr.usbLowBat) return { text: 'bloqueada · batería baja', tone: 'warn' }
  return { text: 'bloqueada · sin sensor de potencia', tone: 'warn' }
}

/** Estado de la tira LED (sin cortes de protección: solo lo que se pide). */
export function ledState(t: Telemetry): { text: string; tone: Tone } {
  if (t.light.outPct > 0) return { text: `encendida · ${t.light.outPct} %`, tone: 'ok' }
  return { text: 'apagada', tone: 'off' }
}

const SOURCE_SHORT = { solar: 'panel solar', usb: 'cargador USB', unknown: 'panel o USB' } as const

/** Reparte la potencia de la batería entre las ramas (la tercera es la diferencia). */
export function branchPowers(t: Telemetry | null): { usb: number; led: number; other: number; total: number } {
  const usb = Math.max(0, t?.power.usb.p ?? 0)
  const led = Math.max(0, t?.power.led.p ?? 0)
  const bat = t?.power.bat.p ?? 0
  const other = Math.max(0, bat - usb - led)
  return { usb, led, other, total: usb + led + other }
}

export function PowerFlow() {
  const t = useHub((s) => s.telemetry)
  const p = t?.power
  const { usb, led, other, total } = branchPowers(t)
  const charging = t?.bat.state === 'charging'
  const bat = p?.bat.p ?? 0

  const branches: Branch[] = [
    {
      key: 'usb',
      label: 'Carga de celular (USB)',
      sub: p ? `${fmt(p.usb.v, 2)} V · ${fmtCurrent(p.usb.i)}` : 'sin datos',
      state: t ? usbState(t) : undefined,
      icon: <Smartphone size={18} />,
      p: usb,
      range: p?.usb.st,
    },
    {
      key: 'led',
      label: 'Tira LED RGB',
      sub: p ? `${fmt(p.led.v, 2)} V · ${fmtCurrent(p.led.i)}` : 'sin datos',
      state: t ? ledState(t) : undefined,
      icon: <Lightbulb size={18} />,
      p: led,
      range: p?.led.st,
    },
    { key: 'other', label: 'ESP32 y pérdidas', sub: 'diferencia con la batería', icon: <Cpu size={18} />, p: other, estimated: true },
  ]
  const share = (x: number) => (total > 0.001 ? Math.min(100, (x / total) * 100) : 0)
  const anyActive = total > 0.02

  return (
    <section className="card flow-card" aria-label="Flujo de energía">
      <header className="card-head">
        <h2>Flujo de energía</h2>
        <span className="muted small">INA3221 · 3 canales</span>
      </header>

      <div className={`pf-source ${t ? (charging ? 'charging' : anyActive ? 'active' : '') : 'idle'}`}>
        <span className="pf-source-icon" aria-hidden>
          {t && (charging || anyActive) && <span className="pf-ping" />}
          {charging ? <BatteryCharging size={22} /> : <BatteryMedium size={22} />}
        </span>
        <div className="pf-source-text">
          <div className="pf-source-label">Batería · CH1</div>
          <div className={`small ${charging ? 'out-ok' : 'muted'}`}>
            {!t ? 'sin datos' : charging ? `cargando · entra desde ${SOURCE_SHORT[t.bat.source ?? 'unknown']}` : anyActive ? 'entrega energía al sistema' : 'en reposo'}
          </div>
          {p && (
            <div className="muted tiny">
              {fmt(p.bat.v, 2)} V · {fmtCurrent(p.bat.i)}
              {p.bat.st !== 'OK' && <span className="flow-warn"> · {RANGE_TEXT[p.bat.st]}</span>}
            </div>
          )}
        </div>
        <div className="pf-source-value">{t ? <AnimatedNumber value={Math.abs(bat)} format={fmtPower} /> : '—'}</div>
        {/* Reparto de la potencia: barra apilada que se reacomoda con animación */}
        <div className="pf-split" role="img" aria-label={t ? `Reparto: USB ${fmtPower(usb)}, luz ${fmtPower(led)}, ESP32 y pérdidas ${fmtPower(other)}` : 'Sin datos'}>
          {branches.map((b) => (
            <span key={b.key} className={`pf-seg tone-${b.key}`} style={{ flexGrow: share(b.p), opacity: b.p > 0.02 ? 1 : 0 }} />
          ))}
        </div>
      </div>

      <ul className="pf-branches">
        {branches.map((b) => {
          const active = b.p > 0.02
          const style = { '--dur': `${flowDuration(b.p)}s`, '--trunk-dur': `${flowDuration(total)}s`, '--w': `${wireWidth(b.p)}px` } as CSSProperties
          return (
            <li key={b.key} className={`pf-branch tone-${b.key} ${active ? 'active' : 'idle'} ${b.estimated ? 'estimated' : ''}`} style={style}>
              <span className={`pf-wire ${anyActive ? 'live' : ''}`} aria-hidden>
                <span className="pf-trunk" />
                <span className="pf-arm">{active && <span className="pf-spark" />}</span>
              </span>
              <span className={`pf-icon tone-${b.key}`} aria-hidden>
                {active && <span className="pf-ping" />}
                {b.icon}
              </span>
              <div className="pf-text">
                <div className="flow-label">
                  {b.label}
                  {b.estimated && (
                    <span className="est" title="Valor estimado, no medido directamente">
                      est.
                    </span>
                  )}
                </div>
                <div className="muted tiny">
                  {b.sub}
                  {b.range && b.range !== 'OK' && <span className="flow-warn"> · {RANGE_TEXT[b.range]}</span>}
                </div>
                {b.state && <div className={`tiny out-state out-${b.state.tone}`}>{b.state.text}</div>}
              </div>
              <div className="pf-value">
                <div className="flow-value">{t ? <AnimatedNumber value={b.p} format={fmtPower} /> : '—'}</div>
                <div className="muted tiny">{t ? `${Math.round(share(b.p))} %` : ''}</div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
