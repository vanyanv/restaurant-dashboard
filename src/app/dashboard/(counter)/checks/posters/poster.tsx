import { shortStoreName } from "@/lib/checks/names"
import type { PosterData } from "@/lib/counter/adapters/checks"

export type PosterStore = PosterData["stores"][number]

/**
 * The step-by-step the crew follow, English over Spanish. The wording
 * follows the crew page's own labels (Morning/Mañana, Submit/Enviar,
 * Problem?/¿Problema?), so what the poster says is what the phone shows.
 */
const STEPS: Array<{ en: string; es: string }> = [
  { en: "Scan the code with your phone.", es: "Escanea el código con tu teléfono." },
  { en: "Tap Morning or Night.", es: "Toca Mañana o Noche. Toca ES para español." },
  { en: "Enter your 4-digit PIN.", es: "Escribe tu PIN de 4 dígitos." },
  { en: "Do each task, then tap it.", es: "Haz cada tarea y luego tócala." },
  { en: "Photo required? Take it live.", es: "¿Foto obligatoria? Tómala en vivo." },
  { en: "Tap Submit before time runs out.", es: "Toca Enviar antes de que se acabe el tiempo." },
]

/** "Chris N Eddy's Van Nuys" or "Chris N Eddys - Van Nuys" -> "Van Nuys": the logo above already says the rest. */
function bandName(name: string): string {
  return shortStoreName(name).replace(/^chris\s*n\s*edd(y|ie)'?s\s+/i, "").trim() || name
}

/**
 * One store's poster, drawn on a US Letter sheet (8.5 × 11 in). Everything
 * is sized in container units, so the on-screen preview and the printed
 * sheet are the same drawing at two scales. In the restaurant's own brand,
 * like the crew page the code opens, not the dashboard's Counter look.
 */
export function Poster({ store, className = "" }: { store: PosterStore; className?: string }) {
  return (
    <article className={`ck-letter ${className}`} aria-label={`${store.name} store checks poster`}>
      <header className="ck-letter__logo">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, printed */}
        <img src="/checks-logo.png" alt="Chris N Eddy's" />
      </header>
      <div className="ck-letter__band">
        <b>{bandName(store.name)}</b>
        <span>Store checks · Revisiones de la tienda</span>
      </div>
      <div className="ck-letter__body">
        <div className="ck-letter__scan">
          <QrCode size={store.qr.size} cells={store.qr.cells} label={`QR code for ${store.name} store checks`} />
          <b>Scan to start</b>
          <span>Escanea para empezar</span>
          {store.windows.length > 0 && (
            <div className="ck-letter__when">
              <small>
                Submit between · <span lang="es">Enviar entre</span>
              </small>
              {store.windows.map((w) => (
                <div key={w.label}>
                  <b>
                    {w.label} <span lang="es">· {w.labelEs}</span>
                  </b>
                  <strong>{w.submit}</strong>
                  {w.until.map((u, i) => (
                    <span key={u}>
                      Until {u} · <span lang="es">Hasta {w.untilEs[i]}</span>
                    </span>
                  ))}
                  <span>
                    List opens {w.opens} · <span lang="es">Abre {w.opens}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="ck-letter__how">
          <h2>
            How to do the check
            <span>Cómo hacer la revisión</span>
          </h2>
          <ol>
            {STEPS.map((s, i) => (
              <li key={s.en}>
                <i>{i + 1}</i>
                <p>
                  {s.en}
                  <span lang="es">{s.es}</span>
                </p>
              </li>
            ))}
          </ol>
          <div className="ck-letter__help">
            <p>
              Forgot your PIN? Ask your manager.
              <span lang="es">¿Olvidaste tu PIN? Pregúntale a tu gerente.</span>
            </p>
            <p>
              Can&apos;t do a task? Tap Problem?
              <span lang="es">¿No se puede hacer? Toca ¿Problema?</span>
            </p>
          </div>
        </div>
      </div>
      <footer className="ck-letter__foot">
        No camera? Open · ¿Sin cámara? Abre: <span>{store.link}</span>
      </footer>
    </article>
  )
}

/** The code as one SVG path, with a quiet zone, and the logo over its centre. */
export function QrCode({ size, cells, label }: { size: number; cells: string; label: string }) {
  let d = ""
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (cells[y * size + x] === "1") d += `M${x + 2} ${y + 2}h1v1h-1z`
    }
  }
  const box = size + 4
  return (
    <div className="ck-qr" role="img" aria-label={label}>
      <svg viewBox={`0 0 ${box} ${box}`} shapeRendering="crispEdges" aria-hidden>
        <rect width={box} height={box} fill="var(--surface)" />
        <path d={d} fill="currentColor" />
      </svg>
      <span className="logo">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, printed */}
        <img src="/checks-logo.png" alt="" />
      </span>
    </div>
  )
}
