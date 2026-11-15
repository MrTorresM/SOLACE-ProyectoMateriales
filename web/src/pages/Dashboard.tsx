import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useHub } from '../lib/context.tsx'
import { ActivityFeed } from '../components/ActivityFeed.tsx'
import { AlertsBar } from '../components/AlertsBar.tsx'
import { BatteryCard } from '../components/BatteryCard.tsx'
import { BeaconHero } from '../components/BeaconHero.tsx'
import { ControlPanel } from '../components/ControlPanel.tsx'
import { EnvCard } from '../components/EnvCard.tsx'
import { PowerFlow } from '../components/PowerFlow.tsx'
import { SharePanel } from '../components/SharePanel.tsx'
import { Toasts } from '../components/Toasts.tsx'
import { TopBar } from '../components/TopBar.tsx'
import { TrendChart } from '../components/TrendChart.tsx'
import { WifiOff } from 'lucide-react'

function Reveal({ children, i, className }: { children: ReactNode; i: number; className: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  )
}

export function Dashboard({ role, theme, onToggleTheme }: { role: 'main' | 'listener'; theme: 'light' | 'dark'; onToggleTheme: () => void }) {
  const conn = useHub((s) => s.conn)
  return (
    <div className={`app role-${role}`}>
      <TopBar role={role} theme={theme} onToggleTheme={onToggleTheme} />
      {conn !== 'online' && (
        <div className="banner" role="status">
          <WifiOff size={16} aria-hidden /> Sin conexión con el hub. Reintentando…
        </div>
      )}
      <AlertsBar />

      <div className={`layout ${role === 'main' ? 'with-controls' : ''}`}>
        <main className="grid">
          <Reveal i={0} className="area-hero">
            <BeaconHero />
          </Reveal>
          <Reveal i={1} className="area-battery">
            <BatteryCard />
          </Reveal>
          <Reveal i={2} className="area-flow">
            <PowerFlow />
          </Reveal>
          <Reveal i={3} className="area-env">
            <EnvCard />
          </Reveal>
          <Reveal i={4} className="area-chart">
            <TrendChart />
          </Reveal>
          <Reveal i={5} className="area-activity">
            <ActivityFeed />
          </Reveal>
          {role === 'main' && (
            <Reveal i={6} className="area-share">
              <SharePanel />
            </Reveal>
          )}
        </main>
        {role === 'main' && <ControlPanel />}
      </div>

      <footer className="footer muted tiny">SOLACE — Power when it matters.</footer>
      <Toasts />
    </div>
  )
}
