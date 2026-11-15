import { ChevronUp, Hand, Loader2, Power, Radar, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { HexColorPicker } from 'react-colorful'
import type { Command, LightState } from '../../../shared/protocol.ts'
import { useHub, useHubClient, useStore } from '../lib/context.tsx'
import { makeId } from '../lib/hubClient.ts'

export const PRESETS = [
  { hex: '#FFFFFF', name: 'Blanco' },
  { hex: '#FFB46B', name: 'Cálido' },
  { hex: '#E2A64B', name: 'Ámbar' },
  { hex: '#FF0000', name: 'Rojo' },
  { hex: '#00FF00', name: 'Verde' },
  { hex: '#0000FF', name: 'Azul' },
  { hex: '#B400FF', name: 'Violeta' },
]

const DEFAULT_DRAFT: LightState = { mode: 'auto', on: false, color: '#FFFFFF', brightness: 80, luxOn: 15, luxOff: 40 }
/** Tras una interacción local, ignorar la telemetría durante este tiempo (evita "saltos" del control). */
const LOCAL_HOLD_MS = 1500
const THROTTLE_MS = 140

export function ControlPanel() {
  const light = useHub((s) => s.telemetry?.light)
  const online = useHub((s) => s.device.online)
  const client = useHubClient()
  const store = useStore()
  const [draft, setDraft] = useState<LightState>(light ?? DEFAULT_DRAFT)
  const [busy, setBusy] = useState(0)
  const [open, setOpen] = useState(false)
  const lastLocal = useRef(0)
  const throttle = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null; pending: Command | null }>({ last: 0, timer: null, pending: null })

  // Sincroniza el borrador con lo que reporta el dispositivo cuando el usuario no está interactuando.
  useEffect(() => {
    if (light && Date.now() - lastLocal.current > LOCAL_HOLD_MS) setDraft((d) => ({ ...d, ...light, ...(light.mode === 'auto' ? { color: d.color, brightness: d.brightness, on: d.on } : {}) }))
  }, [light])

  const send = useCallback(
    async (cmd: Command) => {
      setBusy((b) => b + 1)
      const ack = await client.sendCommand(cmd)
      setBusy((b) => b - 1)
      if (!ack.ok) store.dispatch({ type: 'toast', toast: { id: makeId(), kind: 'error', text: ack.error ?? 'No se pudo aplicar' } })
    },
    [client, store],
  )

  /** Para arrastres (color, brillo): máximo un comando cada THROTTLE_MS y siempre el último. */
  const sendThrottled = useCallback(
    (cmd: Command) => {
      const th = throttle.current
      th.pending = cmd
      const fire = () => {
        th.last = Date.now()
        th.timer = null
        if (th.pending) void send(th.pending)
        th.pending = null
      }
      const wait = THROTTLE_MS - (Date.now() - th.last)
      if (wait <= 0) fire()
      else if (!th.timer) th.timer = setTimeout(fire, wait)
    },
    [send],
  )

  const touch = (patch: Partial<LightState>) => {
    lastLocal.current = Date.now()
    setDraft((d) => ({ ...d, ...patch }))
  }

  const setMode = (mode: LightState['mode']) => {
    touch({ mode })
    void send({ type: 'setMode', mode })
  }
  const setPower = (on: boolean) => {
    touch({ on, mode: 'manual' })
    void send({ type: 'setLight', on })
  }
  const setColor = (hex: string, throttled = true) => {
    const color = hex.toUpperCase()
    touch({ color, on: true, mode: 'manual' })
    const cmd: Command = { type: 'setLight', color }
    throttled ? sendThrottled(cmd) : void send(cmd)
  }
  const setBrightness = (brightness: number) => {
    touch({ brightness, on: true, mode: 'manual' })
    sendThrottled({ type: 'setLight', brightness })
  }

  const [luxOn, setLuxOn] = useState(draft.luxOn)
  const [luxOff, setLuxOff] = useState(draft.luxOff)
  useEffect(() => {
    if (light) {
      setLuxOn(light.luxOn)
      setLuxOff(light.luxOff)
    }
  }, [light?.luxOn, light?.luxOff]) // eslint-disable-line react-hooks/exhaustive-deps
  const autoDirty = light ? luxOn !== light.luxOn || luxOff !== light.luxOff : false
  const autoValid = luxOff > luxOn

  const manual = draft.mode === 'manual'
  const disabled = !online

  return (
    <aside className={`controls ${open ? 'open' : ''}`} aria-label="Panel de control">
      <header className="controls-head">
        <h2>Control de luz</h2>
        <div className="controls-head-right">
          {busy > 0 && <Loader2 size={16} className="spin muted" aria-label="Enviando" />}
          <button className="icon-btn sheet-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? 'Contraer panel' : 'Expandir panel'}>
            <ChevronUp size={18} />
          </button>
        </div>
      </header>

      {disabled && <p className="notice">El dispositivo no está conectado. Los controles se activarán cuando vuelva.</p>}

      <fieldset disabled={disabled} className="controls-body">
        <div className="quick">
          <div className="segmented big" role="radiogroup" aria-label="Modo de la luz">
            {(['auto', 'manual'] as const).map((m) => (
              <button key={m} role="radio" aria-checked={draft.mode === m} className={draft.mode === m ? 'active' : ''} onClick={() => setMode(m)}>
                {draft.mode === m && <motion.span layoutId="mode-pill" className="seg-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <span className="seg-label">
                  {m === 'auto' ? <Sparkles size={16} aria-hidden /> : <Hand size={16} aria-hidden />}
                  {m === 'auto' ? 'Automático' : 'Manual'}
                </span>
              </button>
            ))}
          </div>

          <button
            className={`power ${manual && draft.on ? 'on' : ''}`}
            role="switch"
            aria-checked={manual && draft.on}
            aria-label="Encender o apagar la luz"
            onClick={() => setPower(!(manual && draft.on))}
          >
            <Power size={20} aria-hidden />
          </button>
        </div>

        <p className="muted tiny hint">
          {manual ? 'Controlas la tira desde aquí.' : 'La luz se enciende sola cuando oscurece. Tocar un control pasa a Manual.'}
        </p>

        <div className={`manual-controls ${manual ? '' : 'dim'}`}>
          <label className="field-label">Color</label>
          <div className="picker">
            <HexColorPicker color={draft.color} onChange={(c) => setColor(c)} />
          </div>
          <div className="presets" role="list">
            {PRESETS.map((p) => (
              <button
                key={p.hex}
                role="listitem"
                className={`preset ${draft.color === p.hex ? 'selected' : ''}`}
                style={{ background: p.hex }}
                aria-label={p.name}
                title={p.name}
                onClick={() => setColor(p.hex, false)}
              />
            ))}
          </div>

          <label className="field-label" htmlFor="brightness">
            Brillo <span className="field-value">{draft.brightness}%</span>
          </label>
          <input
            id="brightness"
            type="range"
            min={0}
            max={100}
            step={1}
            value={draft.brightness}
            onChange={(e) => setBrightness(Number(e.target.value))}
            style={{ ['--fill' as string]: `${draft.brightness}%`, ['--thumb' as string]: draft.color }}
            className="slider"
          />
        </div>

        <details className="auto-settings">
          <summary>Ajustes del modo automático</summary>
          <label className="field-label" htmlFor="luxOn">
            Encender bajo <span className="field-value">{luxOn} lx</span>
          </label>
          <input id="luxOn" type="range" min={0} max={200} value={luxOn} onChange={(e) => setLuxOn(Number(e.target.value))} className="slider" style={{ ['--fill' as string]: `${luxOn / 2}%` }} />
          <label className="field-label" htmlFor="luxOff">
            Apagar sobre <span className="field-value">{luxOff} lx</span>
          </label>
          <input id="luxOff" type="range" min={1} max={400} value={luxOff} onChange={(e) => setLuxOff(Number(e.target.value))} className="slider" style={{ ['--fill' as string]: `${luxOff / 4}%` }} />
          {!autoValid && <p className="field-error">“Apagar sobre” debe ser mayor que “Encender bajo” (histéresis).</p>}
          <button className="btn" disabled={!autoDirty || !autoValid} onClick={() => void send({ type: 'setAuto', luxOn, luxOff })}>
            Guardar umbrales
          </button>
        </details>

        <button className="btn ghost" onClick={() => void send({ type: 'identify' })}>
          <Radar size={16} aria-hidden /> Identificar dispositivo
        </button>
      </fieldset>
    </aside>
  )
}
