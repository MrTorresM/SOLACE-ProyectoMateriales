import { Check, Copy, QrCode } from 'lucide-react'
import { useState } from 'react'
import { useHub } from '../lib/context.tsx'

export function SharePanel() {
  const url = useHub((s) => s.hub?.listenerUrl)
  const listeners = useHub((s) => s.hub?.listeners ?? 0)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* http:// sin permisos de portapapeles */
    }
  }

  return (
    <section className="card share" aria-label="Compartir vista en vivo">
      <header className="card-head">
        <h2>Compartir</h2>
        <QrCode size={16} aria-hidden className="muted" />
      </header>
      <div className="share-body">
        <img src="/api/qr.svg?target=listener" alt="Código QR de la vista en vivo" width={132} height={132} />
        <div>
          <p className="small">Quien escanee este código ve los datos en vivo (solo lectura).</p>
          {url && (
            <button className="url" onClick={copy} title="Copiar enlace">
              <span>{url.replace(/^https?:\/\//, '')}</span>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          )}
          <p className="muted tiny">{listeners === 1 ? '1 espectador conectado' : `${listeners} espectadores conectados`}</p>
        </div>
      </div>
    </section>
  )
}
