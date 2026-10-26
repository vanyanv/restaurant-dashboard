"use client"

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { PageHead, SubNav } from "@/components/counter"
import { SHOP_TABS } from "@/lib/counter/nav"
import {
  markOrderPickedUp,
  markOrderReady,
  markOrderRefunded,
  shipOrder,
  type ActionResult,
} from "@/lib/counter/actions/shop"
import type { OrderLine } from "@/lib/counter/adapters/shop"
import { CARRIERS, cleanTracking, guessCarrier, NEXT_STEP_LABEL, type ShopGlyph } from "@/lib/shop/status"
import { OutcomeLine, type Outcome } from "../checks/checks-ui"

/**
 * Pieces shared by the five Shop tabs: the head with its tabs, the status
 * glyph (Store checks' shapes), the order row with its one next step, and
 * the ship and refund forms. Every write goes through `useShopAction`, which
 * shows the site's own sentence when it refuses.
 */

export { OutcomeLine, type Outcome }

export function ShopHead({ sub, children }: { sub: string; children?: ReactNode }) {
  return (
    <PageHead title="Shop" sub={sub}>
      <SubNav items={SHOP_TABS} label="Shop" />
      {children}
    </PageHead>
  )
}

const GLYPH: Record<ShopGlyph, { cls: string; mark: ReactNode; label: string }> = {
  open: { cls: "ck-gl--open", mark: "◷", label: "Waiting on you" },
  late: { cls: "ck-gl--late", mark: <span>!</span>, label: "Running late" },
  ok: { cls: "ck-gl--ok", mark: "✓", label: "Done" },
  miss: { cls: "ck-gl--miss", mark: "✕", label: "Refunded" },
  up: { cls: "ck-gl--up", mark: "·", label: "Nothing to do" },
}

export function ShopGlyphMark({ glyph, title, small }: { glyph: ShopGlyph; title?: string; small?: boolean }) {
  const g = GLYPH[glyph]
  return (
    <span className={`ck-gl ${g.cls}${small ? " ck-gl--sm" : ""}`} role="img" aria-label={title ?? g.label} title={title ?? g.label}>
      {g.mark}
    </span>
  )
}

export function ShopLegend() {
  return (
    <div className="ck-legend">
      {(["open", "late", "ok", "miss"] as const).map((g) => (
        <span key={g}>
          <ShopGlyphMark glyph={g} small />
          {GLYPH[g].label}
        </span>
      ))}
    </div>
  )
}

export function useShopAction() {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [outcome, setOutcome] = useState<Outcome>(null)
  const run = (fn: () => Promise<ActionResult>, after?: (r: ActionResult) => void) =>
    start(async () => {
      const r = await fn()
      setOutcome(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error })
      if (r.ok) {
        after?.(r)
        router.refresh()
      }
    })
  return { busy, outcome, run, setOutcome }
}

/** One order on the desk: glyph, who, what, total, and the next step as a button. */
export function OrderRow({ o, href }: { o: OrderLine; href: string }) {
  const { busy, outcome, run } = useShopAction()
  const [shipping, setShipping] = useState(false)
  return (
    <>
      <div className={`sh-order${shipping ? " sh-order--open" : ""}`}>
        <ShopGlyphMark glyph={o.glyph} title={o.stateLabel} />
        <Link href={href} className="who" style={{ color: "inherit", textDecoration: "none" }}>
          <b>
            #{o.number.replace(/^CNE-/, "")} {o.customer}
          </b>
          <span className="ck-mono">
            {o.stateLabel}
            {o.placed ? ` · ${o.placed}` : ""}
          </span>
        </Link>
        <span className="what">{o.items}</span>
        <span className="amt">{o.total}</span>
        <span className="act">
          <OutcomeLine outcome={outcome} />
          {o.next === "ship" && (
            <button type="button" className="btn btn--primary" onClick={() => setShipping((v) => !v)} aria-expanded={shipping}>
              {shipping ? "Cancel" : "Ship it"}
            </button>
          )}
          {o.next === "ready" && (
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run(() => markOrderReady({ orderId: o.id }))}>
              {busy ? "Saving…" : NEXT_STEP_LABEL.ready}
            </button>
          )}
          {o.next === "picked_up" && (
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run(() => markOrderPickedUp({ orderId: o.id }))}>
              {busy ? "Saving…" : NEXT_STEP_LABEL.picked_up}
            </button>
          )}
        </span>
      </div>
      {shipping && <ShipForm orderId={o.id} onDone={() => setShipping(false)} />}
    </>
  )
}

