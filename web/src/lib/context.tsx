import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { HubState, Store } from './store.ts'
import type { HubClient } from './hubClient.ts'

interface Ctx {
  store: Store
  client: HubClient
}

const HubContext = createContext<Ctx | null>(null)

export function HubProvider({ store, client, children }: Ctx & { children: ReactNode }) {
  return <HubContext.Provider value={{ store, client }}>{children}</HubContext.Provider>
}

function useCtx(): Ctx {
  const ctx = useContext(HubContext)
  if (!ctx) throw new Error('HubProvider ausente')
  return ctx
}

export function useHub<T>(selector: (s: HubState) => T): T {
  const { store } = useCtx()
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()))
}

export function useHubClient(): HubClient {
  return useCtx().client
}

export function useStore(): Store {
  return useCtx().store
}

/** Reloj que avanza cada `ms` (para "hace 3 s" y detección de datos viejos). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
