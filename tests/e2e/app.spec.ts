/**
 * E2E en un navegador real: ESP32 simulada → hub → /mainUser y /listener.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { expect, test } from '@playwright/test'

let sim: ChildProcess | null = null

function startSimulator(durationS = 40) {
  sim = spawn('npx', ['tsx', 'scripts/simulate-esp32.ts', '--host', '127.0.0.1', '--port', '18899', '--duration', String(durationS), '--rate', '2', '--seed', '77'], {
    stdio: 'ignore',
  })
}

test.afterEach(() => {
  sim?.kill('SIGTERM')
  sim = null
})

test('la portada lleva a las dos vistas', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Power when it matters.')).toBeVisible()
  await page.getByRole('link', { name: /Ver en vivo/ }).click()
  await expect(page).toHaveURL(/\/listener$/)
  await expect(page.getByText('Espectador')).toBeVisible()
})

test('listener ve datos en vivo de la ESP32 simulada', async ({ page }) => {
  await page.goto('/listener')
  // El hub conserva la última telemetría (retenida) de pruebas anteriores, así que el
  // mensaje "Esperando al dispositivo" solo dura un instante: se comprueba el estado.
  await expect(page.getByRole('status').getByText('Sin dispositivo')).toBeVisible()
  startSimulator()
  await expect(page.getByText('ESP32 en línea')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: /Encendida|Apagada/ })).toBeVisible()
  await expect(page.getByLabel('Batería', { exact: true })).toContainText('%')
  // El simulador arranca de día: el panel solar está cargando la batería
  await expect(page.getByLabel('Estado de carga')).toContainText('Cargando batería')
  await expect(page.getByLabel('Estado de carga')).toContainText('Panel solar')
  await expect(page.getByLabel('Panel de control')).toHaveCount(0)
})

test('mainUser cambia el color y el listener lo ve', async ({ browser, isMobile }) => {
  const mainCtx = await browser.newContext(isMobile ? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } : {})
  const listenerCtx = await browser.newContext()
  const main = await mainCtx.newPage()
  const listener = await listenerCtx.newPage()
  await main.goto('/mainUser')
  await listener.goto('/listener')
  startSimulator()
  await expect(main.getByText('ESP32 en línea')).toBeVisible({ timeout: 15_000 })

  if (isMobile) await main.getByRole('button', { name: 'Expandir panel' }).click()
  await main.getByRole('listitem', { name: 'Violeta' }).click()

  // El listener ve el cambio en la lámpara y en la actividad
  await expect(listener.getByText('Manual', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(listener.getByRole('img', { name: /Luz encendida, color Violeta/ })).toBeVisible()
  await expect(listener.getByText('Control color Violeta')).toBeVisible()

  // Volver a automático
  await main.getByRole('radio', { name: /Automático/ }).click()
  await expect(listener.getByText('Automático', { exact: true })).toBeVisible({ timeout: 10_000 })

  // Carga de celular desde la interfaz: el listener la ve activa
  const usb = main.getByRole('switch', { name: 'Encender o apagar la carga de celular' })
  if ((await usb.getAttribute('aria-checked')) === 'true') await usb.click()
  await usb.click()
  await expect(usb).toHaveAttribute('aria-checked', 'true')
  await expect(listener.getByLabel('Flujo de energía').getByText(/^activa/)).toBeVisible({ timeout: 10_000 })
  await expect(listener.getByText('Control encendió la carga de celular (USB)')).toBeVisible()

  await mainCtx.close()
  await listenerCtx.close()
})

test('el panel se deshabilita cuando la ESP32 se desconecta', async ({ page }) => {
  startSimulator(4)
  await page.goto('/mainUser')
  await expect(page.getByText('ESP32 en línea')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Sin dispositivo')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/no está conectado/)).toBeVisible()
  // Sin dispositivo, los datos vuelven a "sin datos"
  await expect(page.getByLabel('Estado de carga')).toContainText('Sin datos de la batería')
  await expect(page.getByLabel('Batería', { exact: true })).toContainText('sin datos')
})
