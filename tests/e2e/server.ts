// Hub para las pruebas E2E: puertos fijos, Vite en modo desarrollo, sin beacon ni CSV.
import { createHub } from '../../server/hub.ts'

const hub = await createHub({
  httpPort: 8199,
  mqttPort: 18899,
  publicIp: '127.0.0.1',
  bindHost: '127.0.0.1',
  web: 'vite',
  logDir: null,
  commandTimeoutMs: 3000,
})
console.log(`hub e2e listo en ${hub.listenerUrl}`)
const stop = () => hub.close().then(() => process.exit(0))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
