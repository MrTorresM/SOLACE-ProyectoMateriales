const nf = (d: number) => new Intl.NumberFormat('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d })

export function fmt(x: number | null | undefined, decimals = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—'
  return nf(decimals).format(x)
}

/** Potencia con unidad adaptativa: 0,045 W → "45 mW". */
export function fmtPower(w: number): string {
  if (!Number.isFinite(w)) return '—'
  if (Math.abs(w) < 1) return `${nf(0).format(w * 1000)} mW`
  return `${nf(2).format(w)} W`
}

export function fmtCurrent(a: number): string {
  if (!Number.isFinite(a)) return '—'
  if (Math.abs(a) < 1) return `${nf(0).format(a * 1000)} mA`
  return `${nf(2).format(a)} A`
}

/** Minutos → "3 h 05 min" / "45 min". */
export function fmtDuration(min: number | null): string {
  if (min === null || !Number.isFinite(min)) return '—'
  if (min > 99 * 60) return '> 99 h'
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h === 0) return `${m} min`
  return `${h} h ${m.toString().padStart(2, '0')} min`
}

export function fmtLux(lux: number | null): string {
  if (lux === null || !Number.isFinite(lux)) return '—'
  if (lux >= 1000) return `${nf(1).format(lux / 1000)} klx`
  return `${nf(lux < 10 ? 1 : 0).format(lux)} lx`
}

export function luxLabel(lux: number | null): string {
  if (lux === null) return 'Sin lectura'
  if (lux < 5) return 'Oscuro'
  if (lux < 50) return 'Penumbra'
  if (lux < 500) return 'Interior iluminado'
  if (lux < 5000) return 'Luz natural'
  return 'Pleno sol'
}

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 5) return 'ahora'
  if (s < 60) return `hace ${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `hace ${m} min`
  return `hace ${Math.round(m / 60)} h`
}

const COLOR_NAMES: Record<string, string> = {
  '#FFFFFF': 'Blanco',
  '#FFB46B': 'Cálido',
  '#E2A64B': 'Ámbar',
  '#FF0000': 'Rojo',
  '#00FF00': 'Verde',
  '#0000FF': 'Azul',
  '#4C9B8B': 'Teal',
  '#B400FF': 'Violeta',
}

export function colorName(hex: string): string {
  return COLOR_NAMES[hex.toUpperCase()] ?? hex.toUpperCase()
}
