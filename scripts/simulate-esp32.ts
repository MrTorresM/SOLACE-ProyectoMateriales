/**
 * npm run simulate [-- --duration 20 --rate 1 --seed 42 --host 127.0.0.1 --port 1883]
 *
 * Se hace pasar por la ESP32 durante 20 s (por defecto) publicando valores pseudoaleatorios.
 * Igual que el firmware, encuentra el hub escuchando el beacon UDP; si no lo oye usa localhost.
 */
import { parseArgs } from 'node:util'
import { discoverHub } from '../server/discovery.ts'
import { DeviceSimulator } from './deviceSimulator.ts'

const { values } = parseArgs({
  options: {
    duration: { type: 'string', default: '20' },
    rate: { type: 'string', default: '1' },
    seed: { type: 'string' },
    host: { type: 'string' },
    port: { type: 'string' },
  },
})

const teal = (s: string) => `\x1b[38;2;76;155;139m${s}\x1b[0m`
const amber = (s: string) => `\x1b[38;2;226;166;75m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

let host = values.host
let port = values.port ? Number(values.port) : undefined
if (!host) {
  process.stdout.write(dim('Buscando el hub (beacon UDP :47474)… '))
  const found = await discoverHub({ timeoutMs: 2500 })
  if (found) {
    host = found.host
    port ??= found.mqttPort
    console.log(teal(`encontrado en ${host}:${port}`))
  } else {
    host = '127.0.0.1'
    console.log(amber('sin respuesta, uso 127.0.0.1'))
  }
}

const seed = values.seed ? Number(values.seed) : Date.now() % 1_000_000
const sim = new DeviceSimulator({
  host,
  port: port ?? 1883,
  durationS: Number(values.duration),
  rateHz: Number(values.rate),
  seed,
  log: (line, kind) => {
    if (kind === 'rx') console.log(amber(`  ⇠ comando  ${line}`))
    else if (kind === 'tx') console.log(dim('  ⇢ ') + line)
    else console.log(teal(`  ${line}`))
  },
})

console.log(dim(`Semilla ${seed} · ${values.duration} s · ${values.rate} Hz`))
try {
  const res = await sim.run()
  console.log(teal(`\n✔ Simulación terminada: ${res.sent} mensajes enviados, ${res.commands.length} comandos recibidos.`))
} catch (err) {
  console.error(amber(`✖ No se pudo conectar al hub en ${host}:${port ?? 1883}. ¿Está corriendo "npm run dev"?`))
  console.error(dim(String((err as Error).message)))
  process.exit(1)
}
