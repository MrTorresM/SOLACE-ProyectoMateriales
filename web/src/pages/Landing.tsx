import { ArrowRight, Eye, SlidersHorizontal } from 'lucide-react'
import { motion } from 'motion/react'
import { Emblem, Wordmark } from '../components/Logo.tsx'

export function Landing() {
  return (
    <div className="landing">
      <motion.div className="landing-brand" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
        <Emblem size={96} />
        <Wordmark size={44} />
        <p className="slogan">Power when it matters.</p>
      </motion.div>

      <div className="landing-cards">
        {[
          { href: '/listener', icon: <Eye size={22} />, title: 'Ver en vivo', text: 'Batería, energía, luz y temperatura en tiempo real. Solo lectura.' },
          { href: '/mainUser', icon: <SlidersHorizontal size={22} />, title: 'Panel de control', text: 'Todo lo anterior y además el control de la tira LED.' },
        ].map((c, i) => (
          <motion.a
            key={c.href}
            href={c.href}
            className="card landing-card"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.08, duration: 0.5 }}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.98 }}
          >
            <span className="landing-icon">{c.icon}</span>
            <span className="landing-title">{c.title}</span>
            <span className="muted small">{c.text}</span>
            <ArrowRight size={18} className="landing-arrow" aria-hidden />
          </motion.a>
        ))}
      </div>
    </div>
  )
}
