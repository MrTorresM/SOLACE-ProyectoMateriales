/**
 * Estado de la app (sin dependencias de React para poder probarlo en aislamiento).
 * Los mensajes MQTT de solace/live/# entran por `reduce`.
 */
import { TOPICS, type Ack, type DeviceInfo, type HubEvent, type HubStats, type LiveTelemetry } from '../../../shared/protocol.ts'
import type { HistoryPoint } from '../../../server/telemetryStore.ts'

export type { HistoryPoint }
export type ConnState = 'connecting' | 'online' | 'offline'

export interface Toast {
  id: string
  kind: 'ok' | 'error' | 'info'
  text: string
}

export interface HubState {
  conn: ConnState
  telemetry: LiveTelemetry | null
  device: DeviceInfo
  hub: HubStats | null
  history: HistoryPoint[]
  events: HubEvent[]
  toasts: Toast[]
}

export type Action =
  | { type: 'conn'; conn: ConnState }
  | { type: 'message'; topic: string; payload: unknown }
  | { type: 'history'; points: HistoryPoint[] }
  | { type: 'toast'; toast: Toast }
  | { type: 'dismiss'; id: string }

export const HISTORY_LIMIT = 1800
export const EVENTS_LIMIT = 30

export const initialState: HubState = {
  conn: 'connecting',
  telemetry: null,
  device: { online: false, id: null, ip: null, lastSeen: null },
  hub: null,
  history: [],
  events: [],
  toasts: [],
}

export function telemetryToPoint(t: LiveTelemetry): HistoryPoint {
  return {
    t: t.receivedAt,
    soc: t.bat.soc,
    batV: t.power.bat.v,
    batI: t.power.bat.i,
    batP: t.power.bat.p,
    usbP: t.power.usb.p,
    radioP: t.power.radio.p,
    ledP: t.power.led.p,
    lux: t.env.luxAmbient ?? t.env.lux,
    tempC: t.env.tempC,
    hum: t.env.hum,
  }
}

function mergeHistory(a: HistoryPoint[], b: HistoryPoint[]): HistoryPoint[] {
  const byT = new Map<number, HistoryPoint>()
  for (const p of a) byT.set(p.t, p)
  for (const p of b) byT.set(p.t, p)
  const merged = [...byT.values()].sort((x, y) => x.t - y.t)
  return merged.length > HISTORY_LIMIT ? merged.slice(merged.length - HISTORY_LIMIT) : merged
}

export function reduce(state: HubState, action: Action): HubState {
  switch (action.type) {
    case 'conn':
      return state.conn === action.conn ? state : { ...state, conn: action.conn }
    case 'history':
      return { ...state, history: mergeHistory(state.history, action.points) }
    case 'toast':
      return { ...state, toasts: [...state.toasts.slice(-3), action.toast] }
    case 'dismiss':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) }
    case 'message':
      return reduceMessage(state, action.topic, action.payload)
  }
}

function reduceMessage(state: HubState, topic: string, payload: unknown): HubState {
  if (payload === null || typeof payload !== 'object') return state
  switch (topic) {
    case TOPICS.liveTelemetry: {
      const t = payload as LiveTelemetry
      if (state.telemetry && t.receivedAt < state.telemetry.receivedAt) return state
      const last = state.history[state.history.length - 1]
      const history =
        last && last.t >= t.receivedAt ? state.history : [...state.history, telemetryToPoint(t)].slice(-HISTORY_LIMIT)
      return { ...state, telemetry: t, history }
    }
    case TOPICS.liveDevice:
      return { ...state, device: payload as DeviceInfo }
    case TOPICS.liveHub:
      return { ...state, hub: payload as HubStats }
    case TOPICS.liveEvent:
      return { ...state, events: [payload as HubEvent, ...state.events].slice(0, EVENTS_LIMIT) }
    case TOPICS.liveAck:
      return state // los acks los maneja el cliente (promesas de sendCommand)
    default:
      return state
  }
}

export type Ackable = Ack

export interface Store {
  getState(): HubState
  dispatch(a: Action): void
  subscribe(fn: () => void): () => void
}

export function createStore(initial: HubState = initialState): Store {
  let state = initial
  const subs = new Set<() => void>()
  return {
    getState: () => state,
    dispatch(a) {
      const next = reduce(state, a)
      if (next !== state) {
        state = next
        subs.forEach((f) => f())
      }
    },
    subscribe(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    },
  }
}
