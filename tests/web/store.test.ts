import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { TOPICS, type LiveTelemetry } from '../../shared/protocol.ts'
import { connectHub, makeId } from '../../web/src/lib/hubClient.ts'
import { HISTORY_LIMIT, createStore, initialState, reduce } from '../../web/src/lib/store.ts'
import { colorName, fmtCurrent, fmtDuration, fmtLux, fmtPower, luxLabel, timeAgo } from '../../web/src/lib/format.ts'
import { routeFor } from '../../web/src/App.tsx'
import { liveSample } from './fixtures.ts'

describe('reducer', () => {
  it('guarda la telemetría y la agrega al historial', () => {
    const t = liveSample({ receivedAt: 1000 })
    const s = reduce(initialState, { type: 'message', topic: TOPICS.liveTelemetry, payload: t })
    expect(s.telemetry).toBe(t)
    expect(s.history).toHaveLength(1)
    expect(s.history[0]).toMatchObject({ t: 1000, soc: 51.3, lux: 3.1 })
  })

  it('ignora telemetría más vieja que la actual (retenida tras reconexión)', () => {
    let s = reduce(initialState, { type: 'message', topic: TOPICS.liveTelemetry, payload: liveSample({ receivedAt: 2000 }) })
    s = reduce(s, { type: 'message', topic: TOPICS.liveTelemetry, payload: liveSample({ receivedAt: 1000, seq: 1 }) })
    expect(s.telemetry!.receivedAt).toBe(2000)
  })

  it('fusiona el historial del servidor sin duplicar y con límite', () => {
    let s = reduce(initialState, { type: 'message', topic: TOPICS.liveTelemetry, payload: liveSample({ receivedAt: 5000 }) })
    const points = Array.from({ length: HISTORY_LIMIT + 50 }, (_, k) => ({ ...s.history[0]!, t: k * 10 }))
    s = reduce(s, { type: 'history', points: [...points, s.history[0]!] })
    expect(s.history).toHaveLength(HISTORY_LIMIT)
    expect(new Set(s.history.map((p) => p.t)).size).toBe(HISTORY_LIMIT)
    expect(s.history.at(-1)!.t).toBe(points.at(-1)!.t > 5000 ? points.at(-1)!.t : 5000)
  })

  it('maneja dispositivo, hub, eventos y toasts', () => {
    let s = reduce(initialState, { type: 'message', topic: TOPICS.liveDevice, payload: { online: true, id: 'x', ip: '1.2.3.4', lastSeen: 1 } })
    expect(s.device.online).toBe(true)
    s = reduce(s, { type: 'message', topic: TOPICS.liveEvent, payload: { kind: 'device', at: 1, online: true } })
    expect(s.events).toHaveLength(1)
    s = reduce(s, { type: 'toast', toast: { id: 't', kind: 'error', text: 'x' } })
    s = reduce(s, { type: 'dismiss', id: 't' })
    expect(s.toasts).toEqual([])
    expect(reduce(s, { type: 'message', topic: 'otro', payload: {} })).toBe(s)
    expect(reduce(s, { type: 'message', topic: TOPICS.liveDevice, payload: null })).toBe(s)
  })

  it('el store solo notifica cuando cambia algo', () => {
    const store = createStore()
    const fn = vi.fn()
    store.subscribe(fn)
    store.dispatch({ type: 'conn', conn: 'connecting' }) // igual al inicial
    store.dispatch({ type: 'conn', conn: 'online' })
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

/** mqtt.js falso para probar el cliente sin red. */
class FakeMqtt extends EventEmitter {
  published: { topic: string; payload: string }[] = []
  subscribed: string[] = []
  ended = false
  publish(topic: string, payload: string) {
    this.published.push({ topic, payload })
  }
  subscribe(topic: string) {
    this.subscribed.push(topic)
  }
  end() {
    this.ended = true
  }
  emitMsg(topic: string, payload: unknown) {
    this.emit('message', topic, Buffer.from(JSON.stringify(payload)))
  }
}

function fakeConnect() {
  const fake = new FakeMqtt()
  const opts: Record<string, unknown>[] = []
  const connect = ((_url: string, o: Record<string, unknown>) => {
    opts.push(o)
    return fake
  }) as never
  return { fake, connect, opts }
}

describe('hubClient', () => {
  it('se conecta con su rol, se suscribe a solace/live/# y alimenta el store', () => {
    const { fake, connect, opts } = fakeConnect()
    const store = createStore()
    connectHub('listener', store, { url: 'ws://x/mqtt', connect, fetchHistory: false })
    expect(opts[0]).toMatchObject({ username: 'listener' })
    fake.emit('connect')
    expect(store.getState().conn).toBe('online')
    expect(fake.subscribed).toEqual(['solace/live/#'])
    fake.emitMsg(TOPICS.liveTelemetry, liveSample())
    expect(store.getState().telemetry?.id).toBe('solace-a1b2c3')
    fake.emit('offline')
    expect(store.getState().conn).toBe('offline')
  })

  it('main publica el comando y resuelve con el ack correspondiente', async () => {
    const { fake, connect } = fakeConnect()
    const client = connectHub('main', createStore(), { url: 'ws://x/mqtt', connect, fetchHistory: false })
    const p = client.sendCommand({ type: 'setLight', color: '#00FF00' })
    expect(fake.published).toHaveLength(1)
    const env = JSON.parse(fake.published[0]!.payload)
    expect(fake.published[0]!.topic).toBe(TOPICS.uiCmd)
    expect(env.cmd).toEqual({ type: 'setLight', color: '#00FF00' })
    fake.emitMsg(TOPICS.liveAck, { id: 'otro', ok: false }) // ack ajeno: se ignora
    fake.emitMsg(TOPICS.liveAck, { id: env.id, ok: true })
    await expect(p).resolves.toEqual({ id: env.id, ok: true })
  })

  it('resuelve con error si no llega el ack', async () => {
    const { connect } = fakeConnect()
    const client = connectHub('main', createStore(), { url: 'ws://x/mqtt', connect, fetchHistory: false, ackTimeoutMs: 30 })
    await expect(client.sendCommand({ type: 'identify' })).resolves.toMatchObject({ ok: false, error: 'Sin respuesta del hub' })
  })

  it('listener no puede enviar comandos', async () => {
    const { fake, connect } = fakeConnect()
    const client = connectHub('listener', createStore(), { url: 'ws://x/mqtt', connect, fetchHistory: false })
    await expect(client.sendCommand({ type: 'identify' })).resolves.toMatchObject({ ok: false })
    expect(fake.published).toEqual([])
    client.close()
    expect(fake.ended).toBe(true)
  })

  it('genera ids únicos sin crypto.randomUUID (http en la LAN)', () => {
    expect(new Set(Array.from({ length: 500 }, makeId)).size).toBe(500)
  })
})

describe('formato y rutas', () => {
  it('formatea unidades en español', () => {
    expect(fmtPower(0.045)).toBe('45 mW')
    expect(fmtPower(6.409)).toBe('6,41 W')
    expect(fmtCurrent(0.842)).toBe('842 mA')
    expect(fmtDuration(185)).toBe('3 h 05 min')
    expect(fmtDuration(42)).toBe('42 min')
    expect(fmtDuration(null)).toBe('—')
    expect(fmtLux(3.14)).toBe('3,1 lx')
    expect(fmtLux(12500)).toBe('12,5 klx')
    expect(luxLabel(2)).toBe('Oscuro')
    expect(colorName('#ff0000')).toBe('Rojo')
    expect(timeAgo(0, 30_000)).toBe('hace 30 s')
  })

  it('enruta /listener, /mainUser y la portada', () => {
    expect(routeFor('/listener')).toEqual({ page: 'dashboard', role: 'listener' })
    expect(routeFor('/mainUser')).toEqual({ page: 'dashboard', role: 'main' })
    expect(routeFor('/mainuser/')).toEqual({ page: 'dashboard', role: 'main' })
    expect(routeFor('/')).toEqual({ page: 'landing' })
  })
})

export type { LiveTelemetry }