type Detector = { detect: (src: ImageBitmap) => Promise<Array<{ rawValue: string }>> }
type DetectorCtor = new (opts: { formats: string[] }) => Detector

/** BarcodeDetector exists on Chrome and Android; not on iOS Safari, where the box is typed. */
function useBarcodeDetector(): DetectorCtor | null {
  const [ctor, setCtor] = useState<DetectorCtor | null>(null)
  useEffect(() => {
    const c = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
    if (c) setCtor(() => c)
  }, [])
  return ctor
}

export function ShipForm({ orderId, onDone }: { orderId: string; onDone?: () => void }) {
  const [carrier, setCarrier] = useState<string>("USPS")
  const [tracking, setTracking] = useState("")
  const [scanNote, setScanNote] = useState<string | null>(null)
  const { busy, outcome, run } = useShopAction()
  const Detector = useBarcodeDetector()
  const file = useRef<HTMLInputElement>(null)

  const take = (raw: string) => {
    const t = cleanTracking(raw)
    setTracking(t)
    const guess = guessCarrier(t)
    if (guess) setCarrier(guess)
  }

  const scan = async (f: File) => {
    if (!Detector) return
    setScanNote("Reading the label…")
    try {
      const bmp = await createImageBitmap(f)
      const found = await new Detector({ formats: ["code_128", "code_39", "data_matrix", "pdf417", "qr_code", "itf"] }).detect(bmp)
      const best = found.map((b) => b.rawValue).sort((a, b) => b.length - a.length)[0]
      if (best) {
        take(best)
        setScanNote("Read from the label. Check it matches.")
      } else setScanNote("No barcode found. Try closer, or type it.")
    } catch {
      setScanNote("Couldn't read that photo. Type the number instead.")
    }
  }

  return (
    <form
      className="sh-form"
      onSubmit={(e) => {
        e.preventDefault()
        run(() => shipOrder({ orderId, carrier, trackingNumber: tracking }), () => onDone?.())
      }}
    >
      <div className="row">
        <label className="ck-field" style={{ flex: "0 1 140px" }}>
          <span className="ck-mono">Carrier</span>
          <select className="ck-input" value={carrier} onChange={(e) => setCarrier(e.target.value)}>
            {CARRIERS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="ck-field">
          <span className="ck-mono">Tracking number</span>
          <input
            className="ck-input"
            value={tracking}
            onChange={(e) => take(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            autoFocus
          />
        </label>
        {Detector && (
          <>
            <input
              ref={file}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void scan(f)
                e.target.value = ""
              }}
            />
            <button type="button" className="btn" onClick={() => file.current?.click()}>
              Scan label
            </button>
          </>
        )}
        <button type="submit" className="btn btn--primary" disabled={busy || tracking.trim().length === 0}>
          {busy ? "Saving…" : "Mark shipped"}
        </button>
      </div>
      <span className="ck-meta">
        {scanNote ?? "The customer gets an email with the carrier and this number."} <OutcomeLine outcome={outcome} />
      </span>
    </form>
  )
}

export function RefundForm({ orderId, hasEdition, onDone }: { orderId: string; hasEdition: boolean; onDone?: () => void }) {
  const [reason, setReason] = useState("")
  const [release, setRelease] = useState(false)
  const { busy, outcome, run } = useShopAction()
  return (
    <form
      className="sh-form"
      onSubmit={(e) => {
        e.preventDefault()
        run(() => markOrderRefunded({ orderId, reason, release: hasEdition ? release : undefined }), () => onDone?.())
      }}
    >
      <p className="ck-meta" style={{ margin: 0 }}>
        Refund the money in Stripe first. This marks the order refunded here and emails the customer.
      </p>
      <label className="ck-field">
        <span className="ck-mono">Why (only you see this)</span>
        <input className="ck-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      </label>
      {hasEdition && (
        <label className="sh-check">
          <input type="checkbox" checked={release} onChange={(e) => setRelease(e.target.checked)} />
          Put the numbered piece back on sale
        </label>
      )}
      <div className="row">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? "Saving…" : "Mark refunded"}
        </button>
        {onDone && (
          <button type="button" className="btn btn--quiet" onClick={onDone}>
            Cancel
          </button>
        )}
        <OutcomeLine outcome={outcome} />
      </div>
    </form>
  )
}
