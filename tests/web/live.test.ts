/**
 * Frontend + backend juntos: el cliente real del navegador (hubClient + store) conectado al
 * hub real por WebSocket, con el simulador de la ESP32 enviando y recibiendo.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Hub } from '../../server/hub.ts'
import { DeviceSimulator } from '../../scripts/deviceSimulator.ts'
import { connectHub, type HubClient } from '../../web/src/lib/hubClient.ts'
import { createStore, type HubState, type Store } from '../../web/src/lib/store.ts'
import { startHub } from '../server/helpers.ts'

function waitFor(store: Store, pred: (s: HubState) => boolean, timeoutMs = 4000): Promise<HubState> {
  return new Promise((resolve, reject) => {
    if (pred(store.getState())) return resolve(store.getState())
    const timer = setTimeout(() => {
      unsub()
      reject(new Error('timeout'))
    }, timeoutMs)
    const unsub = store.subscribe(() => {
      if (pred(store.getState())) {
        clearTimeout(timer)
        unsub()
        resolve(store.getState())
      }
    })
  })
}

describe('navegadores ↔ hub ↔ ESP32 simulada', () => {
  let hub: Hub
  const clients: HubClient[] = []
  beforeEach(async () => {
    hub = await startHub({ commandTimeoutMs: 2000 })
  })
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.close())
    await hub.close()
  })

  it('mainUser controla la luz y todos los listeners lo ven', async () => {
    const url = `ws://127.0.0.1:${hub.httpPort}/mqtt`
    const mainStore = createStore()
    const main = connectHub('main', mainStore, { url, fetchHistory: false })
    const listenerStores = [createStore(), createStore(), createStore()]
    listenerStores.forEach((s) => clients.push(connectHub('listener', s, { url, fetchHistory: false })))
    clients.push(main)

    const sim = new DeviceSimulator({ host: '127.0.0.1', port: hub.mqttPort, durationS: 3, rateHz: 6, seed: 8 })
    const run = sim.run()

    for (const s of [mainStore, ...listenerStores]) {
      const st = await waitFor(s, (x) => x.conn === 'online' && x.device.online && x.telemetry !== null)
      expect(st.telemetry!.id).toBe(sim.id)
    }
    await waitFor(listenerStores[0]!, (s) => s.hub?.listeners === 3 && s.hub.mains === 1)

    const ack = await main.sendCommand({ type: 'setLight', color: '#00FF00', brightness: 45 })
    expect(ack.ok).toBe(true)

    for (const s of listenerStores) {
      const st = await waitFor(s, (x) => x.telemetry?.light.color === '#00FF00')
      expect(st.telemetry!.light).toMatchObject({ mode: 'manual', on: true, brightness: 45 })
      expect(st.events.some((e) => e.kind === 'command')).toBe(true)
    }

    // El cliente listener no envía comandos (y el hub además lo bloquea, ver hub.test.ts).
    const lAck = await clients[0]!.sendCommand({ type: 'identify' })
    expect(lAck.ok).toBe(false)

    await run
    for (const s of listenerStores) {
      const st = await waitFor(s, (x) => !x.device.online)
      expect(st.history.length).toBeGreaterThanOrEqual(10)
    }
  })
})
