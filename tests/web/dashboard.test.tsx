// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { HubProvider } from '../../web/src/lib/context.tsx'
import { Dashboard } from '../../web/src/pages/Dashboard.tsx'
import { Landing } from '../../web/src/pages/Landing.tsx'
import { TOPICS, type LiveTelemetry } from '../../shared/protocol.ts'
import { FIRMWARE_CHARGING } from '../fixtures.ts'
import type { HubState } from '../../web/src/lib/store.ts'
import { fakeClient, liveSample, makeStore } from './fixtures.ts'

afterEach(cleanup)

function renderDash(role: 'main' | 'listener', patch: Partial<HubState> = {}, ack = {}) {
  const store = makeStore(patch)
  const { client, sendCommand } = fakeClient(role, ack)
  const utils = render(
    <HubProvider store={store} client={client}>
      <Dashboard role={role} theme="light" onToggleTheme={() => {}} />
    </HubProvider>,
  )
  return { ...utils, store, sendCommand }
}

describe('/listener (solo lectura)', () => {
  it('muestra los datos en vivo sin controles', () => {
    renderDash('listener')
    expect(screen.getByText('Espectador')).toBeInTheDocument()
    expect(screen.getByText('ESP32 en línea')).toBeInTheDocument()
    expect(screen.getByText('Encendida')).toBeInTheDocument()
    expect(screen.getByText('Manual')).toBeInTheDocument()
    expect(screen.getByLabelText('51%')).toBeInTheDocument() // SoC
    expect(screen.getByText('1 h 37 min')).toBeInTheDocument() // autonomía calculada por el firmware
    expect(screen.getByText('2S2P Li-ion · 31,5 Wh útiles')).toBeInTheDocument()
    expect(screen.getByText(/· 80%$/)).toBeInTheDocument() // color y brillo de la tira
    expect(screen.getByText('activa')).toBeInTheDocument() // salida USB
    expect(screen.getByText('encendida · 80 %')).toBeInTheDocument() // tira LED
    expect(screen.getByText('En operación', { selector: 'h2' })).toBeInTheDocument() // estado de carga
    expect(screen.getAllByText('4,54 W')).toHaveLength(2) // consumo medido de la tira (CH3): chip + flujo
    expect(screen.getByText('Protección térmica: normal')).toBeInTheDocument()
    expect(screen.getByText('27,4 °C')).toBeInTheDocument()
    expect(screen.getByText('752 hPa')).toBeInTheDocument() // BMP280
    expect(screen.getByText('BMP280 · BH1750')).toBeInTheDocument()
    expect(screen.queryByLabelText('Panel de control')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Compartir vista en vivo')).not.toBeInTheDocument()
  })

  it('actualiza la vista cuando llega nueva telemetría', async () => {
    const { store } = renderDash('listener')
    act(() => {
      const t = liveSample({ receivedAt: Date.now() + 1000 })
      t.light = { ...t.light, mode: 'manual', on: false, outPct: 0 }
      store.dispatch({ type: 'message', topic: TOPICS.liveTelemetry, payload: t })
    })
    // AnimatePresence espera a que termine la animación de salida de "Encendida"
    expect(await screen.findByText('Apagada', {}, { timeout: 2000 })).toBeInTheDocument()
    expect(screen.getByText('Manual')).toBeInTheDocument()
  })

  it('muestra alertas con texto (no solo color)', () => {
    renderDash('listener', { telemetry: liveSample({ alerts: ['BAT_CRITICAL', 'TEMP_CUTOFF', 'USB_LOW_BAT'] }) })
    const alerts = screen.getByRole('alert')
    expect(within(alerts).getByText('Batería crítica')).toBeInTheDocument()
    expect(within(alerts).getByText('Corte por temperatura: USB apagado')).toBeInTheDocument()
    expect(within(alerts).getByText('USB apagado por batería baja')).toBeInTheDocument()
  })

  it('la protección térmica bloquea solo el USB; la tira sigue encendida', () => {
    const t = liveSample({ alerts: ['TEMP_CUTOFF'] })
    t.protect = { ...t.protect, temp: 'CORTE', usbOn: false }
    t.env = { ...t.env, tempC: 51.2 }
    renderDash('listener', { telemetry: t })
    expect(screen.getByText('bloqueada · protección térmica')).toBeInTheDocument() // USB pedido
    expect(screen.getByText('Encendida')).toBeInTheDocument() // la luz no tiene cortes
    expect(screen.getByText('encendida · 80 %')).toBeInTheDocument()
    expect(screen.getByText(/Protección térmica: corte: USB apagado/)).toBeInTheDocument()
  })

  it('indica que el USB está apagado', () => {
    const t = liveSample()
    t.protect = { ...t.protect, usbRequested: false, usbOn: false }
    renderDash('listener', { telemetry: t })
    expect(screen.getByText('apagada')).toBeInTheDocument()
  })

  it('en manual el USB sigue activo sin protecciones (sobre 50 °C) y se avisa', () => {
    const t = liveSample({ alerts: ['TEMP_HIGH', 'TEMP_GUARD_OFF'] })
    t.protect = { ...t.protect, temp: 'CORTE', tempGuard: 'manual', usbOn: true }
    renderDash('listener', { telemetry: t })
    expect(screen.getByText('activa · manual, sin protecciones')).toBeInTheDocument()
    expect(within(screen.getByRole('alert')).getByText('USB en manual: sin protecciones')).toBeInTheDocument()
    expect(screen.getByText(/Protección térmica: manual · sobre el corte/)).toBeInTheDocument()
  })

  it('al desconectarse la ESP32 todos los datos vuelven a "sin datos"', async () => {
    const { store, container } = renderDash('listener')
    expect(screen.getByLabelText('51%')).toBeInTheDocument()
    act(() => store.dispatch({ type: 'message', topic: TOPICS.liveDevice, payload: { online: false, id: 'solace-a1b2c3', ip: null, lastSeen: 1 } }))
    expect(store.getState().telemetry).toBeNull()
    expect(screen.queryByLabelText('51%')).not.toBeInTheDocument()
    expect(screen.getByText('Esperando al dispositivo')).toBeInTheDocument()
    expect(await screen.findByText('Sin datos de la batería', {}, { timeout: 2000 })).toBeInTheDocument()
    expect(screen.queryByText('27,4 °C')).not.toBeInTheDocument()
    expect(within(screen.getByLabelText('Flujo de energía')).getAllByText('—').length).toBe(4) // batería + 3 ramas
    expect(container.querySelectorAll('.pf-branch.active')).toHaveLength(0)
  })

  it('el flujo de energía reparte la potencia en ramas alineadas y animadas', () => {
    const { container } = renderDash('listener')
    const flow = screen.getByLabelText('Flujo de energía')
    const rows = flow.querySelectorAll('.pf-branch')
    expect(rows).toHaveLength(3)
    // Cada rama dibuja su propio tramo de cable dentro de la fila (no un SVG aparte que se desfase)
    rows.forEach((r) => expect(r.querySelector('.pf-wire .pf-arm')).not.toBeNull())
    expect(container.querySelectorAll('.pf-branch.active')).toHaveLength(3)
    expect(within(flow).getByRole('img', { name: 'Reparto: USB 4,80 W, luz 4,54 W, ESP32 y pérdidas 753 mW' })).toBeInTheDocument()
  })

  it('muestra la animación de carga con su origen (panel solar)', () => {
    renderDash('listener', { telemetry: liveSample(structuredClone(FIRMWARE_CHARGING) as unknown as Partial<LiveTelemetry>) })
    const card = screen.getByLabelText('Estado de carga')
    expect(card).toHaveClass('mode-charging')
    expect(within(card).getByText('Cargando batería')).toBeInTheDocument()
    expect(within(card).getByText(/^Panel solar · entran 4,31 W/)).toBeInTheDocument()
    expect(within(card).getByRole('img', { name: /entrando a la batería desde Panel solar/ })).toBeInTheDocument()
    expect(card.querySelectorAll('path.cs-dash.tone-solar')).toHaveLength(1) // flujo animado panel → batería
    expect(screen.getByText('cargando · entra desde panel solar')).toBeInTheDocument() // flujo de energía
    expect(screen.getAllByText('Cargando').length).toBeGreaterThan(0) // tarjeta de batería
  })

  it('distingue la carga por USB y la operación', () => {
    const usb = liveSample(structuredClone(FIRMWARE_CHARGING) as unknown as Partial<LiveTelemetry>)
    usb.bat = { ...usb.bat, source: 'usb' }
    const { unmount } = renderDash('listener', { telemetry: usb })
    expect(screen.getByText(/^Cargador USB · entran/)).toBeInTheDocument()
    expect(screen.getByLabelText('Estado de carga').querySelectorAll('path.cs-dash.tone-usb')).toHaveLength(1)
    unmount()
    renderDash('listener') // de noche, en operación
    const card = screen.getByLabelText('Estado de carga')
    expect(card).toHaveClass('mode-operating')
    expect(within(card).getByText(/salen 10,10 W/)).toBeInTheDocument()
    expect(card.querySelectorAll('path.cs-dash.tone-bat')).toHaveLength(1) // flujo batería → cargas
  })

  it('muestra "en reposo" en lugar de una autonomía', () => {
    const resting = liveSample()
    resting.bat = { ...resting.bat, state: 'resting', autonomyMin: null }
    renderDash('listener', { telemetry: resting })
    expect(screen.getAllByText('En reposo').length).toBeGreaterThanOrEqual(2) // estado de carga + autonomía
  })

  it('indica cuando aún no hay dispositivo', () => {
    renderDash('listener', { telemetry: null, device: { online: false, id: null, ip: null, lastSeen: null } })
    expect(screen.getByText('Esperando al dispositivo')).toBeInTheDocument()
    expect(screen.getByText('Sin dispositivo')).toBeInTheDocument()
  })

  it('avisa si se pierde la conexión con el hub', () => {
    renderDash('listener', { conn: 'offline' })
    expect(screen.getByText(/Sin conexión con el hub/)).toBeInTheDocument()
  })

  it('muestra la actividad del panel de control', () => {
    renderDash('listener', { events: [{ kind: 'command', at: Date.now(), cmd: { type: 'setLight', color: '#FF0000' }, clientId: 'main-1' }] })
    expect(screen.getByText('Control color Rojo')).toBeInTheDocument()
  })
})

describe('/mainUser (control)', () => {
  it('cambia a modo manual', async () => {
    const { sendCommand } = renderDash('main')
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Modo de la luz' })).getByRole('radio', { name: /Manual/ }))
    expect(sendCommand).toHaveBeenCalledWith({ type: 'setMode', mode: 'manual' })
  })

  it('apaga y enciende la luz con el interruptor', async () => {
    const { sendCommand } = renderDash('main') // la tira está encendida
    await userEvent.click(screen.getByRole('switch', { name: 'Encender o apagar la luz' }))
    expect(sendCommand).toHaveBeenCalledWith({ type: 'setLight', on: false })
  })

  it('enciende y apaga la carga de celular (USB 5 V) desde la interfaz', async () => {
    const t = liveSample()
    t.protect = { ...t.protect, usbRequested: false, usbOn: false }
    const { sendCommand } = renderDash('main', { telemetry: t })
    const usb = screen.getByRole('switch', { name: 'Encender o apagar la carga de celular' })
    expect(usb).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(usb)
    expect(sendCommand).toHaveBeenCalledWith({ type: 'setUsb', on: true })
    expect(usb).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(usb)
    expect(sendCommand).toHaveBeenLastCalledWith({ type: 'setUsb', on: false })
  })

  it('el botón del USB sigue al interruptor físico: mismo estado en la app y en el dispositivo', async () => {
    const t = liveSample()
    t.protect = { ...t.protect, usbRequested: false, usbOn: false }
    const { store } = renderDash('main', { telemetry: t })
    const usb = screen.getByRole('switch', { name: 'Encender o apagar la carga de celular' })
    expect(usb).toHaveAttribute('aria-checked', 'false')
    // Alguien mueve el interruptor físico: la app lo muestra encendido
    const on = liveSample()
    on.protect = { ...on.protect, usbRequested: true, usbOn: true }
    act(() => store.dispatch({ type: 'message', topic: TOPICS.liveTelemetry, payload: on }))
    expect(usb).toHaveAttribute('aria-checked', 'true')
    // Clic en la app (apaga) y justo después el interruptor lo vuelve a encender: al terminar la
    // espera local, la app muestra el estado real aunque la telemetría no cambie más.
    await userEvent.click(usb)
    expect(usb).toHaveAttribute('aria-checked', 'false')
    act(() => store.dispatch({ type: 'message', topic: TOPICS.liveTelemetry, payload: on }))
    await new Promise((r) => setTimeout(r, 1300))
    expect(usb).toHaveAttribute('aria-checked', 'true')
  })

  it('elige las protecciones del USB (automáticas o manual)', async () => {
    const { sendCommand } = renderDash('main')
    const group = screen.getByRole('radiogroup', { name: 'Protecciones del USB' })
    expect(within(group).getByRole('radio', { name: /Automáticas/ })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(within(group).getByRole('radio', { name: /Manual/ }))
    expect(sendCommand).toHaveBeenCalledWith({ type: 'setTempGuard', mode: 'manual' })
    expect(screen.getByText(/Sin protecciones: el USB obedece solo al interruptor/)).toBeInTheDocument()
    expect(screen.getByText(/Interruptor físico: cerrado/)).toBeInTheDocument() // el de la muestra está cerrado
  })

  it('elige un color predefinido', async () => {
    const { sendCommand } = renderDash('main')
    await userEvent.click(screen.getByRole('listitem', { name: 'Rojo' }))
    expect(sendCommand).toHaveBeenCalledWith({ type: 'setLight', color: '#FF0000' })
  })

  it('ajusta el brillo', () => {
    const { sendCommand } = renderDash('main')
    fireEvent.change(screen.getByLabelText(/Brillo/), { target: { value: '30' } })
    expect(sendCommand).toHaveBeenCalledWith({ type: 'setLight', brightness: 30 })
  })

  it('guarda los umbrales del modo automático solo si son válidos', async () => {
    const { sendCommand } = renderDash('main')
    await userEvent.click(screen.getByText('Ajustes del modo automático'))
    const save = screen.getByRole('button', { name: 'Guardar umbrales' })
    expect(save).toBeDisabled() // sin cambios
    fireEvent.change(screen.getByLabelText(/Apagar sobre/), { target: { value: '5' } }) // por debajo de 10 lx
    expect(screen.getByText(/debe ser mayor/)).toBeInTheDocument()
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Apagar sobre/), { target: { value: '150' } })
    await userEvent.click(save)
    expect(sendCommand).toHaveBeenCalledWith({ type: 'setAuto', luxOn: 10, luxOff: 150 })
  })

  it('identifica el dispositivo', async () => {
    const { sendCommand } = renderDash('main')
    await userEvent.click(screen.getByRole('button', { name: /Identificar dispositivo/ }))
    expect(sendCommand).toHaveBeenCalledWith({ type: 'identify' })
  })

  it('muestra un aviso si el dispositivo rechaza el comando', async () => {
    renderDash('main', {}, { ok: false, error: 'Color inválido' })
    await userEvent.click(screen.getByRole('listitem', { name: 'Azul' }))
    expect(await screen.findByText('Color inválido')).toBeInTheDocument()
  })

  it('deshabilita los controles si el dispositivo está desconectado', () => {
    renderDash('main', { device: { online: false, id: null, ip: null, lastSeen: null } })
    expect(screen.getByText(/no está conectado/)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Encender o apagar la luz' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Encender o apagar la carga de celular' })).toBeDisabled()
  })

  it('ofrece el QR para compartir la vista de solo lectura', () => {
    renderDash('main', {
      hub: { listeners: 3, mains: 1, devices: 1, startedAt: 0, listenerUrl: 'http://192.168.1.10:8080/listener', mainUrl: 'http://192.168.1.10:8080/mainUser' },
    })
    expect(screen.getByAltText(/Código QR/)).toHaveAttribute('src', '/api/qr.svg?target=listener')
    expect(screen.getByText('192.168.1.10:8080/listener')).toBeInTheDocument()
    expect(screen.getByText('3 espectadores conectados')).toBeInTheDocument()
  })
})

describe('portada', () => {
  it('enlaza a las dos vistas', () => {
    render(<Landing />)
    expect(screen.getByText('Power when it matters.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ver en vivo/ })).toHaveAttribute('href', '/listener')
    expect(screen.getByRole('link', { name: /Panel de control/ })).toHaveAttribute('href', '/mainUser')
  })
})
