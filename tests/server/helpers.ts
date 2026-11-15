import mqtt, { type MqttClient } from 'mqtt'
import { createHub, type Hub, type HubOptions } from '../../server/hub.ts'
import { FIRMWARE_SAMPLE } from '../fixtures.ts'

export { FIRMWARE_SAMPLE }

export async function startHub(opts: Partial<HubOptions> = {}): Promise<Hub> {
  return createHub({ httpPort: 0, mqttPort: 0, publicIp: '127.0.0.1', bindHost: '127.0.0.1', web: 'none', commandTimeoutMs: 800, ...opts })
}

export function wsClient(hub: Hub, role: string): Promise<MqttClient> {
  return mqtt.connectAsync(`ws://127.0.0.1:${hub.httpPort}/mqtt`, { username: role, reconnectPeriod: 0, connectTimeout: 3000 })
}

export function tcpDevice(hub: Hub, id = 'solace-test'): Promise<MqttClient> {
  return mqtt.connectAsync(`mqtt://127.0.0.1:${hub.mqttPort}`, {
    username: 'device',
    clientId: id,
    reconnectPeriod: 0,
    will: { topic: 'solace/device/status', payload: Buffer.from('offline'), qos: 1, retain: true },
  })
}

/** Espera el primer mensaje de `topic` que cumpla `pred`. */
export function nextMessage<T = unknown>(c: MqttClient, topic: string, pred: (p: T) => boolean = () => true, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      c.off('message', on)
      reject(new Error(`Timeout esperando ${topic}`))
    }, timeoutMs)
    const on = (t: string, buf: Buffer) => {
      if (t !== topic) return
      const p = JSON.parse(buf.toString()) as T
      if (!pred(p)) return
      clearTimeout(timer)
      c.off('message', on)
      resolve(p)
    }
    c.on('message', on)
  })
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
