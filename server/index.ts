/**
 * Punto de entrada: `npm run dev` (Vite + HMR) o `npm start` (build de producción).
 * Imprime el QR de la vista /listener y deja una línea de estado en vivo en la terminal.
 */
import qrcodeTerminal from 'qrcode-terminal'
import { createHub } from './hub.ts'
import { getLanAddress } from './network.ts'
import type { LiveTelemetry } from '../shared/protocol.ts'

const dev = process.argv.includes('--dev')
const httpPort = Number(process.env.PORT ?? 8080)
const mqttPort = Number(process.env.MQTT_PORT ?? 1883)
const lan = getLanAddress()

const c = {
  teal: (s: string) => `\x1b[38;2;76;155;139m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[38;2;226;166;75m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
}

let statusLine = ''
const tty = process.stdout.isTTY
function log(msg: string) {
  if (tty && statusLine) process.stdout.write('\r\x1b[2K')
  console.log(`${c.dim(new Date().toLocaleTimeString())}  ${msg}`)
  if (tty && statusLine) process.stdout.write(statusLine)
}

if (!lan) {
  console.warn(c.amber('⚠  No se encontró una red WiFi/LAN. El servidor solo estará disponible en localhost.'))
}

const hub = await createHub({
  httpPort,
  mqttPort,
  publicIp: lan?.ip ?? 'localhost',
  web: dev ? 'vite' : 'static',
  beaconTargets: lan ? [lan.broadcast, '255.255.255.255'] : ['127.0.0.1'],
  mdns: true,
  logDir: 'data',
  log,
}).catch((err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(c.amber(`✖  Puerto en uso (${err.message}). ¿Hay otra instancia corriendo? Usa PORT=… o MQTT_PORT=…`))
    process.exit(1)
  }
  throw err
})

const qr = await new Promise<string>((resolve) => qrcodeTerminal.generate(hub.listenerUrl, { small: true }, resolve))

console.log(`
${c.teal('    ▄▄████▄▄')}
${c.teal('   ███▀  ▀███')}     ${c.bold('SOLACE Hub')}
${c.teal('   ██')}  ${c.amber('●●')}  ${c.teal('██')}     ${c.dim('Power when it matters.')}
${c.teal('   ██      ██')}     ${c.dim(dev ? 'modo desarrollo (Vite + HMR)' : 'modo producción')}
`)
console.log(qr.replace(/^/gm, '  '))
console.log(`  ${c.bold('Escanea para ver en vivo')}  ${c.teal(hub.listenerUrl)}`)
console.log(`  ${c.bold('Control (mainUser)')}       ${c.amber(hub.mainUrl)}`)
console.log(`  ${c.dim(`Broker MQTT para la ESP32  ${lan?.ip ?? 'localhost'}:${hub.mqttPort}  (descubrimiento por beacon UDP :47474 y mDNS _solace._tcp)`)}`)
console.log(`  ${c.dim(`Registro CSV               ${hub.store.csvPath}`)}`)
console.log(`  ${c.dim('Simular la ESP32           npm run simulate')}\n`)

function renderStatus(t: LiveTelemetry | null) {
  if (!tty) return
  const s = hub.stats()
  const d = hub.device()
  const dot = d.online ? c.teal('●') : c.amber('○')
  const parts = [`${dot} ${d.online ? `ESP32 ${d.id ?? ''}` : 'Esperando ESP32…'}`]
  if (t && d.online) {
    parts.push(
      `SoC ${t.bat.soc.toFixed(0)}%`,
      `${t.power.bat.p.toFixed(2)} W`,
      `${(t.env.luxAmbient ?? t.env.lux ?? 0).toFixed(0)} lx`,
      t.env.tempC === null ? '— °C' : `${t.env.tempC.toFixed(1)} °C`,
      `luz ${t.light.mode === 'auto' ? 'auto' : 'manual'} ${t.light.on ? 'on' : 'off'}`,
    )
  }
  parts.push(c.dim(`oyentes ${s.listeners} · control ${s.mains}`))
  statusLine = '  ' + parts.join(c.dim('  │  '))
  process.stdout.write('\r\x1b[2K' + statusLine)
}
hub.onTelemetry((t) => renderStatus(t))
hub.onChange(() => renderStatus(hub.store.latest))
renderStatus(null)

const shutdown = async () => {
  if (tty) process.stdout.write('\n')
  log('Cerrando hub…')
  await hub.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
