import { describe, expect, it } from 'vitest'
import { Command, Telemetry, UiCommandEnvelope } from '../../shared/protocol.ts'
import { DeviceSimulator } from '../../scripts/deviceSimulator.ts'
import { FIRMWARE_CHARGING, FIRMWARE_SAMPLE } from '../fixtures.ts'

describe('Telemetry', () => {
  it('acepta el JSON del firmware', () => {
    expect(Telemetry.safeParse(FIRMWARE_SAMPLE).success).toBe(true)
  })

  it('acepta la telemetría cargando (panel solar)', () => {
    expect(Telemetry.safeParse(FIRMWARE_CHARGING).success).toBe(true)
  })

  it('acepta los valores nulos del arranque (sin sensores aún)', () => {
    const boot = {
      ...FIRMWARE_SAMPLE,
      env: { lux: null, luxState: 'SIN_DATO', tempC: null, pressHpa: null },
      bat: { soc: null, state: 'unknown', remainingWh: null, avgPowerW: null, autonomyMin: null, capacityWh: 31.5, source: null, chargeW: null },
      protect: { ...FIRMWARE_SAMPLE.protect, temp: 'SIN_DATO', usbOn: false },
      alerts: ['SENSOR_TEMP', 'SENSOR_LUX', 'SENSOR_POWER'],
    }
    expect(Telemetry.safeParse(boot).success).toBe(true)
  })

  it('acepta la telemetría del simulador', () => {
    const sim = new DeviceSimulator({ host: '', port: 0, durationS: 20, rateHz: 1, seed: 3 })
    for (let k = 0; k < 30; k++) {
      const r = Telemetry.safeParse(sim.buildTelemetry(k * 700))
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true)
    }
  })

  it('rechaza mensajes mal formados', () => {
    expect(Telemetry.safeParse({ ...FIRMWARE_SAMPLE, v: 2 }).success).toBe(false) // firmware anterior
    expect(Telemetry.safeParse({ ...FIRMWARE_SAMPLE, light: { ...FIRMWARE_SAMPLE.light, color: 'red' } }).success).toBe(false)
    expect(Telemetry.safeParse({ ...FIRMWARE_SAMPLE, alerts: ['FIRE'] }).success).toBe(false)
    expect(Telemetry.safeParse({ ...FIRMWARE_SAMPLE, bat: { ...FIRMWARE_SAMPLE.bat, soc: 140 } }).success).toBe(false)
    expect(Telemetry.safeParse({ ...FIRMWARE_SAMPLE, protect: { ...FIRMWARE_SAMPLE.protect, temp: 'CALIENTE' } }).success).toBe(false)
    expect(Telemetry.safeParse({ ...FIRMWARE_SAMPLE, power: { ...FIRMWARE_SAMPLE.power, radio: FIRMWARE_SAMPLE.power.usb, led: undefined } }).success).toBe(false)
    expect(Telemetry.safeParse({ ...FIRMWARE_SAMPLE, bat: { ...FIRMWARE_SAMPLE.bat, source: 'viento' } }).success).toBe(false)
    expect(Telemetry.safeParse({ ...FIRMWARE_SAMPLE, alerts: ['LED_LIMITED'] }).success).toBe(false) // ya no existe
  })
})

describe('Command', () => {
  it.each([
    { type: 'setMode', mode: 'auto' },
    { type: 'setMode', mode: 'manual' },
    { type: 'setLight', on: true },
    { type: 'setLight', color: '#00ff00', brightness: 40 },
    { type: 'setAuto', luxOn: 10, luxOff: 30 },
    { type: 'identify' },
  ])('acepta %j', (cmd) => {
    expect(Command.safeParse(cmd).success).toBe(true)
  })

  it.each([
    { type: 'setMode', mode: 'party' },
    { type: 'setLight' },
    { type: 'setLight', brightness: 101 },
    { type: 'setLight', color: '#12345' },
    { type: 'setAuto', luxOn: 40, luxOff: 40 },
    { type: 'reboot' },
  ])('rechaza %j', (cmd) => {
    expect(Command.safeParse(cmd).success).toBe(false)
  })

  it('el sobre de /mainUser exige id', () => {
    expect(UiCommandEnvelope.safeParse({ cmd: { type: 'identify' } }).success).toBe(false)
    expect(UiCommandEnvelope.safeParse({ id: 'a1', cmd: { type: 'identify' } }).success).toBe(true)
  })
})
