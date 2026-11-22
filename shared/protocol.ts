/**
 * SOLACE — contrato de mensajes entre ESP32, hub (Mac) y clientes web.
 *
 *   ESP32 ──MQTT/TCP──▶ Hub (Mac, broker Aedes) ──MQTT/WebSocket──▶ n suscriptores
 *
 * El firmware (firmware/solace_esp32) produce exactamente este JSON.
 * Si cambias algo aquí, cámbialo también en el firmware y en el simulador.
 */
import { z } from 'zod'

export const PROTOCOL_VERSION = 4

export const TOPICS = {
  /** ESP32 → hub: telemetría cruda (cada 3 s, y al instante tras un cambio). */
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
const nullableNum = z.number().nullable()

/** Estado de rango de un canal del INA3221 (calibración de la caracterización: ±1500 mA). */
export const InaRange = z.enum(['OK', 'FUERA_CAL', 'SATURADO'])
export type InaRange = z.infer<typeof InaRange>
/** Canal del INA3221 calibrado: V, A (+ = sale de la batería / hacia la carga), W y rango. */
const channel = z.object({ v: z.number(), i: z.number(), p: z.number(), st: InaRange })

export const LuxState = z.enum(['OK', 'BAJO_RANGO', 'SOBRE_RANGO', 'SATURADO', 'ERROR', 'SIN_DATO'])
export type LuxState = z.infer<typeof LuxState>

/** Protección térmica (BMP280 pegado al banco). */
export const TempState = z.enum(['NORMAL', 'ALARMA', 'CORTE', 'SIN_DATO'])
export type TempState = z.infer<typeof TempState>

/** Protecciones del USB: 'auto' = temperatura, INA, batería y sobrecorriente pueden apagarlo; 'manual' = ninguna. */
export const TempGuard = z.enum(['auto', 'manual'])
export type TempGuard = z.infer<typeof TempGuard>

export const BatState = z.enum(['discharging', 'resting', 'charging', 'unknown'])
export type BatState = z.infer<typeof BatState>

/**
 * Origen de la carga de la batería (CH1 negativo). 'unknown' = hay luz y no está
 * cableado el detector de la entrada USB, así que puede ser panel o USB.
 */
export const ChargeSource = z.enum(['solar', 'usb', 'unknown'])
export type ChargeSource = z.infer<typeof ChargeSource>

export const AlertCode = z.enum([
  'BAT_LOW',
  'BAT_CRITICAL',
  'TEMP_HIGH',
  'TEMP_CUTOFF',
  'SENSOR_TEMP',
  'USB_LOW_BAT',
  'USB_BLOCKED',
  'INA_RANGE',
  'USB_OUT_OF_SPEC',
  'SENSOR_LUX',
  'SENSOR_POWER',
  'TEMP_GUARD_OFF',
])
export type AlertCode = z.infer<typeof AlertCode>

export const LightMode = z.enum(['auto', 'manual'])
export type LightMode = z.infer<typeof LightMode>

export const LightState = z.object({
  mode: LightMode,
  /** Lo que pide el modo actual (auto: según la luz; manual: el usuario). */
  on: z.boolean(),
  color: hexColor,
  brightness: z.number().min(0).max(100),
  luxOn: z.number().min(0),
  luxOff: z.number().min(0),
  /** Brillo aplicado a la tira (0–100 %); 0 si está apagada. La tira no tiene cortes de protección. */
  outPct: z.number().min(0).max(100),
})
export type LightState = z.infer<typeof LightState>

export const Telemetry = z.object({
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  uptime: z.number().nonnegative(),
  env: z.object({
    /** BH1750 corregido con la caracterización (nominal bajo 54 lx). */
    lux: nullableNum,
    luxState: LuxState,
    /** BMP280 con offset de la caracterización. */
    tempC: nullableNum,
    pressHpa: nullableNum,
  }),
  power: z.object({
    /** INA3221 CH1 — batería (neto). i > 0 descarga, i < 0 carga. */
    bat: channel,
    /** INA3221 CH2 — salida USB 5 V (carga de celular). */
    usb: channel,
    /** INA3221 CH3 — tira LED RGB 5 V (medida). */
    led: channel,
  }),
  bat: z.object({
    /** Estado de carga por conteo de energía (null en los primeros 2 s). */
    soc: z.number().min(0).max(100).nullable(),
    state: BatState,
    remainingWh: nullableNum,
    /** Potencia media de la batería (suavizada, τ = 30 s). */
    avgPowerW: nullableNum,
    /** Minutos restantes; null en reposo, cargando o sin dato. */
    autonomyMin: nullableNum,
    capacityWh: z.number().positive(),
    /** Origen de la carga mientras state = 'charging'; null si no carga. */
    source: ChargeSource.nullable(),
    /** Potencia que entra a la batería (W) mientras carga; null si no carga. */
    chargeW: nullableNum,
  }),
  light: LightState,
  /** Salida USB de 5 V (interruptor físico o app + protecciones). La tira no tiene cortes. */
  protect: z.object({
    temp: TempState,
    /** Protecciones del USB (se eligen en la app; arranca en 'auto'). En 'manual' no se evalúa ninguna. */
    tempGuard: TempGuard,
    /** Lo que pidieron el interruptor USB o la app (la última acción manda). */
    usbRequested: z.boolean(),
    /** Estado real de la salida (MOSFET). */
    usbOn: z.boolean(),
    usbLowBat: z.boolean(),
    usbBlocked: z.boolean(),
  }),
  /** Posición de los interruptores físicos (true = cerrado). */
  switches: z.object({ usb: z.boolean(), light: z.boolean() }),
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
  /** Pide encender o apagar la salida USB de 5 V (mismo efecto que el interruptor). */
  z.object({ type: z.literal('setUsb'), on: z.boolean() }),
  /** Protecciones del USB: automáticas o manual (sin protecciones). */
  z.object({ type: z.literal('setTempGuard'), mode: TempGuard }),
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
  TEMP_HIGH: { label: 'Temperatura alta (≥ 45 °C)', level: 'warn' },
  TEMP_CUTOFF: { label: 'Corte por temperatura: USB apagado', level: 'critical' },
  SENSOR_TEMP: { label: 'Sin sensor de temperatura (BMP280)', level: 'critical' },
  USB_LOW_BAT: { label: 'USB apagado por batería baja', level: 'warn' },
  USB_BLOCKED: { label: 'USB bloqueado 30 s por sobrecorriente', level: 'warn' },
  INA_RANGE: { label: 'Corriente fuera del rango calibrado', level: 'warn' },
  USB_OUT_OF_SPEC: { label: 'Salida USB fuera de 4,75–5,25 V', level: 'warn' },
  SENSOR_LUX: { label: 'Sensor de luz sin respuesta', level: 'info' },
  SENSOR_POWER: { label: 'Sin sensor de potencia (INA3221)', level: 'critical' },
  TEMP_GUARD_OFF: { label: 'USB en manual: sin protecciones', level: 'warn' },
}
