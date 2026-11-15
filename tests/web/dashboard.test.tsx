// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { HubProvider } from '../../web/src/lib/context.tsx'
import { Dashboard } from '../../web/src/pages/Dashboard.tsx'
import { Landing } from '../../web/src/pages/Landing.tsx'
import { TOPICS } from '../../shared/protocol.ts'
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
    expect(screen.getByText('Automático')).toBeInTheDocument()
    expect(screen.getByLabelText('51%')).toBeInTheDocument() // SoC
    expect(screen.getByText('2 h 58 min')).toBeInTheDocument() // autonomía
    expect(screen.getByText('27,4 °C')).toBeInTheDocument()
    expect(screen.queryByLabelText('Panel de control')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Compartir vista en vivo')).not.toBeInTheDocument()
  })

  it('actualiza la vista cuando llega nueva telemetría', async () => {
    const { store } = renderDash('listener')
    act(() => {
      const t = liveSample({ receivedAt: Date.now() + 1000 })
      t.light = { ...t.light, mode: 'manual', on: false }
      store.dispatch({ type: 'message', topic: TOPICS.liveTelemetry, payload: t })
    })
    // AnimatePresence espera a que termine la animación de salida de "Encendida"
    expect(await screen.findByText('Apagada', {}, { timeout: 2000 })).toBeInTheDocument()
    expect(screen.getByText('Manual')).toBeInTheDocument()
  })

  it('muestra alertas con texto (no solo color)', () => {
    renderDash('listener', { telemetry: liveSample({ alerts: ['BAT_CRITICAL', 'TEMP_HIGH'] }) })
    const alerts = screen.getByRole('alert')
    expect(within(alerts).getByText('Batería crítica')).toBeInTheDocument()
    expect(within(alerts).getByText('Temperatura alta')).toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('radio', { name: /Manual/ }))
    expect(sendCommand).toHaveBeenCalledWith({ type: 'setMode', mode: 'manual' })
  })

  it('enciende la luz con el interruptor', async () => {
    const { sendCommand } = renderDash('main')
    await userEvent.click(screen.getByRole('switch', { name: /Encender o apagar/ }))
    expect(sendCommand).toHaveBeenCalledWith({ type: 'setLight', on: true })
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
    fireEvent.change(screen.getByLabelText(/Encender bajo/), { target: { value: '60' } })
    expect(screen.getByText(/debe ser mayor/)).toBeInTheDocument()
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Apagar sobre/), { target: { value: '90' } })
    await userEvent.click(save)
    expect(sendCommand).toHaveBeenCalledWith({ type: 'setAuto', luxOn: 60, luxOff: 90 })
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
    expect(screen.getByRole('switch', { name: /Encender o apagar/ })).toBeDisabled()
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
