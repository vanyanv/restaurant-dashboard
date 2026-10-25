"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Section, useCounterTransition, usePageChrome } from "@/components/counter"
import { rotateCheckLink } from "@/lib/counter/actions/checks"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { PosterData, PostersSections } from "@/lib/counter/adapters/checks"
import { ChecksHead, OutcomeLine, type Outcome } from "../checks-ui"

/**
 * Store checks — QR posters. One A4 poster per store. The QR carries the
 * logo in its middle; error correction H is what lets a code read with its
 * centre covered, and the logo is held to half the width (tested: past
 * about 60% it stops reading).
 */
export function ChecksPostersClient({ sections }: { sections: SectionSources<PostersSections> }) {
  usePageChrome({ leaf: "QR posters" })
  const { pending } = useCounterTransition()
  return (
    <>
      <ChecksHead sub="Print one for each store, and put it by the hand sink" />
      <Section title="QR posters" meta={(d) => `${d.stores.length} stores`} data={sections.posters} pending={pending}>
        {(d) => (
          <div className="ck-posters">
            {d.stores.map((s) => (
              <PosterCard key={s.id} store={s} />
            ))}
          </div>
        )}
      </Section>
    </>
  )
}

type PosterStore = PosterData["stores"][number]

function PosterCard({ store }: { store: PosterStore }) {
  const router = useRouter()
  const [printing, setPrinting] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const [busy, start] = useTransition()

  const print = () => {
    setPrinting(true)
    // Let the print-only class land before the dialog opens.
    requestAnimationFrame(() => {
      window.print()
      setPrinting(false)
    })
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(store.link)
      setOutcome({ ok: true, text: "Link copied" })
    } catch {
      setOutcome({ ok: false, text: "Couldn't copy. Select the link below instead." })
    }
  }
  const rotate = () =>
    start(async () => {
      const r = await rotateCheckLink({ storeId: store.id })
      setConfirm(false)
      setOutcome(r.ok ? { ok: true, text: r.message ?? "New link made" } : { ok: false, text: r.error })
      if (r.ok) router.refresh()
    })

  return (
    <div className="ck-poster-card">
      <Poster store={store} printing={printing} />
      <div className="ck-row">
        <button type="button" className="btn btn--primary" onClick={print}>
          Print poster
        </button>
        <button type="button" className="btn" onClick={copy}>
          Copy link
        </button>
        {!confirm ? (
          <button type="button" className="btn btn--quiet" onClick={() => setConfirm(true)}>
            New link…
          </button>
        ) : (
          <>
            <button type="button" className="btn" disabled={busy} onClick={rotate}>
              {busy ? "Making…" : "Yes, stop the old poster"}
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => setConfirm(false)}>
              Keep it
            </button>
          </>
        )}
      </div>
      {confirm && (
        <span className="ck-meta">
          A new link stops every {store.name} poster already printed. Use it if a poster was shared outside the store.
        </span>
      )}
      <OutcomeLine outcome={outcome} />
      <span className="ck-url">{store.link}</span>
    </div>
  )
}

function Poster({ store, printing }: { store: PosterStore; printing: boolean }) {
  return (
    <div className={`ck-poster${printing ? " ck-print" : ""}`}>
      <div className="lg">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, printed */}
        <img src="/checks-logo.png" alt="Chris N Eddy's" />
      </div>
      <div className="band">
        <b>{store.name}</b>
        <span className="ck-mono" style={{ color: "inherit" }}>
          Store checks
        </span>
      </div>
      <div className="ttl">
        <h3>Scan to do the check</h3>
        <span style={{ color: "var(--ink-2)" }}>Escanea para hacer la revisión</span>
      </div>
      <div className="mid">
        <QrCode size={store.qr.size} cells={store.qr.cells} label={`QR code for ${store.name} store checks`} />
        <ol className="ck-steps">
          <li>
            <span>1</span>
            <div>
              Scan with your camera<em>Escanea con la cámara</em>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              Enter your 4-digit PIN<em>Escribe tu PIN de 4 dígitos</em>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              Tick, photo, submit<em>Marca, foto, envía</em>
            </div>
          </li>
        </ol>
      </div>
      <div className="foot">
        {store.windows.map((w) => (
          <div key={w.label}>
            <span className="ck-mono">{w.label}</span>
            {w.window}
          </div>
        ))}
      </div>
    </div>
  )
}

/** The code as one SVG path, with a quiet zone, and the logo over its centre. */
function QrCode({ size, cells, label }: { size: number; cells: string; label: string }) {
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
