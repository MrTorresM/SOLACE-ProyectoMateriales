import { Hand, Moon, Sparkles, Sun } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { useHub } from '../lib/context.tsx'
import { colorName, fmtLux, fmtPower, luxLabel } from '../lib/format.ts'
import { ARCH_PATH } from './Logo.tsx'

/** Visualización de la tira LED: el arco con su núcleo encendido del color real de la tira. */
export function BeaconLamp({ on, color, brightness }: { on: boolean; color: string; brightness: number }) {
  const level = on ? Math.max(0.15, brightness / 100) : 0
  return (
    <svg className="lamp" viewBox="60 80 380 420" role="img" aria-label={on ? `Luz encendida, color ${colorName(color)}, ${brightness}%` : 'Luz apagada'}>
      <defs>
        <radialGradient id="glow">
          <stop offset="0%" stopColor={color} stopOpacity={0.9} />
          <stop offset="45%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </radialGradient>
        <clipPath id="lamp-legs">
          <polygon points="0,0 500,0 500,400 404,392 346,368 154,368 96,392 0,400" />
        </clipPath>
      </defs>

      {/* Halo de luz (proporcional al brillo) */}
      <motion.circle
        cx={250}
        cy={295}
        fill="url(#glow)"
        initial={false}
        animate={{ r: on ? 120 + 110 * level : 0, opacity: level }}
        transition={{ type: 'spring', stiffness: 60, damping: 16 }}
        className={on ? 'breathe' : undefined}
      />

      {/* Haces de luz hacia abajo (como en el lockup de marca) */}
      <AnimatePresence>
        {on && (
          <motion.g key="rays" initial={{ opacity: 0, scaleY: 0.3 }} animate={{ opacity: 0.55 * level + 0.25, scaleY: 1 }} exit={{ opacity: 0, scaleY: 0.3 }} transition={{ duration: 0.5 }} style={{ originY: '340px', originX: '250px' }}>
            <polygon points="226,352 238,352 205,470 168,470" fill={color} opacity={0.7} />
            <polygon points="262,352 274,352 332,470 295,470" fill={color} opacity={0.7} />
          </motion.g>
        )}
      </AnimatePresence>

      <path d={ARCH_PATH} fill="none" stroke="var(--brand-arch)" strokeWidth={58} strokeLinejoin="round" clipPath="url(#lamp-legs)" />
      <circle className="lamp-core" cx={250} cy={295} r={46} style={{ fill: on ? color : 'var(--core-off)' }} stroke="var(--core-ring)" strokeWidth={on ? 0 : 3} />
    </svg>
  )
}

export function BeaconHero() {
  const t = useHub((s) => s.telemetry)
  const online = useHub((s) => s.device.online)

  if (!t) {
    return (
      <section className="card hero" aria-busy="true">
        <div className="hero-lamp">
          <BeaconLamp on={false} color="#FFFFFF" brightness={0} />
        </div>
        <div className="hero-info">
          <p className="eyebrow">Iluminación</p>
          <h1 className="hero-title">{online ? 'Recibiendo…' : 'Esperando al dispositivo'}</h1>
          <p className="muted">
            {online ? 'Conectado, esperando la primera lectura.' : 'Enciende la ESP32 o ejecuta npm run simulate en el Mac.'}
          </p>
          <div className="skeleton-lines" aria-hidden>
            <span />
            <span />
          </div>
        </div>
      </section>
    )
  }

  const { light } = t
  const ambient = t.env.lux
  const dark = ambient !== null && ambient < light.luxOn
  const lit = light.outPct > 0
  const title = lit ? 'Encendida' : 'Apagada'

  return (
    <section className="card hero">
      <div className="hero-lamp">
        <BeaconLamp on={lit} color={light.color} brightness={light.outPct} />
      </div>
      <div className="hero-info">
        <p className="eyebrow">Iluminación · tira RGB</p>
        <AnimatePresence mode="wait" initial={false}>
          <motion.h1 key={title} className="hero-title" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}>
            {title}
          </motion.h1>
        </AnimatePresence>

        <div className="chips">
          <span className={`chip mode-${light.mode}`}>
            {light.mode === 'auto' ? <Sparkles size={14} aria-hidden /> : <Hand size={14} aria-hidden />}
            {light.mode === 'auto' ? 'Automático' : 'Manual'}
          </span>
          {light.on && (
            <span className="chip">
              <span className="swatch" style={{ background: light.color }} aria-hidden />
              {colorName(light.color)} · {light.brightness}%
            </span>
          )}
          <span className="chip" title="Consumo medido de la tira (INA3221 CH3)">
            {fmtPower(t.power.led.p)}
          </span>
        </div>

        <div className="ambient">
          {dark ? <Moon size={18} aria-hidden /> : <Sun size={18} aria-hidden />}
          <div>
            <div className="ambient-value">{fmtLux(ambient)}</div>
            <div className="muted small">Luz ambiente · {luxLabel(ambient)}</div>
          </div>
        </div>

        {light.mode === 'auto' && (
          <p className="muted small">
            Se enciende en blanco en ~1 s bajo {light.luxOn} lx y se apaga tras 3 s sobre {light.luxOff} lx.
          </p>
        )}
      </div>
    </section>
  )
}
