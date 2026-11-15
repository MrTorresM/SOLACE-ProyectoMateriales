/**
 * Hub SOLACE: corre en el Mac.
 *
 *   ESP32 ──MQTT TCP :1883──▶ ┌────────────── Hub ──────────────┐
 *                             │ broker Aedes (pub/sub)           │ ──MQTT/WS /mqtt──▶ n navegadores
 *                             │ valida, enriquece, guarda CSV    │
 *                             └──────────────────────────────────┘
 *
 * Roles (username MQTT):
 *   device   → publica solace/device/{telemetry,status,ack}; se suscribe a solace/device/cmd
 *   main     → solo publica solace/ui/cmd (el hub valida y reenvía al dispositivo)
 *   listener → solo se suscribe a solace/live/#; cualquier publicación se rechaza
 */
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import QRCode from 'qrcode'
import { WebSocketServer, createWebSocketStream } from 'ws'
import { Aedes, type Client } from 'aedes'
import {
  Ack,
  ROLES,
  TOPICS,
  Telemetry,
  UiCommandEnvelope,
  type DeviceCommand,
  type DeviceInfo,
  type HubEvent,
  type HubStats,
  type LiveTelemetry,
  type Role,
} from '../shared/protocol.ts'
import { TelemetryStore, CSV_HEADER, toCsvRow } from './telemetryStore.ts'
import { advertiseMdns, startBeacon } from './discovery.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export interface HubOptions {
  /** Puerto HTTP (web + WebSocket MQTT). 0 = aleatorio. */
  httpPort: number
  /** Puerto MQTT TCP para la ESP32. 0 = aleatorio. */
  mqttPort: number
  /** IP de la red local usada para construir las URLs públicas. */
  publicIp: string
  bindHost?: string
  /** 'vite' = middleware de desarrollo con HMR; 'static' = sirve dist/; 'none' = solo API. */
  web?: 'vite' | 'static' | 'none'
  /** Destinos del beacon UDP (broadcast). Vacío = sin beacon. */
  beaconTargets?: string[]
  beaconPort?: number
  mdns?: boolean
  /** Carpeta para los CSV de sesión. null = no guardar. */
  logDir?: string | null
  historySize?: number
  commandTimeoutMs?: number
  log?: (msg: string) => void
}

export interface Hub {
  httpPort: number
  mqttPort: number
  listenerUrl: string
  mainUrl: string
  store: TelemetryStore
  broker: Aedes
  stats(): HubStats
  device(): DeviceInfo
  onTelemetry(cb: (t: LiveTelemetry) => void): void
  onChange(cb: () => void): void
  close(): Promise<void>
}

