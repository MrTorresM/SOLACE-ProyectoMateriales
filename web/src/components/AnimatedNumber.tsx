import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../lib/context.tsx'

/** Interpola suavemente hacia `value` (easeOutCubic). Sin animación si el usuario lo prefiere. */
export function useAnimatedValue(value: number, duration = 650): number {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  const raf = useRef<number | null>(null)

  useEffect(() => {
    if (!Number.isFinite(value)) {
      setShown(value)
      return
    }
    if (prefersReducedMotion() || !Number.isFinite(from.current)) {
      from.current = value
      setShown(value)
      return
    }
    const start = performance.now()
    const a = from.current
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / duration)
      const e = 1 - (1 - k) ** 3
      const v = a + (value - a) * e
      from.current = v
      setShown(v)
      if (k < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [value, duration])

  return shown
}

export function AnimatedNumber({ value, format }: { value: number; format: (x: number) => string }) {
  const v = useAnimatedValue(value)
  return (
    <span className="num" aria-label={format(value)}>
      {format(v)}
    </span>
  )
}
