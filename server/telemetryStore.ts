import fs from 'node:fs'
import path from 'node:path'
import type { Derived, LiveTelemetry, Telemetry } from '../shared/protocol.ts'
import { PACK_ENERGY_WH } from '../shared/deviceLogic.ts'

/** Punto compacto para las gráficas del historial. */
export interface HistoryPoint {
  t: number
  soc: number
  batV: number
  batI: number
  batP: number
  usbP: number
  radioP: number
  ledP: number
  lux: number | null
  tempC: number | null
  hum: number | null
}

export const CSV_HEADER = 't_iso,t_ms,soc_pct,bat_v,bat_a,bat_w,usb_v,usb_a,usb_w,radio_v,radio_a,radio_w,led_w_est,lux,lux_ambient,temp_c,hum_pct,mode,light_on,color,brightness,energy_wh,alerts'

export function toCsvRow(t: LiveTelemetry): string {
  const n = (x: number | null) => (x === null ? '' : String(x))
  return [
    new Date(t.receivedAt).toISOString(),
    t.receivedAt,
    t.bat.soc,
    t.power.bat.v,
    t.power.bat.i,
    t.power.bat.p,
    t.power.usb.v,
    t.power.usb.i,
    t.power.usb.p,
    t.power.radio.v,
    t.power.radio.i,
    t.power.radio.p,
    t.power.led.p,
    n(t.env.lux),
    n(t.env.luxAmbient),
    n(t.env.tempC),
    n(t.env.hum),
    t.light.mode,
    t.light.on ? 1 : 0,
    t.light.color,
    t.light.brightness,
    t.derived.energyWh.toFixed(4),
    t.alerts.join('|'),
  ].join(',')
}

const EMA_TAU_S = 60
const MAX_GAP_S = 5

export class TelemetryStore {
  private points: HistoryPoint[] = []
  private lastAt: number | null = null
  private energyWh = 0
  private avgPowerW: number | null = null
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

  ingest(t: Telemetry, receivedAt: number = Date.now()): LiveTelemetry {
    const dt = this.lastAt === null ? 0 : Math.min(MAX_GAP_S, Math.max(0, (receivedAt - this.lastAt) / 1000))
    this.lastAt = receivedAt
    const p = t.power.bat.p
    if (p > 0) this.energyWh += (p * dt) / 3600
    if (this.avgPowerW === null) this.avgPowerW = p
    else {
      const alpha = 1 - Math.exp(-dt / EMA_TAU_S)
      this.avgPowerW += alpha * (p - this.avgPowerW)
    }
    const remainingWh = (t.bat.soc / 100) * PACK_ENERGY_WH
    const derived: Derived = {
      energyWh: round(this.energyWh, 4),
      avgPowerW: round(this.avgPowerW, 3),
      remainingWh: round(remainingWh, 2),
      autonomyMin: !t.bat.charging && this.avgPowerW > 0.05 ? Math.round((remainingWh / this.avgPowerW) * 60) : null,
    }
    const live: LiveTelemetry = { ...t, receivedAt, derived }
    this.latest = live
    this.points.push({
      t: receivedAt,
      soc: t.bat.soc,
      batV: t.power.bat.v,
      batI: t.power.bat.i,
      batP: t.power.bat.p,
      usbP: t.power.usb.p,
      radioP: t.power.radio.p,
      ledP: t.power.led.p,
      lux: t.env.luxAmbient ?? t.env.lux,
      tempC: t.env.tempC,
      hum: t.env.hum,
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
