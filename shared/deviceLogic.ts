/**
 * Lógica del dispositivo en TypeScript — espejo exacto de firmware/solace_esp32/logic.h.
 * La usan el simulador (para comportarse como la ESP32), el hub y la web (constantes).
 * La paridad con el C++ se prueba en tests/shared/firmwareParity.test.ts.
 */
import type { AlertCode, BatState, ChargeSource, TempGuard, TempState } from './protocol.ts'

// ─── Colores ────────────────────────────────────────────────────────────────────────
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

// ─── Batería 2S2P Li-ion ────────────────────────────────────────────────────────────
export const BATTERY = {
  /** Energía útil del banco (Wh). Reemplazar por la capacidad medida (EL8). */
  usableWh: 31.5,
  restPowerW: 0.3,
  chargingMa: -20,
  avgTauS: 30,
} as const

/** Curva típica NMC por celda (voltaje en reposo → % de carga). */
export const OCV_TABLE: ReadonlyArray<readonly [number, number]> = [
  [3.3, 0],
  [3.45, 5],
  [3.55, 10],
  [3.62, 20],
  [3.68, 30],
  [3.73, 40],
  [3.78, 50],
  [3.84, 60],
  [3.91, 70],
  [3.99, 80],
  [4.08, 90],
  [4.2, 100],
]

/** Estado de carga a partir del voltaje en reposo del banco 2S. */
export function socFromPackVoltage(vBank: number): number {
  if (!Number.isFinite(vBank)) return 0
  const v = vBank / 2
  const first = OCV_TABLE[0]!
  const last = OCV_TABLE[OCV_TABLE.length - 1]!
  if (v <= first[0]) return 0
  if (v >= last[0]) return 100
  for (let k = 1; k < OCV_TABLE.length; k++) {
    const [v1, s1] = OCV_TABLE[k]!
    if (v <= v1) {
      const [v0, s0] = OCV_TABLE[k - 1]!
      return s0 + ((v - v0) / (v1 - v0)) * (s1 - s0)
    }
  }
  return 100
}

/** Conteo de energía: resta la potencia del CH1 (W, + descarga) durante dt (s). */
export function energyStep(eWh: number, pW: number, dtS: number): number {
  return Math.min(BATTERY.usableWh, Math.max(0, eWh - (pW * dtS) / 3600))
}
export function avgPowerStep(avgW: number, pW: number, dtS: number): number {
  return avgW + ((pW - avgW) * dtS) / (BATTERY.avgTauS + dtS)
}

export const AUTONOMY_RESTING = -1
export const AUTONOMY_CHARGING = -2
/** Minutos restantes. Códigos: -1 en reposo, -2 cargando, NaN sin dato (igual que el firmware). */
export function autonomyMin(valid: boolean, i1mA: number, eWh: number, avgW: number): number {
  if (!valid) return Number.NaN
  if (i1mA < BATTERY.chargingMa) return AUTONOMY_CHARGING
  if (!Number.isFinite(avgW) || avgW < BATTERY.restPowerW) return AUTONOMY_RESTING
  return (eWh / avgW) * 60
}

/** Estado de la batería según la medición instantánea del CH1 (espejo de batMode). */
export function batMode(valid: boolean, i1mA: number, pW: number): BatState {
  if (!valid || !Number.isFinite(i1mA) || !Number.isFinite(pW)) return 'unknown'
  if (i1mA < BATTERY.chargingMa) return 'charging'
  if (pW < BATTERY.restPowerW) return 'resting'
  return 'discharging'
}

// ─── Protección térmica ─────────────────────────────────────────────────────────────
export const TEMP = { alarmC: 45, cutC: 50, rearmC: 40, alarmHyst: 2, noDataMs: 5000 } as const

