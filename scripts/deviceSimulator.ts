/**
 * Simulador de la ESP32 de SOLACE.
 * Se comporta como el firmware: publica telemetría en el mismo formato JSON, aplica la
 * lógica de luz automática y responde a los comandos de /mainUser con un ack.
 */
import mqtt, { type MqttClient } from 'mqtt'
import { Command, TOPICS, type Ack, type LightMode, type Telemetry } from '../shared/protocol.ts'
import {
  AUTO_DEFAULTS,
  autoLightStep,
  estimateLedPowerW,
  estimateSoc,
  evaluateAlerts,
  hexToRgb,
  type AutoLightState,
} from '../shared/deviceLogic.ts'

/** PRNG determinista (mulberry32) para poder reproducir una simulación con --seed. */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SimOptions {
  host: string
  port: number
  durationS: number
  rateHz: number
  seed: number
  id?: string
  log?: (line: string, kind?: 'tx' | 'rx' | 'info') => void
}

export interface SimResult {
  sent: number
  commands: Command[]
}

const ETA_5V = 0.9
const ETA_3V = 0.85
const ESP32_W = 0.55

export class DeviceSimulator {
  private rnd: () => number
  private client: MqttClient | null = null
  private seq = 0
  private startMs = 0
  readonly id: string
  readonly commands: Command[] = []

  // Estado de la luz (igual que el firmware)
  private mode: LightMode = 'auto'
  private manual = { on: false, color: '#FFFFFF', brightness: 80 }
  private autoCfg = { ...AUTO_DEFAULTS }
  private auto: AutoLightState = { on: false, lastChangeMs: -Infinity }
  private identifyUntil = 0

  // Escenario aleatorio
  private ocv: number
  private luxDay: number
  private luxNight: number
  private darkAt: number
  private phoneAt: number
  private phoneA: number
  private tempC: number
  private hum: number

  constructor(private readonly opts: SimOptions) {
    this.rnd = mulberry32(opts.seed)
    this.id = opts.id ?? `solace-sim-${(opts.seed % 0xffff).toString(16).padStart(4, '0')}`
    const r = this.rnd
    this.ocv = 7.0 + r() * 1.3 // 7.0–8.3 V → SoC ~ 12–95 %
    this.luxDay = 60 + r() * 340
    this.luxNight = 1 + r() * 8
    this.darkAt = 0.25 + r() * 0.25 // fracción de la corrida en la que "anochece"
    this.phoneAt = r() < 0.7 ? r() * 0.5 : 2 // 70 %: se conecta un celular
    this.phoneA = 0.7 + r() * 0.9
    this.tempC = 22 + r() * 8
    this.hum = 40 + r() * 30
  }

  private log(line: string, kind: 'tx' | 'rx' | 'info' = 'info') {
    this.opts.log?.(line, kind)
  }

  private noise(amp: number) {
    return (this.rnd() * 2 - 1) * amp
  }

  /** Estado efectivo de la tira (en auto: blanco al 100 % cuando está oscuro). */
  effectiveLight(nowMs: number) {
    if (nowMs < this.identifyUntil) return { on: Math.floor(nowMs / 250) % 2 === 0, color: '#E2A64B', brightness: 100 }
    if (this.mode === 'auto') return { on: this.auto.on, color: '#FFFFFF', brightness: 100 }
    return { ...this.manual }
  }

  buildTelemetry(nowMs: number): Telemetry {
    const frac = Math.min(1, (nowMs - this.startMs) / 1000 / this.opts.durationS)
    // Luz ambiente: transición suave día → noche
    const k = 1 / (1 + Math.exp(-(frac - this.darkAt) * 30))
    const luxAmbient = Math.max(0, this.luxDay * (1 - k) + this.luxNight * k + this.noise(this.luxDay * 0.03 * (1 - k) + 0.5))

    this.auto = autoLightStep(this.auto, luxAmbient, nowMs, this.autoCfg)
    const light = this.effectiveLight(nowMs)
    const ledW = estimateLedPowerW(light.on, light.color, light.brightness)
    const [lr, lg, lb] = hexToRgb(light.color)
    const selfLux = light.on ? ((lr + lg + lb) / 765) * (light.brightness / 100) * 90 : 0

    const phoneOn = frac >= this.phoneAt
    const usbI = phoneOn ? Math.max(0, this.phoneA + this.noise(0.05)) : 0
    const usbV = 5.05 - usbI * 0.04 + this.noise(0.01)
    const radioI = 0.045 + this.rnd() * 0.035
    const radioV = 3.3 + this.noise(0.01)

    const loadW = (usbV * usbI) / ETA_5V + (radioV * radioI) / ETA_3V + ledW / ETA_5V + ESP32_W
    this.ocv -= (loadW / 37) * 0.0004 // descarga muy lenta, solo para que se note la tendencia
    const batI = loadW / this.ocv
    const batV = this.ocv - batI * 0.08 + this.noise(0.005)

    this.tempC += this.noise(0.08) + (light.on ? 0.01 : 0)
    this.hum = Math.min(95, Math.max(20, this.hum + this.noise(0.3)))
    const soc = estimateSoc(batV, batI)

    const r2 = (x: number) => Math.round(x * 100) / 100
    const r3 = (x: number) => Math.round(x * 1000) / 1000
    return {
      v: 1,
      id: this.id,
      seq: this.seq++,
      uptime: Math.round((nowMs - this.startMs) / 1000),
      env: {
        lux: r2(luxAmbient + selfLux),
        luxAmbient: r2(luxAmbient),
        tempC: Math.round(this.tempC * 10) / 10,
        hum: Math.round(this.hum),
      },
      power: {
        bat: { v: r3(batV), i: r3(batI), p: r2(batV * batI) },
        usb: { v: r3(usbV), i: r3(usbI), p: r2(usbV * usbI) },
        radio: { v: r3(radioV), i: r3(radioI), p: r3(radioV * radioI) },
        led: { p: ledW, est: true },
      },
      bat: { soc, charging: false },
      light: {
        mode: this.mode,
        on: light.on,
        color: light.color,
        brightness: light.brightness,
        luxOn: this.autoCfg.luxOn,
        luxOff: this.autoCfg.luxOff,
      },
      alerts: evaluateAlerts({ soc, charging: false, tempC: this.tempC, usbV, usbI, luxOk: true, dhtOk: true, inaOk: true }),
      net: { rssi: Math.round(-50 - this.rnd() * 20), ip: '192.168.0.99' },
    }
  }

