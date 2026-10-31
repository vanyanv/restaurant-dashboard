"use client"

import localFont from "next/font/local"
import { shortStoreName } from "@/lib/checks/names"
import { useEffect, useRef, useState, useTransition } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { Section, useCounterTransition, usePageChrome } from "@/components/counter"
import { rotateCheckLink, saveCheckReportEmails } from "@/lib/counter/actions/checks"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { PostersSections } from "@/lib/counter/adapters/checks"
import { ChecksHead, OutcomeLine, type Outcome } from "../checks-ui"
import { Poster, type PosterStore } from "./poster"

/**
 * The poster wears the restaurant's display face, as the crew page does
 * (src/app/checks/layout.tsx). Not preloaded: only this page and /checks use
 * it (see the next/font rule in scripts/counter-lint.ts).
 */
const bowlby = localFont({
  src: "../../../../../fonts/bowlby-one-latin.woff2",
  variable: "--font-bowlby",
  display: "swap",
  preload: false,
})

/**
 * Store checks — QR posters. One US Letter poster per store, with the
 * crew's steps in English and Spanish. The QR carries the logo in its
 * middle; error correction H is what lets a code read with its centre
 * covered, and the logo is held to half the width (tested: past about 60%
 * it stops reading).
 */
export function ChecksPostersClient({ sections }: { sections: SectionSources<PostersSections> }) {
  usePageChrome({ leaf: "Links & email" })
  const { pending } = useCounterTransition()
  // The stores being printed right now: one, or every store at once.
  const [printing, setPrinting] = useState<string[] | null>(null)
  return (
    <>
      <ChecksHead sub="Text crew the link, print the poster, and choose who gets each check by email" />
      <Section title="Check emails" data={sections.posters} pending={pending}>
        {(d) => <ReportEmails emails={d.reportEmails} ready={d.emailReady} />}
      </Section>
      <Section title="Links & QR posters" meta={(d) => `${d.stores.length} stores`} data={sections.posters} pending={pending}>
        {(d) => (
          <>
            <div className="ck-row" style={{ marginBottom: 14 }}>
              <button type="button" className="btn btn--primary" onClick={() => setPrinting(d.stores.map((s) => s.id))}>
                Print all {d.stores.length} posters
              </button>
              <span className="ck-meta">US Letter, one store per page. Turn on “Background graphics” if the red band prints white.</span>
            </div>
            <div className="ck-posters">
              {d.stores.map((s) => (
                <PosterCard key={s.id} store={s} onPrint={() => setPrinting([s.id])} />
              ))}
            </div>
            {printing && (
              <PrintSheets stores={d.stores.filter((s) => printing.includes(s.id))} onDone={() => setPrinting(null)} />
            )}
          </>
        )}
      </Section>
    </>
  )
}

/**
 * The sheets to print, put straight under <body> so print CSS can hide the
 * rest of the page by display (one sheet per page, page breaks between),
 * rather than pinning one poster over a hidden page, which can't paginate.
 */
function PrintSheets({ stores, onDone }: { stores: PosterStore[]; onDone: () => void }) {
  // Held in a ref so a parent re-render doesn't reopen the print dialog.
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  })
  useEffect(() => {
    // Runs after the sheets are in the document, so the dialog sees them.
    const done = () => doneRef.current()
    window.addEventListener("afterprint", done, { once: true })
    // Let the logo and font load before the dialog snapshots the page.
    const t = window.setTimeout(() => window.print(), 150)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener("afterprint", done)
    }
  }, [])
  return createPortal(
    <div className={`ck-printsheets ${bowlby.variable}`}>
      {stores.map((s) => (
        <Poster key={s.id} store={s} />
      ))}
    </div>,
    document.body,
  )
}

function PosterCard({ store, onPrint }: { store: PosterStore; onPrint: () => void }) {
  const router = useRouter()
  const [confirm, setConfirm] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const [busy, start] = useTransition()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(store.link)
      setOutcome({ ok: true, text: "Link copied" })
    } catch {
      setOutcome({ ok: false, text: "Couldn't copy. Select the link below instead." })
    }
  }
  const message = `${shortStoreName(store.name)} store checks. Open this, enter your PIN, and tick your tasks: ${store.link}`
  // A phone opens Messages with the text filled in; the owner picks who.
  const smsHref = `sms:?&body=${encodeURIComponent(message)}`
  const share = async () => {
    try {
      await navigator.share({ title: `${store.name} store checks`, text: message })
    } catch {
      // Dismissed, or not supported: the other buttons still work.
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
      <Poster store={store} className={bowlby.variable} />
      <div className="ck-row">
        <button type="button" className="btn btn--primary" onClick={onPrint}>
          Print poster
        </button>
        <button type="button" className="btn" onClick={copy}>
          Copy link
        </button>
        <a className="btn" href={smsHref}>
          Text to crew
        </a>
        {typeof navigator !== "undefined" && "share" in navigator && (
          <button type="button" className="btn" onClick={share}>
            Share…
          </button>
        )}
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

function ReportEmails({ emails, ready }: { emails: string[]; ready: boolean }) {
  const router = useRouter()
  const [text, setText] = useState(emails.join(", "))
  const [outcome, setOutcome] = useState<Outcome>(null)
  const [busy, start] = useTransition()
  const save = () =>
    start(async () => {
      const list = text.split(/[\s,;]+/).filter(Boolean)
      const r = await saveCheckReportEmails({ emails: list })
      setOutcome(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error })
      if (r.ok) router.refresh()
    })
  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 640 }}>
      <span className="ck-meta">
        Every submitted Morning and Night check is emailed here: who sent it, every task with its time and who did it,
        notes, and a link to the photos.
      </span>
      <label className="ck-field">
        <span className="ck-mono">Send to (comma between addresses)</span>
        <input className="ck-input" type="text" inputMode="email" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="ck-row">
        <button type="button" className="btn btn--primary" disabled={busy || text === emails.join(", ")} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
        <OutcomeLine outcome={outcome} />
      </div>
      {!ready && (
        <span className="ck-meta ck-tone-warn">
          Email isn&apos;t switched on for the dashboard yet: RESEND_API_KEY and CHECKS_EMAIL_FROM need setting in Vercel.
          Until then nothing is sent.
        </span>
      )}
    </div>
  )
}
