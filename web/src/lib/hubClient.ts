/**
 * Cliente MQTT-sobre-WebSocket del navegador. Cada pestaña es un suscriptor del broker
 * del hub; solo el rol "main" puede publicar comandos (el hub lo hace cumplir).
 */
import mqtt, { type MqttClient } from 'mqtt'
import { TOPICS, type Ack, type Command, type Role } from '../../../shared/protocol.ts'
import type { Store } from './store.ts'

export interface HubClient {
  readonly role: Exclude<Role, 'device'>
  sendCommand(cmd: Command): Promise<Ack>
  close(): void
}

export interface ConnectOptions {
  url?: string
  /** Para pruebas: inyectar una implementación de mqtt.connect. */
  connect?: (url: string, opts: mqtt.IClientOptions) => MqttClient
  fetchHistory?: boolean
  ackTimeoutMs?: number
}

/** Id corto para comandos. (crypto.randomUUID no existe en http:// fuera de localhost.) */
export function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function defaultBrokerUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/mqtt`
}

export function connectHub(role: 'main' | 'listener', store: Store, opts: ConnectOptions = {}): HubClient {
  const url = opts.url ?? defaultBrokerUrl()
  const connect = opts.connect ?? mqtt.connect
  const pending = new Map<string, { resolve: (a: Ack) => void; timer: ReturnType<typeof setTimeout> }>()
  const client = connect(url, {
    username: role,
    clientId: `${role}-${makeId()}`,
    reconnectPeriod: 2000,
    connectTimeout: 6000,
    clean: true,
  })

  client.on('connect', () => {
    store.dispatch({ type: 'conn', conn: 'online' })
    client.subscribe('solace/live/#')
    if (opts.fetchHistory !== false) {
      fetch('/api/history?seconds=1800')
        .then((r) => (r.ok ? r.json() : []))
        .then((points) => store.dispatch({ type: 'history', points }))
        .catch(() => {})
    }
  })
  client.on('reconnect', () => store.dispatch({ type: 'conn', conn: 'connecting' }))
  client.on('offline', () => store.dispatch({ type: 'conn', conn: 'offline' }))
  client.on('close', () => {
    if (store.getState().conn === 'online') store.dispatch({ type: 'conn', conn: 'offline' })
  })
  client.on('message', (topic, buf) => {
    // Mensaje vacío = el hub borró el retenido (p. ej. la telemetría al desconectarse la ESP32).
    if (buf.length === 0) return store.dispatch({ type: 'message', topic, payload: null })
    let payload: unknown
    try {
      payload = JSON.parse(buf.toString())
    } catch {
      return
    }
    if (topic === TOPICS.liveAck) {
      const ack = payload as Ack
      const p = pending.get(ack.id)
      if (p) {
        clearTimeout(p.timer)
        pending.delete(ack.id)
        p.resolve(ack)
      }
      return
    }
    store.dispatch({ type: 'message', topic, payload })
  })

  return {
    role,
    sendCommand(cmd) {
      if (role !== 'main') return Promise.resolve({ id: '', ok: false, error: 'Solo /mainUser puede enviar comandos' })
      const id = makeId()
      return new Promise<Ack>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          resolve({ id, ok: false, error: 'Sin respuesta del hub' })
        }, opts.ackTimeoutMs ?? 6000)
        pending.set(id, { resolve, timer })
        client.publish(TOPICS.uiCmd, JSON.stringify({ id, cmd }))
      })
    },
    close() {
      pending.forEach((p) => clearTimeout(p.timer))
      client.end(true)
    },
  }
}