  /** Aplica un comando como lo hace el firmware. Devuelve el ack. */
  applyCommand(raw: unknown, nowMs = Date.now()): Ack {
    const id = typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : 'desconocido'
    const parsed = Command.safeParse(raw)
    if (!parsed.success) return { id, ok: false, error: 'Comando no reconocido' }
    const cmd = parsed.data
    this.commands.push(cmd)
    switch (cmd.type) {
      case 'setMode':
        this.mode = cmd.mode
        if (cmd.mode === 'auto') this.auto = { on: this.auto.on, lastChangeMs: -Infinity }
        break
      case 'setLight':
        this.mode = 'manual'
        if (cmd.on !== undefined) this.manual.on = cmd.on
        if (cmd.color !== undefined) this.manual.color = cmd.color.toUpperCase()
        if (cmd.brightness !== undefined) this.manual.brightness = cmd.brightness
        if ((cmd.color !== undefined || cmd.brightness !== undefined) && cmd.on === undefined) this.manual.on = true
        break
      case 'setAuto':
        this.autoCfg.luxOn = cmd.luxOn
        this.autoCfg.luxOff = cmd.luxOff
        break
      case 'identify':
        this.identifyUntil = nowMs + 1500
        break
    }
    return { id, ok: true }
  }

  async run(): Promise<SimResult> {
    const { host, port, durationS, rateHz } = this.opts
    this.client = await mqtt.connectAsync(`mqtt://${host}:${port}`, {
      clientId: this.id,
      username: 'device',
      reconnectPeriod: 0,
      connectTimeout: 5000,
      will: { topic: TOPICS.deviceStatus, payload: Buffer.from('offline'), qos: 1, retain: true },
    })
    const client = this.client
    this.startMs = Date.now()
    this.log(`Conectado a mqtt://${host}:${port} como ${this.id}`)
    await client.publishAsync(TOPICS.deviceStatus, 'online', { retain: true, qos: 1 })
    await client.subscribeAsync(TOPICS.deviceCmd, { qos: 1 })

    client.on('message', (topic, payload) => {
      if (topic !== TOPICS.deviceCmd) return
      let raw: unknown = null
      try {
        raw = JSON.parse(payload.toString())
      } catch {
        /* inválido */
      }
      const ack = this.applyCommand(raw)
      this.log(`${JSON.stringify(raw)} → ${ack.ok ? 'OK' : ack.error}`, 'rx')
      client.publish(TOPICS.deviceAck, JSON.stringify(ack))
      this.publishTelemetry() // refleja el cambio de inmediato, como el firmware
    })

    const periodMs = 1000 / rateHz
    await new Promise<void>((resolve) => {
      const tick = () => {
        this.publishTelemetry()
        if (Date.now() - this.startMs >= durationS * 1000) {
          clearInterval(timer)
          resolve()
        }
      }
      const timer = setInterval(tick, periodMs)
      tick()
    })

    await client.publishAsync(TOPICS.deviceStatus, 'offline', { retain: true, qos: 1 })
    await client.endAsync()
    this.client = null
    return { sent: this.seq, commands: this.commands }
  }

  private publishTelemetry() {
    if (!this.client) return
    const t = this.buildTelemetry(Date.now())
    this.client.publish(TOPICS.deviceTelemetry, JSON.stringify(t))
    this.log(
      `#${t.seq.toString().padStart(3)}  SoC ${t.bat.soc.toFixed(0).padStart(3)}%  bat ${t.power.bat.p.toFixed(2)} W  usb ${t.power.usb.p.toFixed(2)} W  ` +
        `${(t.env.luxAmbient ?? 0).toFixed(0).padStart(4)} lx  ${t.env.tempC?.toFixed(1)} °C  luz ${t.light.mode}/${t.light.on ? 'on ' : 'off'} ${t.light.color}` +
        (t.alerts.length ? `  ⚠ ${t.alerts.join(',')}` : ''),
      'tx',
    )
  }
}
