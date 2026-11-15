/**
 * Lógica del dispositivo en TypeScript — espejo exacto de firmware/solace_esp32/logic.h.
 * La usan el simulador (para comportarse como la ESP32) y el hub (constantes de batería).
 * Ambas implementaciones se prueban con los mismos vectores de prueba.
 */
import type { AlertCode } from './protocol.ts'

// ─── Banco de baterías: 2S2P Li-ion 18650, 2500 mAh, 3.7 V por celda ────────────────
export const BATTERY = {
  series: 2,
  parallel: 2,
  cellCapacityAh: 2.5,
  cellNominalV: 3.7,
  /** Resistencia interna aproximada del paquete (Ω) para compensar la caída bajo carga. */
  packInternalOhm: 0.08,
  minV: 6.0,
  maxV: 8.4,
} as const
export const PACK_CAPACITY_AH = BATTERY.parallel * BATTERY.cellCapacityAh // 5 Ah
export const PACK_ENERGY_WH = PACK_CAPACITY_AH * BATTERY.series * BATTERY.cellNominalV // 37 Wh

/** Curva voltaje de circuito abierto (por celda) → % de carga, típica de Li-ion NMC. */
export const OCV_TABLE: ReadonlyArray<readonly [number, number]> = [
  [3.0, 0],
  [3.3, 5],
  [3.5, 10],
  [3.6, 20],
  [3.68, 30],
  [3.74, 40],
  [3.78, 50],
  [3.83, 60],
  [3.89, 70],
  [3.95, 80],
  [4.05, 90],
  [4.2, 100],
]

export function socFromCellVoltage(vCell: number): number {
  if (!Number.isFinite(vCell)) return 0
  const first = OCV_TABLE[0]!
  const last = OCV_TABLE[OCV_TABLE.length - 1]!
  if (vCell <= first[0]) return 0
  if (vCell >= last[0]) return 100
  for (let k = 1; k < OCV_TABLE.length; k++) {
    const [v1, s1] = OCV_TABLE[k]!
    if (vCell <= v1) {
      const [v0, s0] = OCV_TABLE[k - 1]!
      return s0 + ((vCell - v0) * (s1 - s0)) / (v1 - v0)
    }
  }
  return 100
}

/**
 * Estado de carga estimado a partir del voltaje del paquete y la corriente (A, + = descarga).
 * Compensa la caída I·R para aproximar el voltaje en circuito abierto.
 */
export function estimateSoc(packV: number, currentA: number): number {
  const ocv = packV + currentA * BATTERY.packInternalOhm
  return Math.round(socFromCellVoltage(ocv / BATTERY.series) * 10) / 10
}

// ─── Luz automática con histéresis y tiempo mínimo de permanencia ──────────────────
export interface AutoLightConfig {
  luxOn: number
  luxOff: number
  minDwellMs: number
}
export interface AutoLightState {
  on: boolean
  lastChangeMs: number
}
export const AUTO_DEFAULTS: AutoLightConfig = { luxOn: 15, luxOff: 40, minDwellMs: 5000 }

/**
 * Decide si la luz automática debe estar encendida.
 * - lux < luxOn  → enciende   - lux > luxOff → apaga   - entre ambos → mantiene (histéresis)
 * - No cambia antes de minDwellMs desde el último cambio (evita parpadeos).
 * - Si el sensor falla (lux null) mantiene el estado.
 */
export function autoLightStep(
  state: AutoLightState,
  lux: number | null,
  nowMs: number,
  cfg: AutoLightConfig,
): AutoLightState {
  if (lux === null || !Number.isFinite(lux)) return state
  if (nowMs - state.lastChangeMs < cfg.minDwellMs) return state
  if (!state.on && lux < cfg.luxOn) return { on: true, lastChangeMs: nowMs }
  if (state.on && lux > cfg.luxOff) return { on: false, lastChangeMs: nowMs }
  return state
}

// ─── Modelo de consumo de la tira WS2812B ───────────────────────────────────────────
export const LED_MODEL = {
  numLeds: 30,
  supplyV: 5.0,
  /** mA por canal (R, G o B) a 255. */
  mAPerChannel: 20,
  /** mA en reposo por LED (driver interno). */
  idleMaPerLed: 1,
} as const

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return [0, 0, 0]
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase()
}

/** Potencia estimada (W) de la tira según color y brillo (0–100). */
export function estimateLedPowerW(on: boolean, color: string, brightness: number, numLeds: number = LED_MODEL.numLeds): number {
  const idle = numLeds * LED_MODEL.idleMaPerLed
  if (!on || brightness <= 0) return (idle * LED_MODEL.supplyV) / 1000
  const [r, g, b] = hexToRgb(color)
  const scale = Math.min(100, brightness) / 100
  const drive = numLeds * LED_MODEL.mAPerChannel * ((r + g + b) / 255) * scale
  return Math.round(((idle + drive) * LED_MODEL.supplyV) / 10) / 100 // W, 2 decimales
}

// ─── Alertas ────────────────────────────────────────────────────────────────────────
export const ALERT_THRESHOLDS = {
  socLow: 20,
  socCritical: 10,
  tempHighC: 45,
  usbMinV: 4.75,
  usbMaxV: 5.25,
  /** Solo se evalúa la salida USB si está entregando corriente. */
  usbActiveA: 0.05,
} as const

export interface AlertInputs {
  soc: number
  charging: boolean
  tempC: number | null
  usbV: number
  usbI: number
  luxOk: boolean
  dhtOk: boolean
  inaOk: boolean
}

export function evaluateAlerts(x: AlertInputs): AlertCode[] {
  const out: AlertCode[] = []
  if (x.inaOk && !x.charging) {
    if (x.soc < ALERT_THRESHOLDS.socCritical) out.push('BAT_CRITICAL')
    else if (x.soc < ALERT_THRESHOLDS.socLow) out.push('BAT_LOW')
  }
  if (x.tempC !== null && x.tempC >= ALERT_THRESHOLDS.tempHighC) out.push('TEMP_HIGH')
  if (x.inaOk && x.usbI > ALERT_THRESHOLDS.usbActiveA && (x.usbV < ALERT_THRESHOLDS.usbMinV || x.usbV > ALERT_THRESHOLDS.usbMaxV)) {
    out.push('USB_OUT_OF_SPEC')
  }
  if (!x.luxOk) out.push('SENSOR_LUX')
  if (!x.dhtOk) out.push('SENSOR_DHT')
  if (!x.inaOk) out.push('SENSOR_POWER')
  return out
}
