/**
 * El simulador de la ESP32 contra el hub real: envío de telemetría y recepción de comandos.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MqttClient } from 'mqtt'
import type { Hub } from '../../server/hub.ts'
import { DeviceSimulator } from '../../scripts/deviceSimulator.ts'
import { TOPICS, Telemetry, type Ack, type LiveTelemetry } from '../../shared/protocol.ts'
import { nextMessage, startHub, wsClient } from './helpers.ts'

describe('DeviceSimulator (sin red)', () => {
  it('es determinista con la misma semilla', () => {
    const a = new DeviceSimulator({ host: '', port: 0, durationS: 20, rateHz: 1, seed: 99 })
    const b = new DeviceSimulator({ host: '', port: 0, durationS: 20, rateHz: 1, seed: 99 })
    expect(a.buildTelemetry(1000)).toEqual(b.buildTelemetry(1000))
  })

  /** Pasa la luz y las protecciones del USB a automático (como desde la app). */
  const toAuto = (sim: DeviceSimulator) => {
    sim.applyCommand({ id: 'auto-luz', type: 'setMode', mode: 'auto' })
    sim.applyCommand({ id: 'auto-usb', type: 'setTempGuard', mode: 'auto' })
  }
  /** Un ciclo completo (60 s) muestreado cada segundo, con todo en automático. */
  const cycle = (seed: number) => {
    const sim = new DeviceSimulator({ host: '', port: 0, durationS: 60, rateHz: 1, seed })
    toAuto(sim)
    return Array.from({ length: 60 }, (_, k) => Telemetry.parse(sim.buildTelemetry(k * 1000)))
  }

  it('arranca en manual, como el firmware: la luz y el USB siguen a los interruptores', () => {
    const sim = new DeviceSimulator({ host: '', port: 0, durationS: 60, rateHz: 1, seed: 4 })
    const f = Array.from({ length: 30 }, (_, k) => sim.buildTelemetry(k * 1000))
    expect(f[0]!.light).toMatchObject({ mode: 'manual', on: false })
    expect(f[0]!.protect.tempGuard).toBe('manual')
    expect(f.every((t) => !t.light.on)).toBe(true) // de noche no se enciende sola
    expect(f.some((t) => t.env.lux! < 10)).toBe(true)
  })

  it('genera valores físicamente plausibles', () => {
    for (let seed = 1; seed <= 15; seed++) {
      for (const t of cycle(seed)) {
        expect(t.power.bat.v).toBeGreaterThan(6.5)
        expect(t.power.bat.v).toBeLessThan(8.5)
        expect(t.power.led.v).toBeCloseTo(5, 0)
        expect(Math.abs(t.power.bat.i)).toBeLessThanOrEqual(1.638) // el INA3221 satura ahí
        expect(t.env.tempC!).toBeGreaterThan(15)
        expect(t.env.tempC!).toBeLessThan(40)
        expect(t.bat.soc!).toBeGreaterThanOrEqual(0)
        // La fuente y la potencia de carga solo aparecen mientras carga
        if (t.bat.state === 'charging') {
          expect(t.power.bat.i).toBeLessThan(-0.02)
          expect(t.bat.source).not.toBeNull()
          expect(t.bat.chargeW!).toBeGreaterThan(0)
        } else {
          expect(t.bat.source).toBeNull()
          expect(t.bat.chargeW).toBeNull()
        }
      }
    }
  })

  it('recorre carga solar → operación → carga por USB', () => {
    for (const seed of [3, 7, 11]) {
      const f = cycle(seed)
      // De día (0–15 s) el panel carga la batería
      for (const t of f.slice(1, 13)) expect(t.bat).toMatchObject({ state: 'charging', source: 'solar' })
      // De noche, sin cargador, la batería alimenta el sistema
      for (const t of f.slice(20, 39)) expect(t.bat.state).toBe('discharging')
      // Con el cargador USB (40–55 s) vuelve a cargar, aunque la luz siga encendida
      for (const t of f.slice(42, 54)) {
        expect(t.bat).toMatchObject({ state: 'charging', source: 'usb' })
        expect(t.light.outPct).toBe(100)
      }
      expect(f[58]!.bat.state).toBe('discharging')
    }
  })

  it('en automático enciende la tira en blanco ~1 s después de oscurecer, sin cortes', () => {
    const f = cycle(4)
    expect(f[0]!.light.on).toBe(false)
    const firstDark = f.findIndex((t) => t.env.lux! < 10)
    const firstOn = f.findIndex((t) => t.light.on)
    expect(firstDark).toBeGreaterThan(0)
    expect(firstOn - firstDark).toBeGreaterThanOrEqual(0)
    expect(firstOn - firstDark).toBeLessThanOrEqual(1) // reacción ≈ 1 s
    expect(f[50]!.light).toMatchObject({ mode: 'auto', on: true, color: '#FFFFFF', brightness: 100, outPct: 100 })
    expect(f[50]!.power.led.i).toBeGreaterThan(1) // consumo medido en CH3
  })

  it('el interruptor USB y la app comparten un único estado: cada movimiento del interruptor alterna', () => {
    const sim = new DeviceSimulator({ host: '', port: 0, durationS: 60, rateHz: 1, seed: 4 })
    let t = sim.buildTelemetry(0)
    expect(t.protect).toMatchObject({ usbRequested: false, usbOn: false }) // arranca apagada
    expect(t.switches).toEqual({ usb: false, light: false })
    sim.setSwitch('usb', true)
    t = sim.buildTelemetry(1000)
    expect(t.protect).toMatchObject({ usbRequested: true, usbOn: true })
    expect(t.switches.usb).toBe(true)
    expect(t.power.usb.i).toBeGreaterThan(0.4)
    // La app apaga aunque el interruptor siga cerrado…
    sim.applyCommand({ id: 'a', type: 'setUsb', on: false })
    t = sim.buildTelemetry(2000)
    expect(t.protect).toMatchObject({ usbRequested: false, usbOn: false })
    expect(t.power.usb.p).toBe(0)
    // …y el siguiente movimiento del interruptor (abrirlo) lo vuelve a encender: alterna
    sim.setSwitch('usb', false)
    expect(sim.buildTelemetry(3000).protect.usbRequested).toBe(true)
    // Encendido desde la app con el interruptor abierto: un movimiento lo apaga
    sim.applyCommand({ id: 'b', type: 'setUsb', on: false })
    sim.applyCommand({ id: 'c', type: 'setUsb', on: true })
    expect(sim.buildTelemetry(4000).protect.usbOn).toBe(true)
    sim.setSwitch('usb', true)
    expect(sim.buildTelemetry(5000).protect.usbRequested).toBe(false)
    sim.setSwitch('usb', false)
    sim.setSwitch('usb', true)
    sim.setSwitch('usb', false) // tres movimientos: queda encendido…
    expect(sim.buildTelemetry(5500).protect.usbRequested).toBe(true)
    sim.applyCommand({ id: 'd', type: 'setUsb', on: false }) // …y la app lo apaga
    // Movido a mano, el interruptor ya no se mueve solo a los 20 s
    const f = Array.from({ length: 25 }, (_, k) => sim.buildTelemetry(6000 + k * 1000))
    expect(f.every((x) => !x.protect.usbRequested)).toBe(true)
  })

  it('el interruptor de la luz: cerrado = blanco 100 %, abierto = apagada', () => {
    const sim = new DeviceSimulator({ host: '', port: 0, durationS: 60, rateHz: 1, seed: 4 })
    sim.buildTelemetry(0)
    sim.toggleSwitch('light')
    let t = sim.buildTelemetry(1000)
    expect(t.light).toMatchObject({ mode: 'manual', on: true, color: '#FFFFFF', brightness: 100, outPct: 100 })
    expect(t.switches.light).toBe(true)
    sim.applyCommand({ id: 'a', type: 'setLight', color: '#FF0000' }) // la app la cambia después
    expect(sim.buildTelemetry(2000).light.color).toBe('#FF0000')
    sim.toggleSwitch('light')
    t = sim.buildTelemetry(3000)
    expect(t.light).toMatchObject({ mode: 'manual', on: false, outPct: 0 })
  })

  it('protecciones: automáticas cortan el USB a 50 °C; en manual no se evalúa ninguna', () => {
    const sim = new DeviceSimulator({ host: '', port: 0, durationS: 120, rateHz: 1, seed: 4 })
    sim.buildTelemetry(0)
    sim.applyCommand({ id: 'g', type: 'setTempGuard', mode: 'auto' })
    sim.setSwitch('usb', false) // tocado a mano: el escenario deja de mover el interruptor
    sim.applyCommand({ id: 'a', type: 'setUsb', on: true })
    sim.toggleHeat()
    const f = Array.from({ length: 60 }, (_, k) => sim.buildTelemetry(1000 + k * 1000))
    const cut = f.find((t) => t.protect.temp === 'CORTE')!
    expect(cut).toBeDefined()
    expect(cut.protect).toMatchObject({ tempGuard: 'auto', usbRequested: true, usbOn: false })
    expect(cut.alerts).toContain('TEMP_CUTOFF')
    sim.applyCommand({ id: 'b', type: 'setTempGuard', mode: 'manual' })
    const t = sim.buildTelemetry(62_000)
    expect(t.protect).toMatchObject({ temp: 'CORTE', tempGuard: 'manual', usbOn: true })
    expect(t.alerts).toEqual(expect.arrayContaining(['TEMP_HIGH', 'TEMP_GUARD_OFF']))
    expect(t.alerts).not.toContain('TEMP_CUTOFF')
  })

  it('en manual la sobrecorriente no bloquea el USB', () => {
    const sim = new DeviceSimulator({ host: '', port: 0, durationS: 60, rateHz: 1, seed: 7 })
    sim.applyCommand({ id: 'l', type: 'setMode', mode: 'auto' }) // luz al 100 % de noche → satura el INA
    sim.applyCommand({ id: 'a', type: 'setTempGuard', mode: 'manual' })
    const f = Array.from({ length: 60 }, (_, k) => sim.buildTelemetry(k * 1000))
    expect(f.some((t) => t.power.bat.st === 'SATURADO' && t.protect.usbOn)).toBe(true) // satura y sigue encendido
    expect(f.every((t) => !t.protect.usbBlocked && !t.alerts.includes('USB_BLOCKED'))).toBe(true)
  })

  it('USB + tira blanca al 100 % saturan el INA y bloquean el USB 30 s (como el firmware)', () => {
    const f = cycle(7)
    const blocked = f.findIndex((t) => t.protect.usbBlocked)
    expect(blocked).toBeGreaterThan(20)
    expect(f[blocked]!.protect).toMatchObject({ usbRequested: true, usbOn: false })
    expect(f[blocked]!.alerts).toContain('USB_BLOCKED')
    expect(f.slice(blocked - 4, blocked).some((t) => t.power.bat.st === 'SATURADO')).toBe(true)
  })

  it('aplica los comandos como el firmware', () => {
    const sim = new DeviceSimulator({ host: '', port: 0, durationS: 20, rateHz: 1, seed: 4 })
    expect(sim.applyCommand({ id: 'a', type: 'setLight', color: '#00ff00' })).toEqual({ id: 'a', ok: true })
    let t = sim.buildTelemetry(1000)
    expect(t.light).toMatchObject({ mode: 'manual', on: true, color: '#00FF00', outPct: 80 })
    sim.applyCommand({ id: 'b', type: 'setLight', on: false })
    expect(sim.buildTelemetry(2000).light).toMatchObject({ on: false, outPct: 0 })
    sim.applyCommand({ id: 'c', type: 'setAuto', luxOn: 5, luxOff: 20 })
    sim.applyCommand({ id: 'd', type: 'setMode', mode: 'auto' })
    t = sim.buildTelemetry(3000)
    expect(t.light).toMatchObject({ mode: 'auto', luxOn: 5, luxOff: 20 })
    expect(sim.applyCommand({ id: 'e', type: 'reboot' })).toMatchObject({ id: 'e', ok: false })
  })
})

