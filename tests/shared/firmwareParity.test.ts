/**
 * Paridad firmware ↔ simulador: compila firmware/solace_esp32/logic.h en el computador y
 * compara sus resultados con shared/deviceLogic.ts sobre cientos de entradas aleatorias.
 * Así el simulador se comporta igual que la ESP32 real.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  autoLightStep,
  autonomyMin,
  batMode,
  batteryHyst,
  chargeSource,
  evaluateAlerts,
  ledLevel,
  socFromPackVoltage,
  tempStep, usbOutput } from '../../shared/deviceLogic.ts'
import { TempState } from '../../shared/protocol.ts'
import { mulberry32 } from '../../scripts/deviceSimulator.ts'

const ROOT = path.resolve(import.meta.dirname, '../..')
const CLI = path.join(ROOT, 'firmware/test/build/logic_cli')
const hasCompiler = spawnSync('c++', ['--version']).status === 0
const TEMP_STATES = TempState.options // mismo orden que el enum de logic.h

function runCli(lines: string[]): string[] {
  const out = execFileSync(CLI, { input: lines.join('\n') + '\n' }).toString().trim()
  return out.split('\n')
}

describe.skipIf(!hasCompiler)('paridad logic.h (C++) ↔ deviceLogic.ts', () => {
  beforeAll(() => {
    execFileSync('make', ['-C', path.join(ROOT, 'firmware/test'), 'build/logic_cli'], { stdio: 'pipe' })
  })

  const rnd = mulberry32(2026)
  const N = 400
  const f = (x: number, d = 3) => Number(x.toFixed(d))

  it('socFromPackVoltage', () => {
    const cases = Array.from({ length: N }, () => f(6 + rnd() * 2.8, 4))
    const cpp = runCli(cases.map((v) => `soc ${v}`))
    cases.forEach((v, k) => expect(Number(cpp[k])).toBeCloseTo(socFromPackVoltage(v), 2))
  })

  it('tempStep', () => {
    const cases = Array.from({ length: N }, () => ({ prev: Math.floor(rnd() * 4), t: f(30 + rnd() * 25, 2), has: rnd() > 0.1 }))
    const cpp = runCli(cases.map((c) => `temp ${c.prev} ${c.t} ${+c.has}`))
    cases.forEach((c, k) => expect(TEMP_STATES[Number(cpp[k])]).toBe(tempStep(TEMP_STATES[c.prev]!, c.t, c.has)))
  })

  it('batteryHyst', () => {
    const cases = Array.from({ length: N }, () => ({ ok: rnd() > 0.5, v: f(6 + rnd() * 1.5) }))
    const cpp = runCli(cases.map((c) => `hyst ${+c.ok} ${c.v} 6.6 7.0`))
    cases.forEach((c, k) => expect(cpp[k] === '1').toBe(batteryHyst(c.ok, c.v, 6.6, 7.0)))
  })

  it('ledLevel', () => {
    const cases = Array.from({ length: N }, () => Math.floor(rnd() * 140) - 20)
    const cpp = runCli(cases.map((b) => `level ${b}`))
    cases.forEach((b, k) => expect(Number(cpp[k])).toBe(ledLevel(b)))
  })

  it('batMode', () => {
    const cases = Array.from({ length: N }, () => ({ valid: rnd() > 0.1, i: f(-300 + rnd() * 2300, 1), v: f(6.5 + rnd() * 1.9) }))
    const cpp = runCli(cases.map((c) => `bat ${+c.valid} ${c.i} ${f((c.v * c.i) / 1000, 4)}`))
    cases.forEach((c, k) => expect(cpp[k]).toBe(batMode(c.valid, c.i, f((c.v * c.i) / 1000, 4))))
  })

  it('chargeSource', () => {
    const cases = Array.from({ length: N }, () => ({ ch: rnd() > 0.3, det: rnd() > 0.5, usb: rnd() > 0.5, lv: rnd() > 0.1, lux: f(rnd() * 120, 1) }))
    const cpp = runCli(cases.map((c) => `src ${+c.ch} ${+c.det} ${+c.usb} ${+c.lv} ${c.lux}`))
    cases.forEach((c, k) => expect(cpp[k]).toBe(chargeSource(c.ch, c.det, c.usb, c.lv ? c.lux : null) ?? 'none'))
  })

  it('autonomyMin', () => {
    const cases = Array.from({ length: N }, () => ({ valid: rnd() > 0.1, i: f(-200 + rnd() * 1800, 1), e: f(rnd() * 31.5, 2), w: f(rnd() * 12, 3) }))
    const cpp = runCli(cases.map((c) => `aut ${+c.valid} ${c.i} ${c.e} ${c.w}`))
    cases.forEach((c, k) => {
      const ts = autonomyMin(c.valid, c.i, c.e, c.w)
      if (Number.isNaN(ts)) expect(cpp[k]).toBe('nan')
      else expect(Number(cpp[k])).toBeCloseTo(ts, 0)
    })
  })

  it('autoLightStep', () => {
    const cases = Array.from({ length: N }, () => ({
      on: rnd() > 0.5,
      dt: rnd() > 0.5,
      ds: Math.round(rnd() * 20000),
      bt: rnd() > 0.5,
      bs: Math.round(rnd() * 20000),
      lux: Math.round(rnd() * 3000) / 10,
      valid: rnd() > 0.1,
      now: 20000 + Math.round(rnd() * 15000),
      luxOn: 5 + Math.round(rnd() * 10),
      luxOff: 150 + Math.round(rnd() * 100),
    }))
    const cpp = runCli(
      cases.map((c) => `auto ${+c.on} ${+c.dt} ${c.ds} ${+c.bt} ${c.bs} ${c.lux} ${+c.valid} ${c.now} ${c.luxOn} ${c.luxOff} 3000 10000`),
    )
    cases.forEach((c, k) => {
      const ts = autoLightStep({ on: c.on, darkTiming: c.dt, darkSince: c.ds, brightTiming: c.bt, brightSince: c.bs }, c.valid ? c.lux : null, c.now, {
        luxOn: c.luxOn,
        luxOff: c.luxOff,
        darkMs: 3000,
        brightMs: 10000,
      })
      const [on, dt, ds, bt, bs] = cpp[k]!.split(' ').map(Number)
      expect({ on: on === 1, darkTiming: dt === 1, darkSince: ds, brightTiming: bt === 1, brightSince: bs }).toEqual(ts)
    })
  })

  it('evaluateAlerts', () => {
    const b = () => rnd() > 0.8
    const cases = Array.from({ length: N }, () => ({
      soc: rnd() > 0.1 ? f(rnd() * 100) : null,
      charging: b(),
      temp: Math.floor(rnd() * 4),
      inaOk: rnd() > 0.1,
      usbLowBat: b(),
      usbBlocked: b(),
      inaRangeBad: b(),
      usbOn: rnd() > 0.2,
      usbV: f(4.5 + rnd()),
      usbA: f(rnd() * 2),
      luxOk: rnd() > 0.1,
      guard: rnd() > 0.5 ? 1 : 0,
    }))
    const cpp = runCli(
      cases.map(
        (c) =>
          `alerts ${c.soc ?? 'nan'} ${+c.charging} ${c.temp} ${+c.inaOk} ${+c.usbLowBat} ${+c.usbBlocked} ${+c.inaRangeBad} ${+c.usbOn} ${c.usbV} ${c.usbA} ${+c.luxOk} ${c.guard}`,
      ),
    )
    cases.forEach((c, k) => {
      const ts = evaluateAlerts({ ...c, temp: TEMP_STATES[c.temp]!, guard: c.guard ? 'manual' : 'auto' })
      expect(cpp[k]).toBe(ts.length ? ts.join(',') : '-')
    })
  })

  it('usbOutput (las 256 combinaciones)', () => {
    const cases = Array.from({ length: 256 }, (_, n) => ({
      req: n & 1,
      temp: (n >> 1) & 3,
      guard: (n >> 3) & 1,
      ina: (n >> 4) & 1,
      bat: (n >> 5) & 1,
      blk: (n >> 6) & 1,
    }))
    const cpp = runCli(cases.map((c) => `usb ${c.req} ${c.temp} ${c.guard} ${c.ina} ${c.bat} ${c.blk}`))
    cases.forEach((c, k) => {
      const ts = usbOutput(!!c.req, TEMP_STATES[c.temp]!, c.guard ? 'manual' : 'auto', !!c.ina, !!c.bat, !!c.blk)
      expect(cpp[k]).toBe(ts ? '1' : '0')
    })
  })
})