export function tempStep(prev: TempState, t: number | null, hasData: boolean): TempState {
  if (!hasData || t === null || !Number.isFinite(t)) return 'SIN_DATO'
  if (t >= TEMP.cutC) return 'CORTE'
  if ((prev === 'CORTE' || prev === 'SIN_DATO') && t >= TEMP.rearmC) return 'CORTE'
  if (t >= TEMP.alarmC) return 'ALARMA'
  if (prev === 'ALARMA' && t >= TEMP.alarmC - TEMP.alarmHyst) return 'ALARMA'
  return 'NORMAL'
}
/** La salida USB solo funciona en NORMAL o ALARMA (falla segura). La tira no tiene cortes. */
export const usbAllowedByTemp = (s: TempState) => s === 'NORMAL' || s === 'ALARMA'

/**
 * Estado real de la salida USB: lo pedido (interruptor o app). En 'auto' además se aplican
 * las protecciones (temperatura, INA3221, batería baja, sobrecorriente); en 'manual' ninguna.
 */
export function usbOutput(requested: boolean, temp: TempState, guard: TempGuard, inaOk: boolean, batOk: boolean, blocked: boolean): boolean {
  if (guard === 'manual') return requested
  return requested && usbAllowedByTemp(temp) && inaOk && batOk && !blocked
}

/** Interruptor de enclavamiento con antirrebote (cerrado = true). Igual que switchStep en logic.h. */
export const SWITCH_DEBOUNCE_MS = 50
export interface SwitchState {
  stable: boolean
  last: boolean
  tChange: number
}
/** Devuelve el nuevo estado y si la posición estable cambió. */
export function switchStep(s: SwitchState, closed: boolean, now: number): { s: SwitchState; changed: boolean } {
  let { stable, last, tChange } = s
  if (closed !== last) {
    last = closed
    tChange = now
  }
  if (closed === stable || now - tChange < SWITCH_DEBOUNCE_MS) return { s: { stable, last, tChange }, changed: false }
  return { s: { stable: closed, last, tChange }, changed: true }
}

// ─── Protecciones de la salida USB ──────────────────────────────────────────────────
export const USB_CUT = { offV: 6.6, onV: 7.0, satCutMs: 3000, blockMs: 30000, inaNoDataMs: 3000 } as const

export function batteryHyst(ok: boolean, v: number, offV: number, onV: number): boolean {
  if (ok && v < offV) return false
  if (!ok && v > onV) return true
  return ok
}

/** Nivel aplicado a la tira (0..255) a partir del brillo en %. */
export function ledLevel(brightnessPct: number): number {
  const b = Math.max(0, Math.min(100, Math.trunc(brightnessPct)))
  return Math.trunc((b * 255 + 50) / 100)
}

// ─── Origen de la carga ─────────────────────────────────────────────────────────────
/** Bajo esta luz un panel solar no puede cargar: si la batería carga, es por USB. */
export const SOLAR_MIN_LUX = 50

/**
 * Origen de la carga (null = no está cargando). Con el detector de la entrada USB decide
 * el detector; sin él, cargar a oscuras solo puede ser USB y con luz no se sabe.
 */
export function chargeSource(charging: boolean, hasUsbDetector: boolean, usbPresent: boolean, lux: number | null): ChargeSource | null {
  if (!charging) return null
  if (hasUsbDetector) return usbPresent ? 'usb' : 'solar'
  if (lux !== null && Number.isFinite(lux) && lux < SOLAR_MIN_LUX) return 'usb'
  return 'unknown'
}

// ─── Luz automática ─────────────────────────────────────────────────────────────────
export interface AutoLightConfig {
  luxOn: number
  luxOff: number
  darkMs: number
  brightMs: number
}
export interface AutoLightState {
  on: boolean
  darkTiming: boolean
  darkSince: number
  brightTiming: boolean
  brightSince: number
}
export const AUTO_DEFAULTS: AutoLightConfig = { luxOn: 10, luxOff: 200, darkMs: 500, brightMs: 3000 } // como logic.h
export const AUTO_OFF: AutoLightState = { on: false, darkTiming: false, darkSince: 0, brightTiming: false, brightSince: 0 }

/**
 * Oscuridad sostenida (lux < luxOn durante darkMs) enciende; luz de día sostenida
 * (lux > luxOff durante brightMs) apaga. Sin dato del sensor, se mantiene.
 */
