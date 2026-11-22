/**
 * Simulador de la ESP32 de SOLACE.
 * Se comporta como el firmware (firmware/solace_esp32): publica telemetría en el mismo JSON,
 * aplica las protecciones de la salida USB, el conteo de energía, la detección de carga
 * (dirección de la corriente del CH1) y la luz automática, y responde a los comandos de
 * /mainUser con un ack.
 *
 * Escenario (ciclo de 60 s que se repite, para ver todos los estados en la GUI):
 *    0–15 s  de día: el panel solar carga la batería
 *   15–40 s  de noche: la tira se enciende sola; a los 20 s se cierra el interruptor USB
 *            (carga de celular) y a los 34 s se abre (celular lleno)
 *   40–55 s  de noche con el cargador USB conectado: carga por USB con la luz encendida
 *   55–60 s  de noche, solo batería
 * Interruptores físicos (de enclavamiento): toggleSwitch('usb' | 'light'). En la terminal:
 * "u" + Enter = interruptor USB, "l" + Enter = interruptor de la luz. Si se mueve el
 * interruptor USB a mano, deja de moverse solo. "t" calienta / enfría el banco (prueba de la
 * protección térmica) y "d" corta la conexión 10 s (prueba de la GUI sin dispositivo).
 */
import mqtt, { type MqttClient } from 'mqtt'
import { Command, TOPICS, type Ack, type ChargeSource, type InaRange, type Telemetry, type TempGuard, type TempState } from '../shared/protocol.ts'
import {
  AUTO_DEFAULTS,
  AUTO_OFF,
  BATTERY,
  USB_CUT,
  autoLightStep,
  batMode,
  autonomyMin,
  avgPowerStep,
  batteryHyst,
  chargeSource,
  energyStep,
  estimateLedCurrentA,
  evaluateAlerts,
  ledLevel,
  socFromPackVoltage,
  tempStep,
  usbOutput,
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

type ModoLed = 'AUTO' | 'MANUAL_ON' | 'MANUAL_OFF'

/** Fases del ciclo de 60 s (segundos desde el inicio del ciclo). */
export const SIM_CYCLE = {
  periodS: 60,
  nightAtS: 15,
  switchOnS: 20,
  switchOffS: 34,
  usbChargerOnS: 40,
  usbChargerOffS: 55,
} as const

const ETA_5V = 0.9
const ESP32_W = 0.5
const PACK_R = 0.08
const AUTO_COLOR = '#FFFFFF'
const CAL_MAX_MA = 1500 // rango calibrado del INA3221
const SAT_MA = 1638 // el INA3221 satura con 163,8 mV en el shunt de 0,1 Ω

export class DeviceSimulator {
  private rnd: () => number
  private client: MqttClient | null = null
  private seq = 0
  private startMs = 0
  private lastMs: number | null = null
  readonly id: string
  readonly commands: Command[] = []

  // Estado del firmware
  private modo: ModoLed = 'MANUAL_OFF' // como el firmware: arranca en manual (sigue al interruptor)
  private ajustes = { color: '#FFFFFF', brillo: 80, luxOn: AUTO_DEFAULTS.luxOn, luxOff: AUTO_DEFAULTS.luxOff }
  private autoLuz: AutoLightState = { ...AUTO_OFF }
  private estTemp: TempState = 'SIN_DATO'
  private usbBatOk = false
  private usbPedido = false
  private guard: TempGuard = 'manual' // como el firmware: sin protecciones hasta elegir automático
  private sw = { usb: false, light: false }
  private swManual = false
  private hot = false
  private eWh: number
  private avgW: number | null = null
  private identifyUntil = 0
  private satSinceMs: number | null = null
  private usbBlockedUntil = 0
  private lastBatV: number

  // Escenario aleatorio (magnitudes; las fases son fijas)
  private ocv: number
  private luxDay: number
  private luxNight: number
  private panelW: number
  private usbChargerW: number
  private phoneA: number
  private tempC: number
  private pressHpa: number

  constructor(private readonly opts: SimOptions) {
    this.rnd = mulberry32(opts.seed)
    this.id = opts.id ?? `solace-sim-${(opts.seed % 0xffff).toString(16).padStart(4, '0')}`
    const r = this.rnd
    this.ocv = 7.2 + r() * 0.9 // 7.2–8.1 V
    this.luxDay = 8000 + r() * 12000 // sol: 8–20 klx
    this.luxNight = 1 + r() * 6 // noche: por debajo de 10 lx
    this.panelW = 4 + r() * 2 // potencia que el panel entrega a la batería
    this.usbChargerW = 13 + r() * 2 // cargador USB-C PD hacia el cargador 2S
    this.phoneA = 0.5 + r() * 0.5
    this.tempC = 22 + r() * 8
    this.pressHpa = 745 + r() * 15 // presión típica a ~2600 m (Bogotá)
    this.eWh = (BATTERY.usableWh * socFromPackVoltage(this.ocv)) / 100
    this.lastBatV = this.ocv
  }

  private log(line: string, kind: 'tx' | 'rx' | 'info' = 'info') {
    this.opts.log?.(line, kind)
  }

  private noise(amp: number) {
    return (this.rnd() * 2 - 1) * amp
  }

  private ledPedido() {
    return this.modo === 'MANUAL_ON' || (this.modo === 'AUTO' && this.autoLuz.on)
  }

  /**
   * Interruptor físico de enclavamiento, igual que el firmware: solo actúa al cambiar de posición
   * y CADA MOVIMIENTO ALTERNA el estado (como un interruptor de escalera). Así el interruptor y la
   * app comparten un único estado. Luz encendida desde el interruptor = blanco 100 %.
   */
  setSwitch(which: 'usb' | 'light', closed: boolean, manual = true) {
    if (manual && which === 'usb') this.swManual = true
    if (this.sw[which] === closed) return
    this.sw[which] = closed
    if (which === 'usb') {
      this.usbPedido = !this.usbPedido
      this.log(`Interruptor USB ${closed ? 'cerrado' : 'abierto'} → ${this.usbPedido ? 'ENCENDER' : 'apagar'}`)
    } else {
      const encender = !this.ledPedido()
      if (encender) {
        this.ajustes.color = '#FFFFFF'
        this.ajustes.brillo = 100
        this.modo = 'MANUAL_ON'
      } else this.modo = 'MANUAL_OFF'
      this.log(`Interruptor de luz ${closed ? 'cerrado' : 'abierto'} → ${encender ? 'BLANCO 100 %' : 'apagada'}`)
    }
  }

  toggleSwitch(which: 'usb' | 'light') {
    this.setSwitch(which, !this.sw[which])
  }

  /** Calienta el banco hasta ~53 °C o lo deja enfriar (para probar la protección térmica). */
  toggleHeat() {
    this.hot = !this.hot
    this.log(this.hot ? 'Calentando el banco…' : 'Enfriando el banco…')
  }

  buildTelemetry(nowMs: number): Telemetry {
    if (this.startMs === 0 && this.lastMs === null) this.startMs = nowMs
    const prevS = this.lastMs === null ? -1 : (this.lastMs - this.startMs) / 1000
    const dtS = this.lastMs === null ? 0 : Math.min(10, Math.max(0, (nowMs - this.lastMs) / 1000))
    this.lastMs = nowMs
    const tS = (nowMs - this.startMs) / 1000
    const cyc = tS % SIM_CYCLE.periodS
    const crossed = (at: number) => {
      // ¿pasó el instante `at` del ciclo entre la muestra anterior y esta?
      if (prevS < 0) return cyc >= at && cyc - at < 1e-9
      const k = Math.floor(tS / SIM_CYCLE.periodS) * SIM_CYCLE.periodS + at
      return prevS < k && tS >= k
    }

    // Interruptor USB automático (si nadie lo movió a mano)
    if (!this.swManual) {
      if (crossed(SIM_CYCLE.switchOnS)) this.setSwitch('usb', true, false)
      if (crossed(SIM_CYCLE.switchOffS)) this.setSwitch('usb', false, false)
    }

    // Luz ambiente: transición suave día → noche (y noche → día al reiniciar el ciclo)
    const k = 1 / (1 + Math.exp(-(cyc - SIM_CYCLE.nightAtS) * 3))
    const ambient = Math.max(0, this.luxDay * (1 - k) + this.luxNight * k + this.noise(this.luxDay * 0.02 * (1 - k) + 0.3))

    // Protecciones del USB (con la medición anterior, como el firmware)
    const target = this.hot ? 53 : 26
    this.tempC += Math.max(-1.2 * dtS, Math.min(1.2 * dtS, (target - this.tempC) * 0.15 * dtS)) + this.noise(0.05)
    this.pressHpa += this.noise(0.05)
    this.estTemp = tempStep(this.estTemp, this.tempC, true)
    this.usbBatOk = batteryHyst(this.usbBatOk, this.lastBatV, USB_CUT.offV, USB_CUT.onV)

    // Luz: sin cortes de protección
    if (this.modo === 'AUTO') this.autoLuz = autoLightStep(this.autoLuz, ambient, nowMs, { ...AUTO_DEFAULTS, luxOn: this.ajustes.luxOn, luxOff: this.ajustes.luxOff })
    const pedido = this.ledPedido()
    const color = this.modo === 'AUTO' ? AUTO_COLOR : this.ajustes.color
    const brillo = this.modo === 'AUTO' ? 100 : this.ajustes.brillo
    let level = pedido ? ledLevel(brillo) : 0
    let shownColor = color
    if (nowMs < this.identifyUntil) {
      shownColor = '#E2A64B'
      level = Math.floor((this.identifyUntil - nowMs) / 250) % 2 === 0 ? 255 : 0
    }
    const ledA = estimateLedCurrentA(shownColor, level)
    const ledV = 5.02 - ledA * 0.05 + this.noise(0.005)
    const [lr, lg, lb] = [shownColor.slice(1, 3), shownColor.slice(3, 5), shownColor.slice(5, 7)].map((h) => parseInt(h, 16))
    const selfLux = ((lr! + lg! + lb!) / 765) * (level / 255) * 25 // el sensor mira hacia afuera: poca luz propia
    const lux = ambient + selfLux

    // Salida USB: interruptor o app + protecciones
    const auto = this.guard === 'auto'
    const usbBlocked = auto && nowMs < this.usbBlockedUntil
    const usbOn = usbOutput(this.usbPedido, this.estTemp, this.guard, true, this.usbBatOk, usbBlocked)
    const usbA = usbOn ? Math.max(0, this.phoneA + this.noise(0.03)) : 0
    const usbV = usbOn ? 5.05 - usbA * 0.06 + this.noise(0.01) : 0

    // Fuentes de carga: panel (proporcional a la luz) y cargador USB
    const solarW = this.panelW * Math.min(1, ambient / 10000) * (1 + this.noise(0.03))
    const usbInput = cyc >= SIM_CYCLE.usbChargerOnS && cyc < SIM_CYCLE.usbChargerOffS
    const chargerW = usbInput ? this.usbChargerW * (1 + this.noise(0.01)) : 0

    // Batería (CH1, nodo de la batería): + descarga, − carga
    const loadW = (usbV * usbA) / ETA_5V + (ledV * ledA) / ETA_5V + ESP32_W
    const netW = loadW - solarW - chargerW
    const realA = netW / this.ocv
    const batV = this.ocv - realA * PACK_R + this.noise(0.004)
    this.ocv = Math.min(8.4, this.ocv - ((netW * dtS) / 3600 / BATTERY.usableWh) * 1.2)
    this.lastBatV = batV

    // Lo que mide el INA3221: se satura sobre ~1,64 A (la batería entrega más de lo que se ve)
    const st = (mA: number): InaRange => (Math.abs(mA) >= SAT_MA ? 'SATURADO' : Math.abs(mA) > CAL_MAX_MA ? 'FUERA_CAL' : 'OK')
    const batSt = st(realA * 1000)
    const batMa = Math.max(-SAT_MA, Math.min(SAT_MA, realA * 1000))
    const batA = batMa / 1000
    const batP = batV * batA

    // CH1 saturado 3 s con el USB encendido → USB bloqueado 30 s (como el firmware)
    if (auto && batSt === 'SATURADO' && usbOn) {
      this.satSinceMs ??= nowMs
      if (nowMs - this.satSinceMs > USB_CUT.satCutMs) {
        this.usbBlockedUntil = nowMs + USB_CUT.blockMs
        this.satSinceMs = null
        this.log('CH1 saturado: USB bloqueado 30 s')
      }
    } else this.satSinceMs = null

    // Energía, autonomía y carga
    if (dtS > 0) {
      this.eWh = energyStep(this.eWh, batP, dtS)
      this.avgW = avgPowerStep(this.avgW ?? batP, batP, dtS)
    } else if (this.avgW === null) this.avgW = batP
    const aut = autonomyMin(true, batMa, this.eWh, this.avgW)
    const soc = (100 * this.eWh) / BATTERY.usableWh
    const state = batMode(true, batMa, batP)
    const charging = state === 'charging'
    // El simulador emula el detector opcional de la entrada USB (PIN_USB_IN) cableado.
    const source: ChargeSource | null = chargeSource(charging, true, usbInput, lux)

    const usbSt = st(usbA * 1000)
    const ledSt = st(ledA * 1000)
    const clip = (amps: number) => Math.max(-SAT_MA, Math.min(SAT_MA, amps * 1000)) / 1000 // lo que ve el INA
    const r1 = (x: number) => Math.round(x * 10) / 10
    const r3 = (x: number) => Math.round(x * 1000) / 1000
    const ch = (v: number, a: number, s: InaRange) => ({ v: r3(v), i: r3(a), p: r3(v * a), st: s })
    return {
      v: 4,
      id: this.id,
      seq: this.seq++,
      uptime: Math.round(tS),
      env: {
        lux: r1(lux),
        luxState: lux < 54 ? 'BAJO_RANGO' : 'OK',
        tempC: r1(this.tempC),
        pressHpa: r1(this.pressHpa),
      },
      power: {
        bat: ch(batV, batA, batSt),
        usb: ch(usbV, clip(usbA), usbSt),
        led: ch(ledV, clip(ledA), ledSt),
      },
      bat: {
        soc: r1(soc),
        state,
        remainingWh: Math.round(this.eWh * 100) / 100,
        avgPowerW: r3(this.avgW),
        autonomyMin: aut >= 0 ? Math.round(aut) : null,
        capacityWh: BATTERY.usableWh,
        source,
        chargeW: charging ? r3(-batP) : null,
      },
      light: {
        mode: this.modo === 'AUTO' ? 'auto' : 'manual',
        on: pedido,
        color,
        brightness: brillo,
        luxOn: this.ajustes.luxOn,
        luxOff: this.ajustes.luxOff,
        outPct: Math.round((level * 100) / 255),
      },
      protect: {
        temp: this.estTemp,
        tempGuard: this.guard,
        usbRequested: this.usbPedido,
        usbOn,
        usbLowBat: auto && !this.usbBatOk,
        usbBlocked,
      },
      switches: { ...this.sw },
      alerts: evaluateAlerts({
        soc,
        charging,
        temp: this.estTemp,
        inaOk: true,
        usbLowBat: !this.usbBatOk,
        usbBlocked,
        inaRangeBad: batSt !== 'OK' || usbSt !== 'OK' || ledSt !== 'OK',
        usbOn,
        usbV,
        usbA,
        luxOk: true,
        guard: this.guard,
      }),
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
        if (cmd.mode === 'auto') {
          this.modo = 'AUTO'
          this.autoLuz = { ...AUTO_OFF }
        } else if (this.modo === 'AUTO') this.modo = this.ledPedido() ? 'MANUAL_ON' : 'MANUAL_OFF'
        break
      case 'setLight': {
        const touched = cmd.color !== undefined || cmd.brightness !== undefined
        if (cmd.color !== undefined) this.ajustes.color = cmd.color.toUpperCase()
        if (cmd.brightness !== undefined) this.ajustes.brillo = cmd.brightness
        if (cmd.on !== undefined) this.modo = cmd.on ? 'MANUAL_ON' : 'MANUAL_OFF'
        else if (touched) this.modo = 'MANUAL_ON'
        break
      }
      case 'setAuto':
        this.ajustes.luxOn = cmd.luxOn
        this.ajustes.luxOff = cmd.luxOff
        break
      case 'setUsb':
        this.usbPedido = cmd.on
        break
      case 'setTempGuard':
        this.guard = cmd.mode
        if (cmd.mode === 'manual') {
          this.usbBlockedUntil = 0 // en manual no hay bloqueos
          this.satSinceMs = null
        }
        break
      case 'identify':
        this.identifyUntil = nowMs + 1500
        break
    }
    return { id, ok: true }
  }

  private async connect() {
    const { host, port } = this.opts
    const client = await mqtt.connectAsync(`mqtt://${host}:${port}`, {
      clientId: this.id,
      username: 'device',
      reconnectPeriod: 0,
      connectTimeout: 5000,
      will: { topic: TOPICS.deviceStatus, payload: Buffer.from('offline'), qos: 1, retain: true },
    })
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
    this.client = client
  }

  /** Corta la conexión `ms` milisegundos (como si la ESP32 perdiera el WiFi) y reconecta. */
  dropConnection(ms = 10_000) {
    const c = this.client
    if (!c || this.done) return
    this.client = null
    this.log(`Conexión cortada ${Math.round(ms / 1000)} s (simula pérdida de WiFi)…`)
    c.stream.destroy() // sin DISCONNECT: el hub lo detecta como una caída
    c.end(true)
    setTimeout(() => {
      if (!this.done) this.connect().catch((e: Error) => this.log(`No se pudo reconectar: ${e.message}`))
    }, ms)
  }

  private done = false

  async run(): Promise<SimResult> {
    const { durationS, rateHz } = this.opts
    await this.connect()
    this.startMs = Date.now()
    this.lastMs = null

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

    this.done = true
    const client = this.client
    this.client = null
    if (client) {
      await client.publishAsync(TOPICS.deviceStatus, 'offline', { retain: true, qos: 1 })
      await client.endAsync()
    }
    return { sent: this.seq, commands: this.commands }
  }

  /** Publica de inmediato (p. ej. tras pulsar el botón), como el firmware. */
  publishTelemetry() {
    if (!this.client) return
    const t = this.buildTelemetry(Date.now())
    this.client.publish(TOPICS.deviceTelemetry, JSON.stringify(t))
    const carga = t.bat.state === 'charging' ? `CARGANDO (${t.bat.source}) ` : t.bat.state === 'discharging' ? 'en operación ' : `${t.bat.state} `
    this.log(
      `#${t.seq.toString().padStart(3)}  SoC ${(t.bat.soc ?? 0).toFixed(0).padStart(3)}%  ${carga.padEnd(20)} bat ${t.power.bat.p.toFixed(2).padStart(6)} W  ` +
        `usb ${t.protect.usbOn ? 'on ' : 'off'} ${t.power.usb.p.toFixed(2)} W  led ${t.power.led.p.toFixed(2)} W  ` +
        `${(t.env.lux ?? 0).toFixed(0).padStart(5)} lx  luz ${t.light.mode}/${t.light.on ? 'on ' : 'off'} ${t.light.color} ${t.light.outPct}%` +
        (t.alerts.length ? `  ⚠ ${t.alerts.join(',')}` : ''),
      'tx',
    )
  }
}
