import { describe, expect, it } from 'vitest'
import {
  AUTO_DEFAULTS,
  AUTO_OFF,
  AUTONOMY_CHARGING,
  AUTONOMY_RESTING,
  BATTERY,
  USB_CUT,
  autoLightStep,
  autonomyMin,
  batMode,
  chargeSource,
  avgPowerStep,
  batteryHyst,
  energyStep,
  estimateLedCurrentA,
  evaluateAlerts,
  hexToRgb,
  ledLevel,
  usbAllowedByTemp,
  rgbToHex,
  socFromPackVoltage,
  tempStep,
  type AlertInputs, usbOutput, switchStep } from '../../shared/deviceLogic.ts'

describe('batería 2S2P', () => {
  it('31,5 Wh útiles', () => expect(BATTERY.usableWh).toBe(31.5))

  it('SoC por voltaje en reposo: extremos e interpolación', () => {
    expect(socFromPackVoltage(8.4)).toBe(100)
    expect(socFromPackVoltage(8.6)).toBe(100)
    expect(socFromPackVoltage(6.6)).toBe(0)
    expect(socFromPackVoltage(6.0)).toBe(0)
    expect(socFromPackVoltage(7.56)).toBeCloseTo(50)
    expect(socFromPackVoltage(7.62)).toBeCloseTo(55)
    expect(socFromPackVoltage(Number.NaN)).toBe(0)
  })

  it('SoC monótono', () => {
    let prev = -1
    for (let v = 6; v <= 8.6; v += 0.01) {
      const s = socFromPackVoltage(v)
      expect(s).toBeGreaterThanOrEqual(prev)
      prev = s
    }
  })

  it('conteo de energía con límites', () => {
    expect(energyStep(10, 36, 100)).toBeCloseTo(9)
    expect(energyStep(10, -36, 100)).toBeCloseTo(11)
    expect(energyStep(0.5, 36, 100)).toBe(0)
    expect(energyStep(31, -36, 100)).toBe(31.5)
    expect(avgPowerStep(2, 4, 30)).toBeCloseTo(3)
  })

  it('estado instantáneo: carga, reposo y operación', () => {
    expect(batMode(true, -21, -0.17)).toBe('charging')
    expect(batMode(true, -19, -0.15)).toBe('resting')
    expect(batMode(true, 1900, 14)).toBe('discharging')
    expect(batMode(false, 1900, 14)).toBe('unknown')
  })

  it('autonomía: minutos, reposo, carga y sin dato', () => {
    expect(autonomyMin(true, 500, 10, 2)).toBeCloseTo(300)
    expect(autonomyMin(true, -30, 10, 2)).toBe(AUTONOMY_CHARGING)
    expect(autonomyMin(true, 100, 10, 0.2)).toBe(AUTONOMY_RESTING)
    expect(autonomyMin(false, 100, 10, 2)).toBeNaN()
  })
})

describe('protección térmica', () => {
  it('alarma a 45 °C con 2 °C de histéresis', () => {
    expect(tempStep('NORMAL', 44.9, true)).toBe('NORMAL')
    expect(tempStep('NORMAL', 45, true)).toBe('ALARMA')
    expect(tempStep('ALARMA', 43.5, true)).toBe('ALARMA')
    expect(tempStep('ALARMA', 42.9, true)).toBe('NORMAL')
  })
  it('corte a 50 °C; solo se rearma bajo 40 °C', () => {
    expect(tempStep('ALARMA', 50, true)).toBe('CORTE')
    expect(tempStep('CORTE', 45, true)).toBe('CORTE')
    expect(tempStep('CORTE', 39.9, true)).toBe('NORMAL')
  })
  it('sin dato del sensor = falla segura', () => {
    expect(tempStep('NORMAL', 25, false)).toBe('SIN_DATO')
    expect(tempStep('NORMAL', null, true)).toBe('SIN_DATO')
    expect(tempStep('SIN_DATO', 41, true)).toBe('CORTE')
    expect(tempStep('SIN_DATO', 25, true)).toBe('NORMAL')
    expect(usbAllowedByTemp('SIN_DATO')).toBe(false)
    expect(usbAllowedByTemp('ALARMA')).toBe(true)
  })
})

describe('salida USB', () => {
  it('corta bajo 6,6 V y vuelve sobre 7,0 V', () => {
    expect(batteryHyst(true, 6.59, USB_CUT.offV, USB_CUT.onV)).toBe(false)
    expect(batteryHyst(false, 6.9, USB_CUT.offV, USB_CUT.onV)).toBe(false)
    expect(batteryHyst(false, 7.01, USB_CUT.offV, USB_CUT.onV)).toBe(true)
  })
})

