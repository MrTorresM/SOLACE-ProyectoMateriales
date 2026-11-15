import { useEffect, useMemo, useState } from 'react'
import { HubProvider } from './lib/context.tsx'
import { connectHub, type HubClient } from './lib/hubClient.ts'
import { createStore } from './lib/store.ts'
import { Dashboard } from './pages/Dashboard.tsx'
import { Landing } from './pages/Landing.tsx'

export type Route = { page: 'landing' } | { page: 'dashboard'; role: 'main' | 'listener' }

export function routeFor(pathname: string): Route {
  const p = pathname.replace(/\/+$/, '').toLowerCase()
  if (p === '/mainuser') return { page: 'dashboard', role: 'main' }
  if (p === '/listener') return { page: 'dashboard', role: 'listener' }
  return { page: 'landing' }
}

type Theme = 'light' | 'dark'

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('solace-theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* almacenamiento bloqueado */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0F262B' : '#E8E6DF')
    try {
      localStorage.setItem('solace-theme', theme)
    } catch {
      /* noop */
    }
  }, [theme])
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}

function LiveApp({ role }: { role: 'main' | 'listener' }) {
  const [theme, toggle] = useTheme()
  const store = useMemo(() => createStore(), [])
  // El cliente se crea en un efecto (no en useMemo) para que StrictMode no deje conexiones cerradas o duplicadas.
  const [client, setClient] = useState<HubClient | null>(null)
  useEffect(() => {
    const c = connectHub(role, store)
    setClient(c)
    return () => c.close()
  }, [role, store])
  useEffect(() => {
    document.title = role === 'main' ? 'SOLACE · Control' : 'SOLACE · En vivo'
  }, [role])
  if (!client) return null
  return (
    <HubProvider store={store} client={client}>
      <Dashboard role={role} theme={theme} onToggleTheme={toggle} />
    </HubProvider>
  )
}

export function App() {
  const route = routeFor(location.pathname)
  if (route.page === 'landing') return <LandingWithTheme />
  return <LiveApp role={route.role} />
}

function LandingWithTheme() {
  useTheme()
  return <Landing />
}