describe('DeviceSimulator ↔ hub', () => {
  let hub: Hub
  let main: MqttClient
  beforeEach(async () => {
    hub = await startHub({ commandTimeoutMs: 2000 })
    main = await wsClient(hub, 'main')
    await main.subscribeAsync('solace/live/#')
  })
  afterEach(async () => {
    await main.endAsync(true)
    await hub.close()
  })

  it('publica telemetría válida y recibe comandos de /mainUser', async () => {
    const sim = new DeviceSimulator({ host: '127.0.0.1', port: hub.mqttPort, durationS: 2.5, rateHz: 8, seed: 21 })
    const telemetry: LiveTelemetry[] = []
    main.on('message', (t, b) => {
      if (t === TOPICS.liveTelemetry && b.length > 0) telemetry.push(JSON.parse(b.toString())) // vacío = retenido borrado
    })
    const run = sim.run()

    await nextMessage(main, TOPICS.liveDevice, (d: { online: boolean }) => d.online)
    const ack = nextMessage<Ack>(main, TOPICS.liveAck, (a) => a.id === 'cmd-1')
    main.publish(TOPICS.uiCmd, JSON.stringify({ id: 'cmd-1', cmd: { type: 'setLight', color: '#B400FF', brightness: 30 } }))
    expect(await ack).toEqual({ id: 'cmd-1', ok: true })

    const reflected = await nextMessage<LiveTelemetry>(main, TOPICS.liveTelemetry, (t) => t.light.color === '#B400FF')
    expect(reflected.light).toMatchObject({ mode: 'manual', on: true, brightness: 30 })

    const res = await run
    expect(res.sent).toBeGreaterThanOrEqual(15)
    expect(res.commands).toEqual([{ type: 'setLight', color: '#B400FF', brightness: 30 }])
    expect(telemetry.length).toBeGreaterThanOrEqual(15)
    for (const t of telemetry) expect(Telemetry.safeParse(t).success).toBe(true)
    // El hub registra todo en el historial
    expect(hub.store.history().length).toBe(telemetry.length)
    // Al terminar, el dispositivo queda desconectado
    await nextMessage(main, TOPICS.liveDevice, (d: { online: boolean }) => !d.online)
    expect(hub.store.latest).toBeNull() // la telemetría vieja se descarta
  })
})
