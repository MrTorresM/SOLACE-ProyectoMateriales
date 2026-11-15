import { vi } from 'vitest'
import type { Ack, LiveTelemetry } from '../../shared/protocol.ts'
import type { HubClient } from '../../web/src/lib/hubClient.ts'
import { createStore, initialState, type HubState } from '../../web/src/lib/store.ts'
import { FIRMWARE_SAMPLE } from '../fixtures.ts'

export function liveSample(patch: Partial<LiveTelemetry> = {}): LiveTelemetry {
  return {
    ...(structuredClone(FIRMWARE_SAMPLE) as unknown as LiveTelemetry),
    receivedAt: Date.now(),
    derived: { energyWh: 0.42, avgPowerW: 6.4, autonomyMin: 178, remainingWh: 18.98 },
    ...patch,
  }
}

export function makeStore(patch: Partial<HubState> = {}) {
  return createStore({
    ...initialState,
    conn: 'online',
    device: { online: true, id: 'solace-a1b2c3', ip: '192.168.1.57', lastSeen: Date.now() },
    telemetry: liveSample(),
    ...patch,
  })
}

export function fakeClient(role: 'main' | 'listener', ack: Partial<Ack> = { ok: true }) {
  const sendCommand = vi.fn(async () => ({ id: 'x', ok: true, ...ack }) as Ack)
  const client: HubClient = { role, sendCommand, close: vi.fn() }
  return { client, sendCommand }
}
