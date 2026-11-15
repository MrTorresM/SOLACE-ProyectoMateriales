import os from 'node:os'

export interface LanAddress {
  iface: string
  ip: string
  netmask: string
  broadcast: string
}

/** Calcula la dirección de broadcast dirigida (p. ej. 192.168.1.255) a partir de IP y máscara. */
export function broadcastAddress(ip: string, netmask: string): string {
  const a = ip.split('.').map(Number)
  const m = netmask.split('.').map(Number)
  if (a.length !== 4 || m.length !== 4 || [...a, ...m].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`IP o máscara inválida: ${ip}/${netmask}`)
  }
  return a.map((o, k) => (o | (~m[k]! & 255)) & 255).join('.')
}

/** Puntaje para preferir la interfaz WiFi/Ethernet real del Mac sobre VPNs y puentes virtuales. */
function ifaceScore(name: string, ip: string): number {
  let score = 0
  if (/^en\d+$/.test(name)) score += 10 // en0 = WiFi en la mayoría de Macs
  if (name === 'en0') score += 5
  if (/^(utun|bridge|vmnet|vboxnet|docker|awdl|llw|lo)/.test(name)) score -= 20
  if (/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) score += 3
  if (ip.startsWith('169.254.')) score -= 10 // link-local: sin DHCP
  return score
}

/**
 * Devuelve la IP de la red local donde publicar el servidor.
 * Se puede forzar con la variable de entorno SOLACE_HOST_IP.
 */
export function getLanAddress(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
  forced: string | undefined = process.env.SOLACE_HOST_IP,
): LanAddress | null {
  const candidates: (LanAddress & { score: number })[] = []
  for (const [iface, infos] of Object.entries(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue
      candidates.push({
        iface,
        ip: info.address,
        netmask: info.netmask,
        broadcast: broadcastAddress(info.address, info.netmask),
        score: ifaceScore(iface, info.address),
      })
    }
  }
  if (forced) {
    const hit = candidates.find((c) => c.ip === forced)
    if (hit) return strip(hit)
    return { iface: 'manual', ip: forced, netmask: '255.255.255.0', broadcast: broadcastAddress(forced, '255.255.255.0') }
  }
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0] ? strip(candidates[0]) : null
}

function strip(c: LanAddress & { score?: number }): LanAddress {
  return { iface: c.iface, ip: c.ip, netmask: c.netmask, broadcast: c.broadcast }
}
