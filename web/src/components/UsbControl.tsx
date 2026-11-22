import { Hand, Power, ShieldCheck, Smartphone, ToggleLeft, ToggleRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { Command, TempGuard } from '../../../shared/protocol.ts'
import { useHub } from '../lib/context.tsx'
import { fmt } from '../lib/format.ts'
import { usbState } from './PowerFlow.tsx'

/** Tras una interacción local, mostrar lo pedido este tiempo mientras llega la confirmación (evita "saltos"). */
const LOCAL_HOLD_MS = 1200

export const GUARD_HINT: Record<TempGuard, string> = {
  auto: 'El USB se apaga solo si hace falta: temperatura ≥ 50 °C o sin BMP280, sin INA3221, batería bajo 6,6 V o sobrecorriente.',
  manual: 'Sin protecciones: el USB obedece solo al interruptor o a este botón (el último que actúe). Las alertas siguen avisando.',
}

/** Salida USB de 5 V (carga de celular) y su protección térmica. */
export function UsbControl({ send }: { send: (cmd: Command) => Promise<void> }) {
  const t = useHub((s) => s.telemetry)
  const pr = t?.protect
  // Lo que se muestra es SIEMPRE el estado del dispositivo (interruptor físico y app comparten
  // un único estado). Solo justo después de un clic se muestra lo pedido hasta que llega la
  // confirmación; al vencer la espera se vuelve a la telemetría aunque no haya cambiado nada.
  const [local, setLocal] = useState<{ requested?: boolean; guard?: TempGuard; at: number }>({ at: 0 })
  const [, rerender] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  const holding = Date.now() - local.at < LOCAL_HOLD_MS
  const requested = holding && local.requested !== undefined ? local.requested : (pr?.usbRequested ?? false)
  const guard: TempGuard = holding && local.guard !== undefined ? local.guard : (pr?.tempGuard ?? 'manual')

  const hold = (patch: { requested?: boolean; guard?: TempGuard }) => {
    setLocal((l) => ({ ...(Date.now() - l.at < LOCAL_HOLD_MS ? l : {}), ...patch, at: Date.now() }))
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => rerender((x) => x + 1), LOCAL_HOLD_MS + 20)
  }
  const toggle = () => {
    const on = !requested
    hold({ requested: on })
    void send({ type: 'setUsb', on })
  }
  const pickGuard = (mode: TempGuard) => {
    if (mode === guard) return
    hold({ guard: mode })
    void send({ type: 'setTempGuard', mode })
  }

  const on = pr?.usbOn ?? false
  const state = t ? usbState(t) : null
  const blocked = requested && !on && t !== null

  return (
    <section className="ctl-section usb-ctl" aria-label="Carga de celular">
      <div className="usb-row">
        <span className={`usb-ctl-icon ${on ? 'on' : ''} ${blocked ? 'blocked' : ''}`} aria-hidden>
          {on && <span className="pf-ping" />}
          <Smartphone size={20} />
        </span>
        <div className="usb-text">
          <h3 className="ctl-title">Carga de celular</h3>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={state?.text ?? 'none'}
              className={`tiny out-state out-${state?.tone ?? 'off'}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              {state ? `USB 5 V · ${state.text}` : 'USB 5 V · sin datos'}
            </motion.div>
          </AnimatePresence>
        </div>
        <button className={`power ${requested ? 'on' : ''} ${blocked ? 'blocked' : ''}`} role="switch" aria-checked={requested} aria-label="Encender o apagar la carga de celular" onClick={toggle}>
          <Power size={20} aria-hidden />
        </button>
      </div>

      <div className="field-label">
        Protecciones del USB
        <span className="field-value">{t?.env.tempC != null ? `banco ${fmt(t.env.tempC, 1)} °C` : 'sin dato'}</span>
      </div>
      <div className="segmented big" role="radiogroup" aria-label="Protecciones del USB">
        {(['auto', 'manual'] as const).map((m) => (
          <button key={m} role="radio" aria-checked={guard === m} className={guard === m ? 'active' : ''} onClick={() => pickGuard(m)}>
            {guard === m && <motion.span layoutId="guard-pill" className={`seg-pill ${m === 'manual' ? 'warn' : ''}`} transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            <span className="seg-label">
              {m === 'auto' ? <ShieldCheck size={16} aria-hidden /> : <Hand size={16} aria-hidden />}
              {m === 'auto' ? 'Automáticas' : 'Manual'}
            </span>
          </button>
        ))}
      </div>
      <p className={`tiny hint guard-hint ${guard === 'manual' ? 'out-warn' : 'muted'}`}>{GUARD_HINT[guard]}</p>

      {t && (
        <p className="muted tiny switch-state">
          {t.switches.usb ? <ToggleRight size={14} aria-hidden /> : <ToggleLeft size={14} aria-hidden />}
          Interruptor físico: {t.switches.usb ? 'cerrado' : 'abierto'} · cada movimiento enciende o apaga, igual que este botón
        </p>
      )}
    </section>
  )
}
