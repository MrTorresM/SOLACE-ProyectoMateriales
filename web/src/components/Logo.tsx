/**
 * Emblema "The Beacon": arco protector con núcleo de luz.
 * Vectorizado a partir de BRAND/Teal Protective Arch Emblem.png (viewBox 500×500).
 * Colores según la guía: arco Deep Resilience, núcleo Renewal Teal (o variante reverse).
 */
interface Props {
  size?: number
  variant?: 'primary' | 'reverse'
  title?: string
}

const ARCH = 'M125 392 L125 268 C125 226 140 205 166 186 L222 146 Q250 127 278 146 L334 186 C360 205 375 226 375 268 L375 392'

export function Emblem({ size = 32, variant = 'primary', title = 'SOLACE' }: Props) {
  const arch = variant === 'reverse' ? 'var(--white)' : 'var(--brand-arch)'
  return (
    <svg width={size} height={size} viewBox="70 90 360 330" role="img" aria-label={title}>
      <defs>
        <clipPath id={`legs-${variant}`}>
          <polygon points="0,0 500,0 500,400 404,392 346,368 154,368 96,392 0,400" />
        </clipPath>
      </defs>
      <path d={ARCH} fill="none" stroke={arch} strokeWidth={58} strokeLinejoin="round" clipPath={`url(#legs-${variant})`} />
      <circle cx={250} cy={295} r={46} fill="var(--teal)" />
    </svg>
  )
}

export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      SOLACE
    </span>
  )
}

/** Variante "lámpara" del arco para visualizar la tira LED (no es el logo). */
export const ARCH_PATH = ARCH