describe('tira LED (sin cortes)', () => {
  it('el nivel es solo el brillo pedido', () => {
    expect(ledLevel(100)).toBe(255)
    expect(ledLevel(50)).toBe(128)
    expect(ledLevel(0)).toBe(0)
    expect(ledLevel(140)).toBe(255)
  })
})

describe('origen de la carga', () => {
  it('sin carga no hay origen', () => expect(chargeSource(false, true, true, 5000)).toBeNull())
  it('con detector de la entrada USB decide el detector', () => {
    expect(chargeSource(true, true, true, 9000)).toBe('usb')
    expect(chargeSource(true, true, false, 2)).toBe('solar')
  })
  it('sin detector: a oscuras es USB; con luz no se sabe', () => {
    expect(chargeSource(true, false, false, 3)).toBe('usb')
    expect(chargeSource(true, false, false, 50)).toBe('unknown')
    expect(chargeSource(true, false, false, null)).toBe('unknown')
  })
})

const AUTO_OFF_STATE = { on: false, darkTiming: false, darkSince: 0, brightTiming: false, brightSince: 0 }

describe('luz automática', () => {
  it('por defecto reacciona rápido: 0,5 s de oscuridad enciende, 3 s de día apaga (como logic.h)', () => {
    expect(AUTO_DEFAULTS).toMatchObject({ darkMs: 500, brightMs: 3000 })
    let s = autoLightStep(AUTO_OFF_STATE, 5, 0, AUTO_DEFAULTS)
    s = autoLightStep(s, 5, 499, AUTO_DEFAULTS)
    expect(s.on).toBe(false)
    expect(autoLightStep(s, 5, 500, AUTO_DEFAULTS).on).toBe(true)
  })
  // La lógica se prueba con tiempos largos para medir las ventanas con holgura.
  const cfg = { ...AUTO_DEFAULTS, darkMs: 3000, brightMs: 10000 }

  it('enciende tras 3 s de oscuridad', () => {
    let s = autoLightStep(AUTO_OFF, 5, 1000, cfg)
    expect(s.on).toBe(false)
    s = autoLightStep(s, 5, 3999, cfg)
    expect(s.on).toBe(false)
    s = autoLightStep(s, 5, 4000, cfg)
    expect(s.on).toBe(true)
  })

  it('con la tira encendida solo la apaga la luz de día sostenida (10 s)', () => {
    let s = { ...AUTO_OFF, on: true }
    s = autoLightStep(s, 150, 0, cfg) // la propia tira ilumina el sensor
    expect(s.on).toBe(true)
    s = autoLightStep(s, 300, 1000, cfg)
    s = autoLightStep(s, 300, 10_999, cfg)
    expect(s.on).toBe(true)
    s = autoLightStep(s, 300, 11_000, cfg)
    expect(s.on).toBe(false)
  })

  it('una muestra clara reinicia la cuenta', () => {
    let s = autoLightStep(AUTO_OFF, 5, 0, cfg)
    s = autoLightStep(s, 50, 1000, cfg)
    s = autoLightStep(s, 5, 2000, cfg)
    s = autoLightStep(s, 5, 4500, cfg)
    expect(s.on).toBe(false)
    expect(autoLightStep(s, 5, 5000, cfg).on).toBe(true)
  })

  it('mantiene el estado si el sensor falla', () => {
    expect(autoLightStep(AUTO_OFF, null, 0, cfg)).toBe(AUTO_OFF)
    expect(autoLightStep(AUTO_OFF, Number.NaN, 0, cfg)).toBe(AUTO_OFF)
  })
})

