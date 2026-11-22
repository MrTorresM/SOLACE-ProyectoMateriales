import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { broadcastAddress, getLanAddress } from '../../server/network.ts'
import { decodeBeacon, discoverHub, encodeBeacon, startBeacon } from '../../server/discovery.ts'
import { CSV_HEADER, TelemetryStore } from '../../server/telemetryStore.ts'
import { Telemetry } from '../../shared/protocol.ts'
import { FIRMWARE_SAMPLE } from '../fixtures.ts'

const sample = Telemetry.parse(FIRMWARE_SAMPLE)

describe('red local', () => {
  it('calcula la dirección de broadcast', () => {
    expect(broadcastAddress('192.168.1.57', '255.255.255.0')).toBe('192.168.1.255')
    expect(broadcastAddress('10.20.30.40', '255.255.240.0')).toBe('10.20.31.255')
    expect(() => broadcastAddress('300.1.1.1', '255.255.255.0')).toThrow()
  })

  it('prefiere la WiFi (en0) sobre VPNs y puentes', () => {
    const ifaces = {
      lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true }],
      utun3: [{ address: '10.8.0.2', netmask: '255.255.255.0', family: 'IPv4', internal: false }],
      bridge100: [{ address: '192.168.64.1', netmask: '255.255.255.0', family: 'IPv4', internal: false }],
      en0: [
        { address: 'fe80::1', netmask: 'ffff::', family: 'IPv6', internal: false },
        { address: '192.168.86.22', netmask: '255.255.255.0', family: 'IPv4', internal: false },
      ],
    } as unknown as NodeJS.Dict<os.NetworkInterfaceInfo[]>
    expect(getLanAddress(ifaces, undefined)).toEqual({ iface: 'en0', ip: '192.168.86.22', netmask: '255.255.255.0', broadcast: '192.168.86.255' })
    expect(getLanAddress(ifaces, '10.8.0.2')?.iface).toBe('utun3')
    expect(getLanAddress({}, undefined)).toBeNull()
  })
})

describe('descubrimiento por beacon UDP', () => {
  it('codifica y decodifica', () => {
    expect(decodeBeacon(encodeBeacon(1883, 8080))).toEqual({ svc: 'solace-hub', v: 1, mqtt: 1883, http: 8080 })
    expect(decodeBeacon(Buffer.from('{"svc":"otro","mqtt":1}'))).toBeNull()
    expect(decodeBeacon(Buffer.from('\x00\x01'))).toBeNull()
  })

  it('el simulador (igual que la ESP32) encuentra el hub', async () => {
    const port = 40000 + Math.floor(Math.random() * 10000)
    const beacon = startBeacon({ mqttPort: 18833, httpPort: 8088, targets: ['127.0.0.1'], port, intervalMs: 100 })
    try {
      expect(await discoverHub({ port, timeoutMs: 2000 })).toEqual({ host: '127.0.0.1', mqttPort: 18833, httpPort: 8088 })
    } finally {
      beacon.stop()
    }
  })

  it('devuelve null si no hay hub', async () => {
    expect(await discoverHub({ port: 40000 + Math.floor(Math.random() * 10000), timeoutMs: 300 })).toBeNull()
  })
})

describe('TelemetryStore', () => {
  it('integra la energía consumida en la sesión', () => {
    const s = new TelemetryStore()
    const t0 = 1_000_000
    for (let k = 0; k <= 60; k++) s.ingest(sample, t0 + k * 1000) // 10.095 W durante 60 s
    expect(s.latest!.derived.energyWh).toBeCloseTo((10.095 * 60) / 3600, 3)
    // La autonomía y la energía restante vienen del firmware, tal cual
    expect(s.latest!.bat).toMatchObject({ remainingWh: 16.16, autonomyMin: 97, state: 'discharging' })
  })

  it('no inventa energía en huecos largos (ESP32 desconectada)', () => {
    const s = new TelemetryStore()
    s.ingest(sample, 0)
    s.ingest(sample, 3_600_000) // una hora después
    expect(s.latest!.derived.energyWh).toBeLessThanOrEqual((10.095 * 5) / 3600) // como máximo 5 s de hueco
  })

  it('no cuenta energía mientras carga', () => {
    const s = new TelemetryStore()
    const charging = { ...sample, power: { ...sample.power, bat: { ...sample.power.bat, i: -0.8, p: -6.4 } }, bat: { ...sample.bat, state: 'charging' as const } }
    s.ingest(charging, 0)
    s.ingest(charging, 1000)
    expect(s.latest!.derived.energyWh).toBe(0)
  })

  it('limita el historial y lo filtra por tiempo', () => {
    const s = new TelemetryStore(10)
    for (let k = 0; k < 25; k++) s.ingest(sample, k * 1000)
    expect(s.history()).toHaveLength(10)
    expect(s.history(20_000)).toHaveLength(5)
  })

  it('escribe un CSV por sesión', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solace-'))
    const s = new TelemetryStore(100, dir)
    s.ingest(sample, 0)
    s.ingest(sample, 1000)
    await s.close()
    const lines = fs.readFileSync(s.csvPath!, 'utf8').trim().split('\n')
    expect(lines[0]).toBe(CSV_HEADER)
    expect(lines).toHaveLength(3)
    expect(lines[1]!.split(',')).toHaveLength(CSV_HEADER.split(',').length)
    const row = Object.fromEntries(CSV_HEADER.split(',').map((k, i) => [k, lines[1]!.split(',')[i]]))
    expect(row).toMatchObject({ soc_pct: '51.3', led_w: '4.543', temp_state: 'NORMAL', usb_requested: '1', usb_on: '1', charge_source: '', out_pct: '80', alerts: '' })
    fs.rmSync(dir, { recursive: true })
  })
})
