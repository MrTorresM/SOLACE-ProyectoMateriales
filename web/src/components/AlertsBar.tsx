import { BatteryWarning, CircleOff, Plug, Thermometer, TriangleAlert } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { ALERT_INFO, type AlertCode } from '../../../shared/protocol.ts'
import { useHub } from '../lib/context.tsx'

const ICONS: Record<AlertCode, ReactNode> = {
  BAT_LOW: <BatteryWarning size={16} />,
  BAT_CRITICAL: <BatteryWarning size={16} />,
  TEMP_HIGH: <Thermometer size={16} />,
  USB_OUT_OF_SPEC: <Plug size={16} />,
  SENSOR_LUX: <CircleOff size={16} />,
  SENSOR_DHT: <CircleOff size={16} />,
  SENSOR_POWER: <CircleOff size={16} />,
}

export function AlertsBar() {
  const alerts = useHub((s) => s.telemetry?.alerts)
  const online = useHub((s) => s.device.online)
  const list = online ? (alerts ?? []) : []

  return (
    <div className="alerts" role="alert" aria-live="assertive">
      <AnimatePresence initial={false}>
        {list.map((code) => {
          const info = ALERT_INFO[code]
          return (
            <motion.div
              key={code}
              layout
              className={`alert level-${info.level}`}
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.22 }}
            >
              <span className="alert-icon" aria-hidden>
                {info.level === 'critical' ? <TriangleAlert size={16} /> : ICONS[code]}
              </span>
              <span>{info.label}</span>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