export function autoLightStep(s: AutoLightState, lux: number | null, nowMs: number, cfg: AutoLightConfig): AutoLightState {
  if (lux === null || !Number.isFinite(lux)) return s
  const n = { ...s }
  if (!n.on) {
    n.brightTiming = false
    if (lux < cfg.luxOn) {
      if (!n.darkTiming) {
        n.darkTiming = true
        n.darkSince = nowMs
      } else if (nowMs - n.darkSince >= cfg.darkMs) {
        n.on = true
        n.darkTiming = false
      }
    } else n.darkTiming = false
  } else {
    n.darkTiming = false
    if (lux > cfg.luxOff) {
      if (!n.brightTiming) {
        n.brightTiming = true
        n.brightSince = nowMs
      } else if (nowMs - n.brightSince >= cfg.brightMs) {
        n.on = false
        n.brightTiming = false
      }
    } else n.brightTiming = false
  }
  return n
}

// ─── Modelo de consumo de la tira WS2812B (solo para el simulador) ──────────────────
export const LED_MODEL = { numLeds: 30, supplyV: 5.0, mAPerChannel: 20, idleMaPerLed: 1 } as const

/** Corriente estimada (A) de la tira a 5 V según color y nivel (0..255). */
export function estimateLedCurrentA(color: string, level: number, numLeds: number = LED_MODEL.numLeds): number {
  const [r, g, b] = hexToRgb(color)
  const drive = numLeds * LED_MODEL.mAPerChannel * ((r + g + b) / 255) * (Math.max(0, Math.min(255, level)) / 255)
  return (numLeds * LED_MODEL.idleMaPerLed + drive) / 1000
}

// ─── Alertas ────────────────────────────────────────────────────────────────────────
export const ALERT_THRESHOLDS = {
  socLow: 20,
  socCritical: 10,
  tempHighC: TEMP.alarmC,
  tempCutC: TEMP.cutC,
  usbMinV: 4.75,
  usbMaxV: 5.25,
  /** Solo se evalúa la salida USB si está entregando corriente. */
  usbActiveA: 0.05,
} as const

export interface AlertInputs {
  soc: number | null
  charging: boolean
  temp: TempState
  inaOk: boolean
  usbLowBat: boolean
  usbBlocked: boolean
  inaRangeBad: boolean
  usbOn: boolean
  usbV: number
  usbA: number
  luxOk: boolean
  guard: TempGuard
}

export function evaluateAlerts(x: AlertInputs): AlertCode[] {
  const out: AlertCode[] = []
  if (x.inaOk && !x.charging && x.soc !== null && Number.isFinite(x.soc)) {
    if (x.soc < ALERT_THRESHOLDS.socCritical) out.push('BAT_CRITICAL')
    else if (x.soc < ALERT_THRESHOLDS.socLow) out.push('BAT_LOW')
  }
  // En manual la temperatura no corta: un CORTE se informa como temperatura alta.
  if (x.temp === 'ALARMA' || (x.temp === 'CORTE' && x.guard === 'manual')) out.push('TEMP_HIGH')
  if (x.temp === 'CORTE' && x.guard === 'auto') out.push('TEMP_CUTOFF')
  if (x.temp === 'SIN_DATO') out.push('SENSOR_TEMP')
  if (x.guard === 'auto' && x.inaOk && x.usbLowBat) out.push('USB_LOW_BAT')
  if (x.guard === 'auto' && x.usbBlocked) out.push('USB_BLOCKED')
  if (x.inaOk && x.inaRangeBad) out.push('INA_RANGE')
  if (x.inaOk && x.usbOn && x.usbA > ALERT_THRESHOLDS.usbActiveA && (x.usbV < ALERT_THRESHOLDS.usbMinV || x.usbV > ALERT_THRESHOLDS.usbMaxV)) {
    out.push('USB_OUT_OF_SPEC')
  }
  if (!x.luxOk) out.push('SENSOR_LUX')
  if (!x.inaOk) out.push('SENSOR_POWER')
  if (x.guard === 'manual') out.push('TEMP_GUARD_OFF')
  return out
}
