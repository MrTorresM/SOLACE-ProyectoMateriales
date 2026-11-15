/**
 * SOLACE — contrato de mensajes entre ESP32, hub (Mac) y clientes web.
 *
 *   ESP32 ──MQTT/TCP──▶ Hub (Mac, broker Aedes) ──MQTT/WebSocket──▶ n suscriptores
 *
 * El firmware (firmware/solace_esp32) produce exactamente este JSON.
 * Si cambias algo aquí, cámbialo también en el firmware y en el simulador.
 */
import { z } from 'zod'

export const PROTOCOL_VERSION = 1

export const TOPICS = {
  /** ESP32 → hub: telemetría cruda (1 Hz). */
  deviceTelemetry: 'solace/device/telemetry',
  /** ESP32 → hub: "online" | "offline" (retenido, LWT). */
  deviceStatus: 'solace/device/status',
  /** ESP32 → hub: confirmación de un comando. */
  deviceAck: 'solace/device/ack',
  /** hub → ESP32: comando validado. */
  deviceCmd: 'solace/device/cmd',
  /** mainUser → hub: comando pendiente de validación. */
  uiCmd: 'solace/ui/cmd',
  /** hub → suscriptores: telemetría enriquecida (retenida). */
  liveTelemetry: 'solace/live/telemetry',
  /** hub → suscriptores: estado de conexión del dispositivo (retenido). */
  liveDevice: 'solace/live/device',
  /** hub → suscriptores: respuesta a un comando. */
  liveAck: 'solace/live/ack',
  /** hub → suscriptores: actividad (comandos enviados, conexiones). */
  liveEvent: 'solace/live/event',
  /** hub → suscriptores: estadísticas del hub (retenido). */
  liveHub: 'solace/live/hub',
} as const

/** Roles MQTT: se envían como `username` al conectar. */
export type Role = 'device' | 'main' | 'listener'
export const ROLES: readonly Role[] = ['device', 'main', 'listener']

export const DISCOVERY = {
  /** Puerto UDP del beacon que emite el hub (broadcast) para que la ESP32 lo encuentre. */
  udpPort: 47474,
  /** Servicio mDNS anunciado: _solace._tcp */
  mdnsType: 'solace',
  beaconIntervalMs: 1000,
} as const

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color debe ser #RRGGBB')
const channel = z.object({ v: z.number(), i: z.number(), p: z.number() })
const nullableNum = z.number().nullable()

export const AlertCode = z.enum([
  'BAT_LOW',
  'BAT_CRITICAL',
  'TEMP_HIGH',
  'USB_OUT_OF_SPEC',
  'SENSOR_LUX',
  'SENSOR_DHT',
  'SENSOR_POWER',
])
export type AlertCode = z.infer<typeof AlertCode>

export const LightMode = z.enum(['auto', 'manual'])
export type LightMode = z.infer<typeof LightMode>

export const LightState = z.object({
  mode: LightMode,
  on: z.boolean(),
  color: hexColor,
  brightness: z.number().min(0).max(100),
  luxOn: z.number().min(0),
  luxOff: z.number().min(0),
})
export type LightState = z.infer<typeof LightState>

export const Telemetry = z.object({
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  uptime: z.number().nonnegative(),
  env: z.object({
    /** Lectura cruda del BH1750 (incluye la luz de la propia tira). */
    lux: nullableNum,
    /** Luz ambiente estimada (muestreo con la tira apagada unos ms). Se usa para el modo auto. */
    luxAmbient: nullableNum,
    tempC: nullableNum,
    hum: nullableNum,
  }),
  power: z.object({
    /** INA3221 CH1 — salida de batería. i > 0 descarga, i < 0 carga. */
    bat: channel,
    /** INA3221 CH2 — step-down 5 V (carga de celular). */
    usb: channel,
    /** INA3221 CH3 — step-down 3 V (radio AM). */
    radio: channel,
    /** Tira LED — estimada con el modelo de consumo WS2812B. */
    led: z.object({ p: z.number(), est: z.literal(true) }),
  }),
  bat: z.object({
    soc: z.number().min(0).max(100),
    charging: z.boolean(),
  }),
  light: LightState,
  alerts: z.array(AlertCode),
  net: z.object({ rssi: z.number(), ip: z.string() }),
})
export type Telemetry = z.infer<typeof Telemetry>

/** Comandos que puede emitir /mainUser. */
export const Command = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setMode'), mode: LightMode }),
  z
    .object({
      type: z.literal('setLight'),
      on: z.boolean().optional(),
      color: hexColor.optional(),
      brightness: z.number().int().min(0).max(100).optional(),
    })
    .refine((c) => c.on !== undefined || c.color !== undefined || c.brightness !== undefined, {
      message: 'setLight necesita al menos on, color o brightness',
    }),
  z
    .object({
      type: z.literal('setAuto'),
      luxOn: z.number().min(0).max(10000),
      luxOff: z.number().min(0).max(10000),
    })
    .refine((c) => c.luxOff > c.luxOn, { message: 'luxOff debe ser mayor que luxOn (histéresis)' }),
  z.object({ type: z.literal('identify') }),
])
export type Command = z.infer<typeof Command>

/** Comando tal como viaja hacia el dispositivo (con id para el ack). */
export type DeviceCommand = Command & { id: string }

/** Envoltura que publica /mainUser en solace/ui/cmd. */
export const UiCommandEnvelope = z.object({ id: z.string().min(1).max(64), cmd: Command })
export type UiCommandEnvelope = z.infer<typeof UiCommandEnvelope>

export const Ack = z.object({
  id: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
})
export type Ack = z.infer<typeof Ack>

/** Valores derivados que calcula el hub sobre la telemetría cruda. */
export interface Derived {
  /** Energía extraída de la batería desde que arrancó el hub (Wh). */
  energyWh: number
  /** Potencia media de la batería (EMA ~60 s). */
  avgPowerW: number
  /** Autonomía estimada con la potencia media actual (min). null si no aplica. */
  autonomyMin: number | null
  /** Energía restante estimada en el banco (Wh). */
  remainingWh: number
}

export interface LiveTelemetry extends Telemetry {
  receivedAt: number
  derived: Derived
}

export interface DeviceInfo {
  online: boolean
  id: string | null
  ip: string | null
  lastSeen: number | null
}

export interface HubStats {
  listeners: number
  mains: number
  devices: number
  startedAt: number
  listenerUrl: string
  mainUrl: string
}

export type HubEvent =
  | { kind: 'command'; at: number; cmd: Command; clientId: string }
  | { kind: 'device'; at: number; online: boolean }

/** Texto en español para cada alerta (con un nivel para el ícono). */
export const ALERT_INFO: Record<AlertCode, { label: string; level: 'warn' | 'critical' | 'info' }> = {
  BAT_LOW: { label: 'Batería baja', level: 'warn' },
  BAT_CRITICAL: { label: 'Batería crítica', level: 'critical' },
  TEMP_HIGH: { label: 'Temperatura alta', level: 'critical' },
  USB_OUT_OF_SPEC: { label: 'Salida USB fuera de 4,75–5,25 V', level: 'warn' },
  SENSOR_LUX: { label: 'Sensor de luz sin respuesta', level: 'info' },
  SENSOR_DHT: { label: 'Sensor de temperatura sin respuesta', level: 'info' },
  SENSOR_POWER: { label: 'Sensor de potencia sin respuesta', level: 'info' },
}
