import { describe, expect, it } from 'vitest'
import {
  AUTO_DEFAULTS,
  PACK_ENERGY_WH,
  autoLightStep,
  estimateLedPowerW,
  estimateSoc,
  evaluateAlerts,
  hexToRgb,
  rgbToHex,
  socFromCellVoltage,
  type AlertInputs,
} from '../../shared/deviceLogic.ts'

describe('banco de baterías 2S2P', () => {
  it('tiene 5 Ah y 37 Wh', () => {
    expect(PACK_ENERGY_WH).toBeCloseTo(37, 5)
  })

  it('SoC por celda: extremos e interpolación', () => {
    expect(socFromCellVoltage(4.2)).toBe(100)
    expect(socFromCellVoltage(4.35)).toBe(100)
    expect(socFromCellVoltage(3.0)).toBe(0)
    expect(socFromCellVoltage(2.7)).toBe(0)
    expect(socFromCellVoltage(3.78)).toBeCloseTo(50)
    expect(socFromCellVoltage(3.805)).toBeCloseTo(55)
    expect(socFromCellVoltage(Number.NaN)).toBe(0)
  })

  it('SoC del paquete: 8.4 V lleno, 6.0 V vacío, monótono', () => {
    expect(estimateSoc(8.4, 0)).toBe(100)
    expect(estimateSoc(6.0, 0)).toBe(0)
    let prev = -1
    for (let v = 6; v <= 8.4; v += 0.01) {
      const s = estimateSoc(v, 0)
      expect(s).toBeGreaterThanOrEqual(prev)
      prev = s
    }
  })

  it('compensa la caída de voltaje bajo carga', () => {
    expect(estimateSoc(7.5, 1.5)).toBeGreaterThan(estimateSoc(7.5, 0))
    expect(estimateSoc(7.5, -1)).toBeLessThan(estimateSoc(7.5, 0)) // cargando: el voltaje medido está inflado
  })
})

describe('luz automática', () => {
  const cfg = { ...AUTO_DEFAULTS, luxOn: 15, luxOff: 40, minDwellMs: 5000 }
  const off = { on: false, lastChangeMs: -Infinity }

  it('enciende de inmediato cuando oscurece la primera vez', () => {
    expect(autoLightStep(off, 10, 0, cfg)).toEqual({ on: true, lastChangeMs: 0 })
  })

  it('respeta la histéresis', () => {
    const on = { on: true, lastChangeMs: 0 }
    expect(autoLightStep(on, 30, 10_000, cfg).on).toBe(true)
    expect(autoLightStep(on, 41, 10_000, cfg).on).toBe(false)
    expect(autoLightStep({ on: false, lastChangeMs: 0 }, 20, 10_000, cfg).on).toBe(false)
  })

  it('no cambia antes del tiempo mínimo de permanencia', () => {
    const on = { on: true, lastChangeMs: 1000 }
    expect(autoLightStep(on, 500, 3000, cfg).on).toBe(true)
    expect(autoLightStep(on, 500, 6001, cfg).on).toBe(false)
  })

  it('mantiene el estado si el sensor falla', () => {
    expect(autoLightStep(off, null, 0, cfg)).toBe(off)
    expect(autoLightStep(off, Number.NaN, 0, cfg)).toBe(off)
  })
})

describe('modelo de consumo WS2812B', () => {
  it('blanco al 100 % con 30 LEDs ≈ 9.15 W (1.83 A a 5 V)', () => {
    expect(estimateLedPowerW(true, '#FFFFFF', 100)).toBeCloseTo(9.15, 2)
  })
  it('apagada consume el reposo de los drivers', () => {
    expect(estimateLedPowerW(false, '#FFFFFF', 100)).toBeCloseTo(0.15, 3)
    expect(estimateLedPowerW(true, '#FFFFFF', 0)).toBeCloseTo(0.15, 3)
  })
  it('escala con color y brillo', () => {
    expect(estimateLedPowerW(true, '#FF0000', 100)).toBeCloseTo(3.15, 2)
    expect(estimateLedPowerW(true, '#FFFFFF', 50)).toBeCloseTo(4.65, 2)
  })
})

describe('colores', () => {
  it('convierte ida y vuelta', () => {
    expect(hexToRgb('#E2A64B')).toEqual([226, 166, 75])
    expect(rgbToHex(226, 166, 75)).toBe('#E2A64B')
    expect(hexToRgb('nope')).toEqual([0, 0, 0])
  })
})

describe('alertas', () => {
  const ok: AlertInputs = { soc: 80, charging: false, tempC: 25, usbV: 5, usbI: 1, luxOk: true, dhtOk: true, inaOk: true }
  it('sin alertas en condiciones normales', () => expect(evaluateAlerts(ok)).toEqual([]))
  it('batería baja y crítica (no mientras carga)', () => {
    expect(evaluateAlerts({ ...ok, soc: 15 })).toEqual(['BAT_LOW'])
    expect(evaluateAlerts({ ...ok, soc: 5 })).toEqual(['BAT_CRITICAL'])
    expect(evaluateAlerts({ ...ok, soc: 5, charging: true })).toEqual([])
  })
  it('temperatura alta desde 45 °C', () => {
    expect(evaluateAlerts({ ...ok, tempC: 45 })).toEqual(['TEMP_HIGH'])
    expect(evaluateAlerts({ ...ok, tempC: null })).toEqual([])
  })
  it('USB fuera de 4,75–5,25 V solo si entrega corriente', () => {
    expect(evaluateAlerts({ ...ok, usbV: 4.6 })).toEqual(['USB_OUT_OF_SPEC'])
    expect(evaluateAlerts({ ...ok, usbV: 5.4 })).toEqual(['USB_OUT_OF_SPEC'])
    expect(evaluateAlerts({ ...ok, usbV: 4.6, usbI: 0 })).toEqual([])
  })
  it('sensores caídos', () => {
    expect(evaluateAlerts({ ...ok, luxOk: false, dhtOk: false, inaOk: false, soc: 0 })).toEqual(['SENSOR_LUX', 'SENSOR_DHT', 'SENSOR_POWER'])
  })
})
