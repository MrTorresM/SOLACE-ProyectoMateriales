import { useMemo, useRef, useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { useHub } from '../lib/context.tsx'
import type { HistoryPoint } from '../lib/store.ts'
import { fmt } from '../lib/format.ts'

interface Series {
  key: string
  label: string
  get: (p: HistoryPoint) => number | null
  cls: string
  dashed?: boolean
}

interface Tab {
  id: string
  label: string
  unit: string
  decimals: number
  series: Series[]
  min?: number
  max?: number
}

export const TABS: Tab[] = [
  {
    id: 'power',
    label: 'Potencia',
    unit: 'W',
    decimals: 2,
    min: 0,
    series: [
      { key: 'bat', label: 'Batería', get: (p) => p.batP, cls: 's-bat' },
      { key: 'usb', label: 'USB 5 V', get: (p) => p.usbP, cls: 's-usb' },
      { key: 'led', label: 'Tira LED', get: (p) => p.ledP, cls: 's-led' },
    ],
  },
  { id: 'soc', label: 'Batería', unit: '%', decimals: 0, min: 0, max: 100, series: [{ key: 'soc', label: 'Carga', get: (p) => p.soc, cls: 's-bat' }] },
  { id: 'lux', label: 'Luz', unit: 'lx', decimals: 0, min: 0, series: [{ key: 'lux', label: 'Luz ambiente', get: (p) => p.lux, cls: 's-radio' }] },
  {
    id: 'env',
    label: 'Temperatura',
    unit: '°C',
    decimals: 1,
    series: [{ key: 'temp', label: 'Temperatura', get: (p) => p.tempC, cls: 's-usb' }],
  },
]

const WINDOWS = [
  { s: 120, label: '2 min' },
  { s: 600, label: '10 min' },
  { s: 1800, label: '30 min' },
]

const H = 220
/** Si entre dos muestras pasan más de esto, la línea se corta. */
const GAP_MS = 5000
const PAD = { l: 44, r: 12, t: 12, b: 26 }

/** Escala "bonita" para el eje Y. */
export function niceRange(lo: number, hi: number): [number, number, number] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1, 0.25]
  if (hi - lo < 1e-6) {
    const pad = Math.abs(hi) * 0.1 || 1
    lo -= pad
    hi += pad
  }
  const span = hi - lo
  const base = 10 ** Math.floor(Math.log10(span / 4))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * base).find((s) => span / s <= 5) ?? base * 10
  return [Math.floor(lo / step + 1e-9) * step, Math.ceil(hi / step - 1e-9) * step, step]
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(600)
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, e!.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export function TrendChart() {
  const history = useHub((s) => s.history)
  const [tabId, setTabId] = useState('power')
  const [windowS, setWindowS] = useState(120)
  const [hover, setHover] = useState<number | null>(null)
  const [ref, width] = useWidth<HTMLDivElement>()
  const tab = TABS.find((t) => t.id === tabId)!

  const now = history.length ? history[history.length - 1]!.t : Date.now()
  const pts = useMemo(() => history.filter((p) => p.t >= now - windowS * 1000), [history, now, windowS])

  const [y0, y1, yStep] = useMemo(() => {
    const vals = pts.flatMap((p) => tab.series.map((s) => s.get(p))).filter((v): v is number => v !== null && Number.isFinite(v))
    if (!vals.length) return niceRange(tab.min ?? 0, tab.max ?? 1)
    const lo = tab.min ?? Math.min(...vals)
    const hi = tab.max ?? Math.max(...vals)
    return niceRange(Math.min(lo, ...vals), Math.max(hi, ...vals))
  }, [pts, tab])

  const iw = width - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b
  const t0 = now - windowS * 1000
  const x = (t: number) => PAD.l + ((t - t0) / (windowS * 1000)) * iw
  const y = (v: number) => PAD.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih

  const paths = tab.series.map((s) => {
    let d = ''
    let pen = false
    let prevT = -Infinity
    for (const p of pts) {
      const v = s.get(p)
      if (p.t - prevT > GAP_MS) pen = false // hueco sin datos: no unir con una recta
      prevT = p.t
      if (v === null || !Number.isFinite(v)) {
        pen = false
        continue
      }
      d += `${pen ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(v).toFixed(1)}`
      pen = true
    }
    return { s, d }
  })

  const ticks: number[] = []
  for (let v = y0; v <= y1 + yStep / 2; v += yStep) ticks.push(Math.round(v / yStep) * yStep)
  const tickDecimals = yStep >= 1 ? 0 : yStep >= 0.1 ? 1 : 2
  const hoverPoint = hover !== null ? pts[hover] : null

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pts.length) return
    const rect = e.currentTarget.getBoundingClientRect()
    const tx = t0 + ((e.clientX - rect.left - PAD.l) / iw) * windowS * 1000
    let best = 0
    for (let k = 1; k < pts.length; k++) if (Math.abs(pts[k]!.t - tx) < Math.abs(pts[best]!.t - tx)) best = k
    setHover(best)
  }

  return (
    <section className="card chart-card" aria-label="Historial">
      <header className="card-head wrap">
        <div className="tabs" role="tablist" aria-label="Variable">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={t.id === tabId} className={t.id === tabId ? 'active' : ''} onClick={() => setTabId(t.id)}>
              {t.id === tabId && <motion.span layoutId="tab-pill" className="tab-pill" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
              <span className="tab-label">{t.label}</span>
            </button>
          ))}
        </div>
        <div className="segmented small" role="radiogroup" aria-label="Ventana de tiempo">
          {WINDOWS.map((w) => (
            <button key={w.s} role="radio" aria-checked={w.s === windowS} className={w.s === windowS ? 'active' : ''} onClick={() => setWindowS(w.s)}>
              {w.label}
            </button>
          ))}
        </div>
      </header>

      <div className="legend">
        {tab.series.map((s) => (
          <span key={s.key} className="legend-item">
            <span className={`legend-swatch ${s.cls} ${s.dashed ? 'dashed' : ''}`} />
            {s.label}
            {hoverPoint && <strong>{fmt(s.get(hoverPoint), tab.decimals)} {tab.unit}</strong>}
          </span>
        ))}
        {hoverPoint && <span className="muted tiny">{new Date(hoverPoint.t).toLocaleTimeString()}</span>}
      </div>

      <div className="chart" ref={ref}>
        {pts.length < 2 ? (
          <div className="chart-empty muted">Las gráficas aparecen cuando llegan datos.</div>
        ) : (
          <svg width={width} height={H} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`Gráfica de ${tab.label}`}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={PAD.l} x2={width - PAD.r} y1={y(v)} y2={y(v)} className="gridline" />
                <text x={PAD.l - 8} y={y(v) + 4} className="axis" textAnchor="end">
                  {fmt(v, tickDecimals)}
                </text>
              </g>
            ))}
            <text x={PAD.l} y={H - 6} className="axis">
              −{WINDOWS.find((w) => w.s === windowS)?.label}
            </text>
            <text x={width - PAD.r} y={H - 6} className="axis" textAnchor="end">
              ahora
            </text>
            {paths.map(({ s, d }) => (
              <path key={s.key} d={d} className={`line ${s.cls}`} strokeDasharray={s.dashed ? '5 5' : undefined} />
            ))}
            {hoverPoint && (
              <g>
                <line x1={x(hoverPoint.t)} x2={x(hoverPoint.t)} y1={PAD.t} y2={H - PAD.b} className="crosshair" />
                {tab.series.map((s) => {
                  const v = s.get(hoverPoint)
                  return v === null ? null : <circle key={s.key} cx={x(hoverPoint.t)} cy={y(v)} r={4} className={`dot-point ${s.cls}`} />
                })}
              </g>
            )}
          </svg>
        )}
      </div>
    </section>
  )
}
