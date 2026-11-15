import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MqttClient } from 'mqtt'
import type { Hub } from '../../server/hub.ts'
import { TOPICS, type Ack, type DeviceInfo, type HubStats, type LiveTelemetry } from '../../shared/protocol.ts'
import { FIRMWARE_SAMPLE, nextMessage, sleep, startHub, tcpDevice, wsClient } from './helpers.ts'

let hub: Hub
const clients: MqttClient[] = []
const track = <T extends MqttClient>(c: T) => (clients.push(c), c)

beforeEach(async () => {
  hub = await startHub()
})
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.endAsync(true).catch(() => {})))
  await hub.close()
})

describe('broker: ESP32 → hub → n suscriptores', () => {
  it('reenvía la telemetría enriquecida a todos los suscriptores', async () => {
    const subs = await Promise.all([1, 2, 3].map(() => wsClient(hub, 'listener').then(track)))
    await Promise.all(subs.map((s) => s.subscribeAsync('solace/live/#')))
    const device = track(await tcpDevice(hub))
    const got = Promise.all(subs.map((s) => nextMessage<LiveTelemetry>(s, TOPICS.liveTelemetry)))
    device.publish(TOPICS.deviceTelemetry, JSON.stringify(FIRMWARE_SAMPLE))
    const msgs = await got
    for (const m of msgs) {
      expect(m.id).toBe('solace-a1b2c3')
      expect(m.receivedAt).toBeTypeOf('number')
      expect(m.derived.remainingWh).toBeCloseTo((51.3 / 100) * 37, 1)
    }
    expect(hub.store.history()).toHaveLength(1)
  })

  it('la última telemetría queda retenida para quien llega tarde', async () => {
    const device = track(await tcpDevice(hub))
    device.publish(TOPICS.deviceTelemetry, JSON.stringify(FIRMWARE_SAMPLE))
    await sleep(150)
    const late = track(await wsClient(hub, 'listener'))
    const got = nextMessage<LiveTelemetry>(late, TOPICS.liveTelemetry)
    await late.subscribeAsync('solace/live/#')
    expect((await got).seq).toBe(42)
  })

  it('descarta telemetría inválida sin propagarla', async () => {
    const l = track(await wsClient(hub, 'listener'))
    await l.subscribeAsync(TOPICS.liveTelemetry)
    const device = track(await tcpDevice(hub))
    const seen: string[] = []
    l.on('message', (t) => seen.push(t))
    device.publish(TOPICS.deviceTelemetry, '{"v":1,"basura":true}')
    device.publish(TOPICS.deviceTelemetry, 'no es json')
    await sleep(250)
    expect(seen).toEqual([])
    expect(hub.store.latest).toBeNull()
  })

  it('publica el estado de conexión del dispositivo y cuenta los clientes por rol', async () => {
    const l = track(await wsClient(hub, 'listener'))
    await l.subscribeAsync('solace/live/#')
    const online = nextMessage<DeviceInfo>(l, TOPICS.liveDevice, (d) => d.online)
    const device = await tcpDevice(hub)
    expect((await online).ip).toBe('127.0.0.1')
    track(await wsClient(hub, 'main'))
    const stats = await nextMessage<HubStats>(l, TOPICS.liveHub, (s) => s.mains === 1 && s.devices === 1)
    expect(stats.listeners).toBe(1)
    expect(stats.listenerUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/listener$/)
    const offline = nextMessage<DeviceInfo>(l, TOPICS.liveDevice, (d) => !d.online)
    await device.endAsync()
    expect((await offline).online).toBe(false)
  })
})

describe('roles y permisos', () => {
  it('rechaza conexiones sin un rol válido', async () => {
    await expect(wsClient(hub, 'hacker')).rejects.toThrow()
  })

  it('un listener que intenta publicar es desconectado', async () => {
    const l = track(await wsClient(hub, 'listener'))
    const closed = new Promise<void>((r) => l.once('close', () => r()))
    l.publish(TOPICS.uiCmd, JSON.stringify({ id: 'x', cmd: { type: 'identify' } }))
    await closed
  })

  it('main no puede saltarse al hub publicando directo al dispositivo', async () => {
    const m = track(await wsClient(hub, 'main'))
    const closed = new Promise<void>((r) => m.once('close', () => r()))
    m.publish(TOPICS.deviceCmd, JSON.stringify({ id: 'x', type: 'identify' }))
    await closed
  })

  it('los navegadores no pueden suscribirse a los topics del dispositivo', async () => {
    const l = track(await wsClient(hub, 'listener'))
    // El broker niega la suscripción (SUBACK 128) y mqtt.js lo reporta como error.
    await expect(l.subscribeAsync(TOPICS.deviceCmd)).rejects.toThrow()
  })
})

