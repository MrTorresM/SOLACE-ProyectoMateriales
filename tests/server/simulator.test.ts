/**
 * El simulador de la ESP32 contra el hub real: envío de telemetría y recepción de comandos.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MqttClient } from 'mqtt'
import type { Hub } from '../../server/hub.ts'
import { DeviceSimulator } from '../../scripts/deviceSimulator.ts'
import { TOPICS, Telemetry, type Ack, type LiveTelemetry } from '../../shared/protocol.ts'
import { nextMessage, startHub, wsClient } from './helpers.ts'

describe('DeviceSimulator (sin red)', () => {
  it('es determinista con la misma semilla', () => {
    const a = new DeviceSimulator({ host: '', port: 0, durationS: 20, rateHz: 1, seed: 99 })
    const b = new DeviceSimulator({ host: '', port: 0, durationS: 20, rateHz: 1, seed: 99 })
    expect(a.buildTelemetry(1000)).toEqual(b.buildTelemetry(1000))
  })

  it('genera valores físicamente plausibles', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const sim = new DeviceSimulator({ host: '', port: 0, durationS: 20, rateHz: 1, seed })
      for (let k = 0; k < 20; k++) {
        const t = Telemetry.parse(sim.buildTelemetry(k * 1000))
        expect(t.power.bat.v).toBeGreaterThan(6.5)
        expect(t.power.bat.v).toBeLessThan(8.5)
        expect(t.power.radio.v).toBeCloseTo(3.3, 1)
        expect(t.power.bat.p).toBeGreaterThan(t.power.usb.p) // la batería alimenta todo lo demás
        expect(t.env.tempC!).toBeGreaterThan(15)
        expect(t.env.tempC!).toBeLessThan(40)
      }
    }
  })

  it('en automático enciende la luz en blanco cuando anochece', () => {
    const sim = new DeviceSimulator({ host: '', port: 0, durationS: 20, rateHz: 1, seed: 4 })
    const first = sim.buildTelemetry(0)
    const last = sim.buildTelemetry(20_000)
    expect(first.light.on).toBe(false)
    expect(last.env.luxAmbient!).toBeLessThan(15)
    expect(last.light).toMatchObject({ mode: 'auto', on: true, color: '#FFFFFF', brightness: 100 })
    expect(last.env.lux!).toBeGreaterThan(last.env.luxAmbient!) // la tira ilumina al sensor
  })

  it('aplica los comandos como el firmware', () => {
    const sim = new DeviceSimulator({ host: '', port: 0, durationS: 20, rateHz: 1, seed: 4 })
    expect(sim.applyCommand({ id: 'a', type: 'setLight', color: '#00ff00' })).toEqual({ id: 'a', ok: true })
    let t = sim.buildTelemetry(1000)
    expect(t.light).toMatchObject({ mode: 'manual', on: true, color: '#00FF00' })
    sim.applyCommand({ id: 'b', type: 'setLight', on: false })
    expect(sim.buildTelemetry(2000).light.on).toBe(false)
    sim.applyCommand({ id: 'c', type: 'setAuto', luxOn: 5, luxOff: 20 })
    sim.applyCommand({ id: 'd', type: 'setMode', mode: 'auto' })
    t = sim.buildTelemetry(3000)
    expect(t.light).toMatchObject({ mode: 'auto', luxOn: 5, luxOff: 20 })
    expect(sim.applyCommand({ id: 'e', type: 'reboot' })).toMatchObject({ id: 'e', ok: false })
  })
})

describe('DeviceSimulator ↔ hub', () => {
  let hub: Hub
  let main: MqttClient
  beforeEach(async () => {
    hub = await startHub({ commandTimeoutMs: 2000 })
    main = await wsClient(hub, 'main')
    await main.subscribeAsync('solace/live/#')
  })
  afterEach(async () => {
    await main.endAsync(true)
    await hub.close()
  })

  it('publica telemetría válida y recibe comandos de /mainUser', async () => {
    const sim = new DeviceSimulator({ host: '127.0.0.1', port: hub.mqttPort, durationS: 2.5, rateHz: 8, seed: 21 })
    const telemetry: LiveTelemetry[] = []
    main.on('message', (t, b) => {
      if (t === TOPICS.liveTelemetry) telemetry.push(JSON.parse(b.toString()))
    })
    const run = sim.run()

    await nextMessage(main, TOPICS.liveDevice, (d: { online: boolean }) => d.online)
    const ack = nextMessage<Ack>(main, TOPICS.liveAck, (a) => a.id === 'cmd-1')
    main.publish(TOPICS.uiCmd, JSON.stringify({ id: 'cmd-1', cmd: { type: 'setLight', color: '#B400FF', brightness: 30 } }))
    expect(await ack).toEqual({ id: 'cmd-1', ok: true })

    const reflected = await nextMessage<LiveTelemetry>(main, TOPICS.liveTelemetry, (t) => t.light.color === '#B400FF')
    expect(reflected.light).toMatchObject({ mode: 'manual', on: true, brightness: 30 })

    const res = await run
    expect(res.sent).toBeGreaterThanOrEqual(15)
    expect(res.commands).toEqual([{ type: 'setLight', color: '#B400FF', brightness: 30 }])
    expect(telemetry.length).toBeGreaterThanOrEqual(15)
    for (const t of telemetry) expect(Telemetry.safeParse(t).success).toBe(true)
    // El hub registra todo en el historial
    expect(hub.store.history().length).toBe(telemetry.length)
    // Al terminar, el dispositivo queda desconectado
    await nextMessage(main, TOPICS.liveDevice, (d: { online: boolean }) => !d.online)
  })
})
