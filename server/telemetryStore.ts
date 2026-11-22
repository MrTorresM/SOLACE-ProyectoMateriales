import fs from 'node:fs'
import path from 'node:path'
import type { Derived, LiveTelemetry, Telemetry } from '../shared/protocol.ts'

/** Punto compacto para las gráficas del historial. */
export interface HistoryPoint {
  t: number
  soc: number | null
  batV: number
  batI: number
  batP: number
  usbP: number
  ledP: number
  lux: number | null
  tempC: number | null
  pressHpa: number | null
}

export const CSV_HEADER =
  't_iso,t_ms,soc_pct,bat_state,bat_v,bat_a,bat_w,bat_st,usb_v,usb_a,usb_w,usb_st,led_v,led_a,led_w,led_st,lux,lux_state,temp_c,press_hpa,' +
  'temp_state,temp_guard,usb_requested,usb_on,sw_usb,sw_light,charge_source,charge_w,mode,light_on,color,brightness,out_pct,remaining_wh,avg_w,autonomy_min,energy_wh,alerts'

export function toCsvRow(t: LiveTelemetry): string {
  const n = (x: number | null) => (x === null ? '' : String(x))
  const ch = (c: LiveTelemetry['power']['bat']) => [c.v, c.i, c.p, c.st]
  return [
    new Date(t.receivedAt).toISOString(),
    t.receivedAt,
    n(t.bat.soc),
    t.bat.state,
    ...ch(t.power.bat),
    ...ch(t.power.usb),
    ...ch(t.power.led),
    n(t.env.lux),
    t.env.luxState,
    n(t.env.tempC),
    n(t.env.pressHpa),
    t.protect.temp,
    t.protect.tempGuard,
    t.protect.usbRequested ? 1 : 0,
    t.protect.usbOn ? 1 : 0,
    t.switches.usb ? 1 : 0,
    t.switches.light ? 1 : 0,
    t.bat.source ?? '',
    n(t.bat.chargeW),
    t.light.mode,
    t.light.on ? 1 : 0,
    t.light.color,
    t.light.brightness,
    t.light.outPct,
    n(t.bat.remainingWh),
    n(t.bat.avgPowerW),
    n(t.bat.autonomyMin),
    t.derived.energyWh.toFixed(4),
    t.alerts.join('|'),
  ].join(',')
}

const MAX_GAP_S = 5

export class TelemetryStore {
  private points: HistoryPoint[] = []
  private lastAt: number | null = null
  private energyWh = 0
  private csv: fs.WriteStream | null = null
  latest: LiveTelemetry | null = null
  csvPath: string | null = null

  constructor(
    private readonly capacity = 1800,
    logDir: string | null = null,
  ) {
    if (logDir) {
      fs.mkdirSync(logDir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
      this.csvPath = path.join(logDir, `sesion-${stamp}.csv`)
      this.csv = fs.createWriteStream(this.csvPath, { flags: 'a' })
      this.csv.write(CSV_HEADER + '\n')
    }
  }

  /** El dispositivo se desconectó: ya no hay "última telemetría" vigente (el historial se conserva). */
  clearLatest() {
    this.latest = null
  }

  ingest(t: Telemetry, receivedAt: number = Date.now()): LiveTelemetry {
    const dt = this.lastAt === null ? 0 : Math.min(MAX_GAP_S, Math.max(0, (receivedAt - this.lastAt) / 1000))
    this.lastAt = receivedAt
    const p = t.power.bat.p
    if (p > 0) this.energyWh += (p * dt) / 3600
    const derived: Derived = { energyWh: round(this.energyWh, 4) }
    const live: LiveTelemetry = { ...t, receivedAt, derived }
    this.latest = live
    this.points.push({
      t: receivedAt,
      soc: t.bat.soc,
      batV: t.power.bat.v,
      batI: t.power.bat.i,
      batP: t.power.bat.p,
      usbP: t.power.usb.p,
      ledP: t.power.led.p,
      lux: t.env.lux,
      tempC: t.env.tempC,
      pressHpa: t.env.pressHpa,
    })
    if (this.points.length > this.capacity) this.points.splice(0, this.points.length - this.capacity)
    this.csv?.write(toCsvRow(live) + '\n')
    return live
  }

  history(sinceMs?: number): HistoryPoint[] {
    if (sinceMs === undefined) return [...this.points]
    return this.points.filter((p) => p.t >= sinceMs)
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.csv) return resolve()
      this.csv.end(() => resolve())
      this.csv = null
    })
  }
}

function round(x: number, d: number) {
  const f = 10 ** d
  return Math.round(x * f) / f
}
