/**
 * Paridad firmware ↔ simulador: compila firmware/solace_esp32/logic.h en el computador y
 * compara sus resultados con shared/deviceLogic.ts sobre cientos de entradas aleatorias.
 * Así el simulador se comporta igual que la ESP32 real.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { autoLightStep, estimateLedPowerW, estimateSoc, evaluateAlerts, rgbToHex } from '../../shared/deviceLogic.ts'
import { mulberry32 } from '../../scripts/deviceSimulator.ts'

const ROOT = path.resolve(import.meta.dirname, '../..')
const CLI = path.join(ROOT, 'firmware/test/build/logic_cli')
const hasCompiler = spawnSync('c++', ['--version']).status === 0

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

  it('estimateSoc', () => {
    const cases = Array.from({ length: N }, () => [5.8 + rnd() * 2.8, -1 + rnd() * 3] as const)
    const cpp = runCli(cases.map(([v, i]) => `soc ${v.toFixed(4)} ${i.toFixed(4)}`))
    cases.forEach(([v, i], k) => {
      // float (C++) vs double (TS): se tolera 0.1 % de SoC por redondeo
      expect(Math.abs(Number(cpp[k]) - estimateSoc(Number(v.toFixed(4)), Number(i.toFixed(4))))).toBeLessThanOrEqual(0.11)
    })
  })

  it('estimateLedPowerW', () => {
    const cases = Array.from({ length: N }, () => ({
      on: rnd() > 0.2,
      hex: rgbToHex(rnd() * 255, rnd() * 255, rnd() * 255),
      bri: Math.round(rnd() * 100),
      n: 1 + Math.round(rnd() * 59),
    }))
    const cpp = runCli(cases.map((c) => `led ${c.on ? 1 : 0} ${c.hex} ${c.bri} ${c.n}`))
    cases.forEach((c, k) => {
      expect(Number(cpp[k])).toBeCloseTo(estimateLedPowerW(c.on, c.hex, c.bri, c.n), 1)
    })
  })

  it('autoLightStep', () => {
    const cases = Array.from({ length: N }, () => ({
      on: rnd() > 0.5,
      last: Math.round(rnd() * 20000),
      changed: rnd() > 0.3,
      lux: Math.round(rnd() * 800) / 10,
      valid: rnd() > 0.1,
      now: 20000 + Math.round(rnd() * 10000),
      luxOn: 10 + Math.round(rnd() * 10),
      luxOff: 35 + Math.round(rnd() * 20),
      dwell: 5000,
    }))
    const cpp = runCli(cases.map((c) => `auto ${+c.on} ${c.last} ${+c.changed} ${c.lux} ${+c.valid} ${c.now} ${c.luxOn} ${c.luxOff} ${c.dwell}`))
    cases.forEach((c, k) => {
      const ts = autoLightStep({ on: c.on, lastChangeMs: c.changed ? c.last : -Infinity }, c.valid ? c.lux : null, c.now, {
        luxOn: c.luxOn,
        luxOff: c.luxOff,
        minDwellMs: c.dwell,
      })
      const [on] = cpp[k]!.split(' ')
      expect(Number(on) === 1).toBe(ts.on)
    })
  })

  it('evaluateAlerts', () => {
    const cases = Array.from({ length: N }, () => ({
      soc: rnd() * 100,
      charging: rnd() > 0.8,
      tempC: 20 + rnd() * 35,
      tempValid: rnd() > 0.1,
      usbV: 4.5 + rnd() * 1,
      usbI: rnd() * 2,
      luxOk: rnd() > 0.1,
      dhtOk: rnd() > 0.1,
      inaOk: rnd() > 0.1,
    }))
    const cpp = runCli(
      cases.map((c) => `alerts ${c.soc.toFixed(3)} ${+c.charging} ${c.tempC.toFixed(3)} ${+c.tempValid} ${c.usbV.toFixed(3)} ${c.usbI.toFixed(3)} ${+c.luxOk} ${+c.dhtOk} ${+c.inaOk}`),
    )
    cases.forEach((c, k) => {
      const ts = evaluateAlerts({
        soc: Number(c.soc.toFixed(3)),
        charging: c.charging,
        tempC: c.tempValid ? Number(c.tempC.toFixed(3)) : null,
        usbV: Number(c.usbV.toFixed(3)),
        usbI: Number(c.usbI.toFixed(3)),
        luxOk: c.luxOk,
        dhtOk: c.dhtOk,
        inaOk: c.inaOk,
      })
      expect(cpp[k]).toBe(ts.length ? ts.join(',') : '-')
    })
  })
})