describe('comandos: mainUser → hub → ESP32 → ack', () => {
  async function setup() {
    const device = track(await tcpDevice(hub))
    await device.subscribeAsync(TOPICS.deviceCmd)
    const main = track(await wsClient(hub, 'main'))
    await main.subscribeAsync('solace/live/#')
    await sleep(100)
    return { device, main }
  }

  it('valida, reenvía con id y devuelve el ack del dispositivo', async () => {
    const { device, main } = await setup()
    const atDevice = nextMessage<Record<string, unknown>>(device, TOPICS.deviceCmd)
    const event = nextMessage<{ kind: string }>(main, TOPICS.liveEvent, (e) => e.kind === 'command')
    main.publish(TOPICS.uiCmd, JSON.stringify({ id: 'c1', cmd: { type: 'setLight', color: '#FF0000', brightness: 50 } }))
    expect(await atDevice).toEqual({ type: 'setLight', color: '#FF0000', brightness: 50, id: 'c1' })
    expect((await event).kind).toBe('command')
    const ack = nextMessage<Ack>(main, TOPICS.liveAck)
    device.publish(TOPICS.deviceAck, JSON.stringify({ id: 'c1', ok: true }))
    expect(await ack).toEqual({ id: 'c1', ok: true })
  })

  it('rechaza comandos inválidos sin molestar al dispositivo', async () => {
    const { device, main } = await setup()
    const seen: string[] = []
    device.on('message', (t) => seen.push(t))
    const ack = nextMessage<Ack>(main, TOPICS.liveAck)
    main.publish(TOPICS.uiCmd, JSON.stringify({ id: 'bad', cmd: { type: 'setAuto', luxOn: 50, luxOff: 10 } }))
    const a = await ack
    expect(a.ok).toBe(false)
    expect(a.error).toMatch(/luxOff/)
    expect(seen).toEqual([])
  })

  it('avisa si el dispositivo no está conectado', async () => {
    const main = track(await wsClient(hub, 'main'))
    await main.subscribeAsync(TOPICS.liveAck)
    const ack = nextMessage<Ack>(main, TOPICS.liveAck)
    main.publish(TOPICS.uiCmd, JSON.stringify({ id: 'c2', cmd: { type: 'identify' } }))
    expect(await ack).toMatchObject({ id: 'c2', ok: false, error: 'El dispositivo no está conectado' })
  })

  it('genera un ack de error si el dispositivo no responde a tiempo', async () => {
    const { main } = await setup()
    const ack = nextMessage<Ack>(main, TOPICS.liveAck, () => true, 3000)
    main.publish(TOPICS.uiCmd, JSON.stringify({ id: 'slow', cmd: { type: 'identify' } }))
    expect(await ack).toMatchObject({ id: 'slow', ok: false, error: 'El dispositivo no respondió a tiempo' })
  })
})

describe('API HTTP', () => {
  it('expone info, historial, CSV y QR', async () => {
    const device = track(await tcpDevice(hub))
    device.publish(TOPICS.deviceTelemetry, JSON.stringify(FIRMWARE_SAMPLE))
    device.publish(TOPICS.deviceTelemetry, JSON.stringify({ ...FIRMWARE_SAMPLE, seq: 43 }))
    await sleep(200)
    const base = `http://127.0.0.1:${hub.httpPort}`

    const info = await fetch(`${base}/api/info`).then((r) => r.json())
    expect(info.device.online).toBe(true)
    expect(info.mainUrl).toMatch(/\/mainUser$/)
    expect(info.mqttPort).toBe(hub.mqttPort)

    const history = await fetch(`${base}/api/history?seconds=60`).then((r) => r.json())
    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({ soc: 51.3, batP: 6.409, lux: 3.1 })

    const latest = await fetch(`${base}/api/latest`).then((r) => r.json())
    expect(latest.seq).toBe(43)

    const csv = await fetch(`${base}/api/export.csv`)
    expect(csv.headers.get('content-type')).toMatch(/text\/csv/)
    expect((await csv.text()).trim().split('\n')).toHaveLength(3)

    const qr = await fetch(`${base}/api/qr.svg`)
    expect(qr.headers.get('content-type')).toMatch(/svg/)
    expect(await qr.text()).toContain('<svg')
  })
})
