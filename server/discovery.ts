/**
 * Descubrimiento del hub sin escribir IPs a mano.
 *
 * 1. Beacon UDP: el hub envía cada segundo un broadcast con {svc, mqtt, http}.
 *    La ESP32 escucha el puerto 47474 y toma la IP del remitente.
 * 2. mDNS/Bonjour: el hub anuncia el servicio _solace._tcp (respaldo para redes
 *    que filtran broadcast).
 */
import dgram from 'node:dgram'
import { Bonjour } from 'bonjour-service'
import { DISCOVERY } from '../shared/protocol.ts'

export interface BeaconPayload {
  svc: 'solace-hub'
  v: 1
  mqtt: number
  http: number
}

export interface BeaconOptions {
  mqttPort: number
  httpPort: number
  targets: string[]
  port?: number
  intervalMs?: number
}

export function encodeBeacon(mqttPort: number, httpPort: number): Buffer {
  const payload: BeaconPayload = { svc: 'solace-hub', v: 1, mqtt: mqttPort, http: httpPort }
  return Buffer.from(JSON.stringify(payload))
}

export function decodeBeacon(buf: Buffer): BeaconPayload | null {
  try {
    const obj = JSON.parse(buf.toString('utf8'))
    if (obj?.svc === 'solace-hub' && Number.isInteger(obj.mqtt) && obj.mqtt > 0) return obj as BeaconPayload
  } catch {
    /* paquete ajeno */
  }
  return null
}

export function startBeacon(opts: BeaconOptions): { stop: () => void } {
  const port = opts.port ?? DISCOVERY.udpPort
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  const msg = encodeBeacon(opts.mqttPort, opts.httpPort)
  let timer: NodeJS.Timeout | undefined
  let closed = false

  sock.on('error', () => {
    /* sin red: se reintenta en el siguiente tick */
  })
  sock.bind(0, () => {
    if (closed) return
    sock.setBroadcast(true)
    const tick = () => {
      for (const t of opts.targets) sock.send(msg, port, t, () => {})
    }
    tick()
    timer = setInterval(tick, opts.intervalMs ?? DISCOVERY.beaconIntervalMs)
  })

  return {
    stop() {
      closed = true
      if (timer) clearInterval(timer)
      try {
        sock.close()
      } catch {
        /* ya cerrado */
      }
    },
  }
}

/** Escucha el beacon (lo usa el simulador igual que la ESP32). */
export function discoverHub(opts: { timeoutMs?: number; port?: number } = {}): Promise<{ host: string; mqttPort: number; httpPort: number } | null> {
  const port = opts.port ?? DISCOVERY.udpPort
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    let done = false
    const finish = (v: { host: string; mqttPort: number; httpPort: number } | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        sock.close()
      } catch {
        /* noop */
      }
      resolve(v)
    }
    const timer = setTimeout(() => finish(null), opts.timeoutMs ?? 3000)
    sock.on('error', () => finish(null))
    sock.on('message', (buf, rinfo) => {
      const b = decodeBeacon(buf)
      if (b) finish({ host: rinfo.address, mqttPort: b.mqtt, httpPort: b.http })
    })
    sock.bind(port)
  })
}

export function advertiseMdns(mqttPort: number, httpPort: number): { stop: () => void } {
  const bonjour = new Bonjour()
  const svc = bonjour.publish({
    name: 'SOLACE Hub',
    type: DISCOVERY.mdnsType,
    protocol: 'tcp',
    port: mqttPort,
    txt: { http: String(httpPort), v: '1' },
  })
  svc.on?.('error', () => {
    /* nombre en uso u otra interfaz: no es crítico, queda el beacon UDP */
  })
  return {
    stop() {
      bonjour.unpublishAll(() => bonjour.destroy())
    },
  }
}