export async function createHub(opts: HubOptions): Promise<Hub> {
  const log = opts.log ?? (() => {})
  const store = new TelemetryStore(opts.historySize ?? 1800, opts.logDir ?? null)
  const roles = new Map<Client, Role>()
  const pending = new Map<string, NodeJS.Timeout>()
  const telemetryListeners: ((t: LiveTelemetry) => void)[] = []
  const changeListeners: (() => void)[] = []
  const startedAt = Date.now()
  let deviceInfo: DeviceInfo = { online: false, id: null, ip: null, lastSeen: null }
  let lastInvalidLog = 0

  const broker = await Aedes.createBroker({
    authenticate(client, username, _password, done) {
      const role = (username ?? '') as Role
      if (!ROLES.includes(role)) {
        const err = Object.assign(new Error('Rol desconocido'), { returnCode: 4 as const })
        return done(err, false)
      }
      roles.set(client, role)
      done(null, true)
    },
    authorizePublish(client, packet, cb) {
      if (!client) return cb(null) // LWT diferido emitido por el propio broker
      const role = roles.get(client)
      const t = packet.topic
      const ok =
        (role === 'device' && t.startsWith('solace/device/') && t !== TOPICS.deviceCmd) ||
        (role === 'main' && t === TOPICS.uiCmd)
      cb(ok ? null : new Error(`El rol ${role ?? '?'} no puede publicar en ${t}`))
    },
    authorizeSubscribe(client, sub, cb) {
      const role = roles.get(client)
      const t = sub.topic
      const ok =
        (role === 'device' && t === TOPICS.deviceCmd) ||
        ((role === 'main' || role === 'listener') && (t === 'solace/live/#' || t.startsWith('solace/live/')))
      cb(null, ok ? sub : null)
    },
  })

  // ─── Publicación interna ──────────────────────────────────────────────────────
  // Las publicaciones del hub van en cola: un mensaje retenido se guarda de forma asíncrona y,
  // si otro mensaje lo adelanta, Aedes descarta el retenido como "duplicado" (contador menor)
  // para los suscriptores de solace/live/#. Serializar preserva el orden y evita la pérdida.
  let queue: Promise<void> = Promise.resolve()
  const publish = (topic: string, payload: unknown, retain = false, qos: 0 | 1 = 0) => {
    const buf = Buffer.from(JSON.stringify(payload))
    queue = queue.then(
      () => new Promise<void>((resolve) => broker.publish({ cmd: 'publish', topic, payload: buf, qos, retain, dup: false }, () => resolve())),
    )
    return queue
  }

  const countRole = (r: Role) => [...roles.values()].filter((x) => x === r).length

  let listenerUrl = ''
  let mainUrl = ''
  const stats = (): HubStats => ({
    listeners: countRole('listener'),
    mains: countRole('main'),
    devices: countRole('device'),
    startedAt,
    listenerUrl,
    mainUrl,
  })

  let statsTimer: NodeJS.Timeout | undefined
  const scheduleStats = () => {
    clearTimeout(statsTimer)
    statsTimer = setTimeout(() => {
      void publish(TOPICS.liveHub, stats(), true)
      changeListeners.forEach((f) => f())
    }, 150)
  }

  const setDevice = (patch: Partial<DeviceInfo>) => {
    const next = { ...deviceInfo, ...patch }
    const changed = next.online !== deviceInfo.online || next.id !== deviceInfo.id || next.ip !== deviceInfo.ip
    deviceInfo = next
    if (changed) {
      void publish(TOPICS.liveDevice, deviceInfo, true)
      changeListeners.forEach((f) => f())
    }
  }

  // ─── Ciclo de vida de clientes ─────────────────────────────────────────────────
  broker.on('clientReady', (client) => {
    const role = roles.get(client)
    if (role === 'device') {
      const ip = remoteIp(client)
      setDevice({ online: true, ip, lastSeen: Date.now() })
      const ev: HubEvent = { kind: 'device', at: Date.now(), online: true }
      void publish(TOPICS.liveEvent, ev)
      log(`ESP32 conectada desde ${ip ?? '?'} (${client.id})`)
    }
    scheduleStats()
  })

  broker.on('clientDisconnect', (client) => {
    const role = roles.get(client)
    roles.delete(client)
    if (role === 'device' && countRole('device') === 0) {
      setDevice({ online: false })
      const ev: HubEvent = { kind: 'device', at: Date.now(), online: false }
      void publish(TOPICS.liveEvent, ev)
      log('ESP32 desconectada')
    }
    scheduleStats()
  })

  broker.on('clientError', (client, err) => {
    if (/no puede publicar/.test(err.message)) log(`Publicación rechazada (${client.id}): ${err.message}`)
  })

  // ─── Mensajes entrantes ────────────────────────────────────────────────────────
  broker.on('publish', (packet, client) => {
    if (!client) return
    const role = roles.get(client)
    if (role === 'device') {
      if (packet.topic === TOPICS.deviceTelemetry) handleTelemetry(packet.payload as Buffer)
      else if (packet.topic === TOPICS.deviceAck) handleDeviceAck(packet.payload as Buffer)
    } else if (role === 'main' && packet.topic === TOPICS.uiCmd) {
      handleUiCommand(packet.payload as Buffer, client.id)
    }
  })

  function handleTelemetry(buf: Buffer) {
    const parsed = Telemetry.safeParse(safeJson(buf))
    if (!parsed.success) {
      if (Date.now() - lastInvalidLog > 5000) {
        lastInvalidLog = Date.now()
        log(`Telemetría inválida descartada: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`)
      }
      return
    }
    const live = store.ingest(parsed.data)
    setDevice({ online: true, id: parsed.data.id, lastSeen: live.receivedAt })
    void publish(TOPICS.liveTelemetry, live, true)
    telemetryListeners.forEach((f) => f(live))
  }

  function handleDeviceAck(buf: Buffer) {
    const parsed = Ack.safeParse(safeJson(buf))
    if (!parsed.success) return
    const timer = pending.get(parsed.data.id)
    if (timer) {
      clearTimeout(timer)
      pending.delete(parsed.data.id)
    }
    void publish(TOPICS.liveAck, parsed.data)
  }

  function handleUiCommand(buf: Buffer, clientId: string) {
    const raw = safeJson(buf) as { id?: unknown } | null
    const parsed = UiCommandEnvelope.safeParse(raw)
    const id = typeof raw?.id === 'string' ? raw.id : 'desconocido'
    if (!parsed.success) {
      const ack: Ack = { id, ok: false, error: `Comando inválido: ${parsed.error.issues[0]?.message ?? 'formato'}` }
      void publish(TOPICS.liveAck, ack)
      return
    }
    if (!deviceInfo.online) {
      const ack: Ack = { id, ok: false, error: 'El dispositivo no está conectado' }
      void publish(TOPICS.liveAck, ack)
      return
    }
    const deviceCmd: DeviceCommand = { ...parsed.data.cmd, id: parsed.data.id }
    void publish(TOPICS.deviceCmd, deviceCmd, false, 1)
    const ev: HubEvent = { kind: 'command', at: Date.now(), cmd: parsed.data.cmd, clientId }
    void publish(TOPICS.liveEvent, ev)
    pending.set(
      parsed.data.id,
      setTimeout(() => {
        pending.delete(parsed.data.id)
        const ack: Ack = { id: parsed.data.id, ok: false, error: 'El dispositivo no respondió a tiempo' }
        void publish(TOPICS.liveAck, ack)
      }, opts.commandTimeoutMs ?? 4000),
    )
  }

  // ─── Servidores ────────────────────────────────────────────────────────────────
  const mqttServer = net.createServer(broker.handle)
  const app = express()
  const httpServer = http.createServer(app)
  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', (ws, req) => broker.handle(createWebSocketStream(ws), req))
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url?.split('?')[0] === '/mqtt') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
    }
    // Otros upgrades (HMR de Vite) los atiende Vite.
  })

  app.get('/api/info', (_req, res) => {
    res.json({ ...stats(), mqttPort: mqttActualPort(), device: deviceInfo, csvPath: store.csvPath })
  })
  app.get('/api/history', (req, res) => {
    const seconds = Number(req.query.seconds)
    const since = Number.isFinite(seconds) && seconds > 0 ? Date.now() - seconds * 1000 : undefined
    res.json(store.history(since))
  })
  app.get('/api/latest', (_req, res) => {
    res.json(store.latest)
  })
  app.get('/api/export.csv', (_req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="solace-${new Date().toISOString().slice(0, 19)}.csv"`)
    // El historial en memoria se reconstruye como CSV con las columnas disponibles.
    const rows = store.history().map((p) => [new Date(p.t).toISOString(), p.t, p.soc, p.batV, p.batI, p.batP, p.usbP, p.radioP, p.ledP, p.lux ?? '', p.tempC ?? '', p.hum ?? ''].join(','))
    res.send(['t_iso,t_ms,soc_pct,bat_v,bat_a,bat_w,usb_w,radio_w,led_w_est,lux,temp_c,hum_pct', ...rows].join('\n'))
  })
  app.get('/api/qr.svg', async (req, res) => {
    const url = req.query.target === 'main' ? mainUrl : listenerUrl
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#173B43', light: '#F8F8F5' } })
    res.setHeader('Content-Type', 'image/svg+xml')
    res.send(svg)
  })

  let vite: { close(): Promise<void>; middlewares: express.RequestHandler } | null = null
  const web = opts.web ?? 'none'
  if (web === 'vite') {
    const { createServer } = await import('vite')
    vite = await createServer({
      configFile: path.join(ROOT, 'vite.config.ts'),
      server: { middlewareMode: true, hmr: { server: httpServer } },
      appType: 'spa',
    })
    app.use(vite.middlewares)
  } else if (web === 'static') {
    const dist = path.join(ROOT, 'dist')
    app.use(express.static(dist))
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next()
      res.sendFile(path.join(dist, 'index.html'))
    })
  }

  const bindHost = opts.bindHost ?? '0.0.0.0'
  await new Promise<void>((resolve, reject) => {
    mqttServer.once('error', reject)
    mqttServer.listen(opts.mqttPort, bindHost, () => resolve())
  })
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(opts.httpPort, bindHost, () => resolve())
  })
  const mqttActualPort = () => (mqttServer.address() as net.AddressInfo).port
  const httpPort = (httpServer.address() as net.AddressInfo).port
  const mqttPort = mqttActualPort()
  const base = `http://${opts.publicIp}:${httpPort}`
  listenerUrl = `${base}/listener`
  mainUrl = `${base}/mainUser`

  await publish(TOPICS.liveDevice, deviceInfo, true)
  await publish(TOPICS.liveHub, stats(), true)

  const beacon = opts.beaconTargets?.length
    ? startBeacon({ mqttPort, httpPort, targets: opts.beaconTargets, port: opts.beaconPort })
    : null
  const mdns = opts.mdns ? advertiseMdns(mqttPort, httpPort) : null

  return {
    httpPort,
    mqttPort,
    listenerUrl,
    mainUrl,
    store,
    broker,
    stats,
    device: () => deviceInfo,
    onTelemetry: (cb) => telemetryListeners.push(cb),
    onChange: (cb) => changeListeners.push(cb),
    async close() {
      clearTimeout(statsTimer)
      pending.forEach((t) => clearTimeout(t))
      beacon?.stop()
      mdns?.stop()
      await vite?.close()
      for (const c of wss.clients) c.terminate()
      await new Promise<void>((r) => broker.close(() => r()))
      await new Promise<void>((r) => mqttServer.close(() => r()))
      httpServer.closeAllConnections()
      await new Promise<void>((r) => httpServer.close(() => r()))
      await store.close()
    },
  }
}

function safeJson(buf: Buffer): unknown {
  try {
    return JSON.parse(buf.toString('utf8'))
  } catch {
    return null
  }
}

function remoteIp(client: Client): string | null {
  const addr = (client.conn as net.Socket).remoteAddress ?? client.req?.socket.remoteAddress ?? null
  return addr ? addr.replace(/^::ffff:/, '') : null
}

export { CSV_HEADER, toCsvRow }
