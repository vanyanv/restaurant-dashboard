import type { Metadata, Viewport } from "next"
import { checkLink, findStoreByCode, loadCrewView } from "@/lib/checks/crew"
import { PrintButton } from "./print-button"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "How to do store checks · Chris N Eddy's",
  robots: { index: false, follow: false },
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" }

/**
 * The how-to guide the owner texts a new crew member from Crew & PINs
 * ("Text how-to"). Public like the check page itself, and it never shows a
 * PIN: the PIN goes in its own text. Today's check times come from the same
 * loader as the crew page, so the guide can't disagree with the list.
 * "Save as PDF" prints it; the print sheet on every phone saves a PDF.
 */
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const store = await findStoreByCode(code)
  if (!store) {
    return (
      <main className="ct-root ckc ckb">
        <div className="ckc__col">
          <div style={{ display: "grid", gap: 10, textAlign: "center", marginTop: 24 }}>
            <h1>This link isn&apos;t in use</h1>
            <p className="ckc__dim">Ask your manager for the store&apos;s current link. / Pide a tu gerente el enlace nuevo.</p>
          </div>
        </div>
      </main>
    )
  }
  const view = await loadCrewView(store, new Date())
  const checks = view.rows
  const href = `/checks/${code}`

  return (
    <main className="ct-root ckc ckb">
      <div className="ckc__col ckb__how">
        <header className="ckb__band">
          <img src="/checks-logo.png" alt="Chris N Eddy's" />
          <span className="ckb__store">{store.name}</span>
        </header>

        <section>
          <h1>How to do store checks</h1>
          <p className="ckc__dim">Your manager texted you your PIN separately. Keep it to yourself.</p>
        </section>

        <a className="ckc__btn ckb__noprint" href={href}>
          Open {store.name} checks
        </a>

        <section>
          <h2>Steps</h2>
          <ol>
            <li>Open the link on your phone, or scan the QR poster in the store.</li>
            <li>Tap the check that is open now. Tap <b>ES</b> for Spanish.</li>
            <li>Enter your PIN.</li>
            <li>Do each task, then tap it. Every tick saves on its own.</li>
            <li>
              If a task says <b>Photo required</b>, take the photo with the camera right then.
            </li>
            <li>
              Tap <b>Submit</b> while Submit is open (times below).
            </li>
          </ol>
          <p>
            If something on a task needs explaining, tap <b>⋯</b> next to it and pick <b>Done, with a note</b>. Your manager
            sees the note. The list closes by itself when Submit closes, so submit before then.
          </p>
        </section>

        {checks.length > 0 && (
          <section>
            <h2>Today&apos;s checks</h2>
            <ul className="ckb__howlist">
              {checks.map((c) => (
                <li key={c.kind}>
                  <b>{c.label.en}</b> · opens {c.opensLabel} · submit {c.submitLabel}
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="ckb__printlink">
          Link: <span>{checkLink(code)}</span>
        </p>

        <hr />

        <section lang="es">
          <h1>Cómo hacer las revisiones</h1>
          <p className="ckc__dim">Tu gerente te mandó tu PIN en otro mensaje. No lo compartas.</p>
          <ol>
            <li>Abre el enlace en tu teléfono, o escanea el cartel QR en la tienda.</li>
            <li>Toca la revisión que está abierta. Toca <b>ES</b> para español.</li>
            <li>Escribe tu PIN.</li>
            <li>Haz cada tarea y luego tócala. Cada marca se guarda sola.</li>
            <li>
              Si una tarea pide <b>foto</b>, tómala con la cámara en ese momento.
            </li>
            <li>
              Toca <b>Enviar</b> mientras esté abierto (horarios abajo).
            </li>
          </ol>
          <p>
            Si necesitas explicar algo, toca <b>⋯</b> junto a la tarea y elige <b>Hecha, con una nota</b>. La lista se cierra
            sola cuando termina el horario de enviar.
          </p>
          {checks.length > 0 && (
            <ul className="ckb__howlist">
              {checks.map((c) => (
                <li key={c.kind}>
                  <b>{c.label.es}</b> · abre {c.opensLabel} · enviar {c.submitLabel}
                </li>
              ))}
            </ul>
          )}
        </section>

        <PrintButton />
      </div>
    </main>
  )
}