describe('modelo de la tira WS2812B (simulador)', () => {
  it('blanco al máximo con 30 LEDs ≈ 1,83 A; apagada, el reposo', () => {
    expect(estimateLedCurrentA('#FFFFFF', 255)).toBeCloseTo(1.83, 2)
    expect(estimateLedCurrentA('#FFFFFF', 0)).toBeCloseTo(0.03, 3)
    expect(estimateLedCurrentA('#FF0000', 255)).toBeCloseTo(0.63, 2)
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
  const ok: AlertInputs = {
    soc: 80,
    charging: false,
    temp: 'NORMAL',
    inaOk: true,
    usbLowBat: false,
    usbBlocked: false,
    inaRangeBad: false,
    usbOn: true,
    usbV: 5,
    usbA: 1,
    luxOk: true,
    guard: 'auto',
  }
  it('protección térmica manual: el corte se informa como temperatura alta', () => {
    expect(evaluateAlerts({ ...ok, guard: 'manual' })).toEqual(['TEMP_GUARD_OFF'])
    expect(evaluateAlerts({ ...ok, guard: 'manual', temp: 'CORTE' })).toEqual(['TEMP_HIGH', 'TEMP_GUARD_OFF'])
    expect(evaluateAlerts({ ...ok, guard: 'auto', temp: 'CORTE' })).toEqual(['TEMP_CUTOFF'])
  })
  it('usbOutput: en automático cortan las protecciones; en manual solo cuenta lo pedido', () => {
    expect(usbOutput(true, 'CORTE', 'auto', true, true, false)).toBe(false)
    expect(usbOutput(true, 'NORMAL', 'auto', false, true, false)).toBe(false)
    expect(usbOutput(true, 'NORMAL', 'auto', true, false, false)).toBe(false)
    expect(usbOutput(true, 'NORMAL', 'auto', true, true, true)).toBe(false)
    expect(usbOutput(true, 'SIN_DATO', 'manual', false, false, true)).toBe(true) // sin INA, batería baja, bloqueado: igual enciende
    expect(usbOutput(false, 'NORMAL', 'manual', true, true, false)).toBe(false)
    expect(usbOutput(false, 'NORMAL', 'auto', true, true, false)).toBe(false)
  })
  it('en manual no hay alertas de USB cortado ni bloqueado', () => {
    expect(evaluateAlerts({ ...ok, guard: 'manual', usbLowBat: true, usbBlocked: true })).toEqual(['TEMP_GUARD_OFF'])
  })
  it('switchStep: antirrebote de 50 ms y solo actúa al cambiar de posición', () => {
    let s = { stable: false, last: false, tChange: 0 }
    let r = switchStep(s, true, 100)
    expect(r.changed).toBe(false)
    r = switchStep(r.s, true, 149)
    expect(r.changed).toBe(false)
    r = switchStep(r.s, true, 150)
    expect(r).toMatchObject({ changed: true, s: { stable: true } })
    r = switchStep(r.s, true, 900)
    expect(r.changed).toBe(false)
    s = r.s
    r = switchStep(s, false, 1000)
    r = switchStep(r.s, true, 1020) // rebote
    r = switchStep(r.s, true, 1100)
    expect(r.changed).toBe(false)
  })
  it('sin alertas en condiciones normales', () => expect(evaluateAlerts(ok)).toEqual([]))
  it('batería baja y crítica (no mientras carga ni sin SoC)', () => {
    expect(evaluateAlerts({ ...ok, soc: 15 })).toEqual(['BAT_LOW'])
    expect(evaluateAlerts({ ...ok, soc: 5 })).toEqual(['BAT_CRITICAL'])
    expect(evaluateAlerts({ ...ok, soc: 5, charging: true })).toEqual([])
    expect(evaluateAlerts({ ...ok, soc: null })).toEqual([])
  })
  it('estados térmicos', () => {
    expect(evaluateAlerts({ ...ok, temp: 'ALARMA' })).toEqual(['TEMP_HIGH'])
    expect(evaluateAlerts({ ...ok, temp: 'CORTE' })).toEqual(['TEMP_CUTOFF'])
    expect(evaluateAlerts({ ...ok, temp: 'SIN_DATO' })).toEqual(['SENSOR_TEMP'])
  })
  it('cortes del USB y rango del INA', () => {
    expect(evaluateAlerts({ ...ok, usbLowBat: true })).toEqual(['USB_LOW_BAT'])
    expect(evaluateAlerts({ ...ok, usbBlocked: true, inaRangeBad: true })).toEqual(['USB_BLOCKED', 'INA_RANGE'])
  })
  it('USB fuera de 4,75–5,25 V solo si está activa y entrega corriente', () => {
    expect(evaluateAlerts({ ...ok, usbV: 4.6 })).toEqual(['USB_OUT_OF_SPEC'])
    expect(evaluateAlerts({ ...ok, usbV: 5.4 })).toEqual(['USB_OUT_OF_SPEC'])
    expect(evaluateAlerts({ ...ok, usbV: 4.6, usbA: 0 })).toEqual([])
    expect(evaluateAlerts({ ...ok, usbV: 0, usbOn: false })).toEqual([])
  })
  it('sensores caídos', () => {
    expect(evaluateAlerts({ ...ok, luxOk: false, inaOk: false, soc: 0, usbLowBat: true })).toEqual(['SENSOR_LUX', 'SENSOR_POWER'])
  })
})
