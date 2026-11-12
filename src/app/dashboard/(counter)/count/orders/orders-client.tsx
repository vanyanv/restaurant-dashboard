"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Section, useCounterTransition, usePageChrome, useSurfaceHref } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { DraftData, DraftSections } from "@/lib/counter/adapters/draft-orders"
import { setDraftSkipCount } from "@/lib/counter/actions/count"
import { COVER_DAY_CHOICES } from "@/lib/counter/draft-orders"
import { CountHead, money, OutcomeLine, StoreChips, type Outcome } from "../count-ui"

/**
 * Count & waste — Orders. A draft of what to order from each vendor, built
 * from the count, invoices and sales through recipes. "Skip this week's count"
 * shows what the draft is when the latest count is left out; every figure on it is labelled an estimate and shows how
 * it was reached. Nothing here places an order.
 */
export function OrdersClient({ sections }: { sections: SectionSources<DraftSections> }) {
  usePageChrome({ leaf: "Orders" })
  const { pending } = useCounterTransition()
  return (
    <>
      <CountHead sub="Draft orders, an estimate for testing. Nothing is sent." />
      <Section title="Draft orders" meta={(d) => d?.store.name ?? ""} data={sections.drafts} pending={pending} pad={false}>
        {(d) => (d ? <Drafts data={d} /> : null)}
      </Section>
    </>
  )
}

function Drafts({ data }: { data: DraftData }) {
  const router = useRouter()
  const href = useSurfaceHref()
  const [busy, start] = useTransition()
  const [outcome, setOutcome] = useState<Outcome>(null)
  const path = "/dashboard/count/orders"
  const cover = String(data.coverDays)

  function toggle(skip: boolean) {
    start(async () => {
      const r = await setDraftSkipCount(data.store.id, skip)
      setOutcome(r.ok ? { ok: true, text: r.message ?? "Saved" } : { ok: false, text: r.error })
      router.refresh()
    })
  }

  const lines = data.vendors.reduce((t, v) => t + v.rows.length, 0)
  const dollars = data.vendors.reduce((t, v) => t + v.dollars, 0)
  const unpriced = data.vendors.reduce((t, v) => t + v.unpriced, 0)

  return (
    <div style={{ display: "grid" }}>
      <div className="cw-pad" style={{ borderBottom: "1px solid var(--line)" }}>
        <StoreChips stores={data.stores} current={data.store.id} path={path} extra={{ cover }} />
        <div className="cd-switch">
          <span>
            <b>Skip this week&apos;s count at {data.store.name}: {data.store.skip ? "On" : "Off"}</b>
            <br />
            <small style={{ color: "var(--ink-2)" }}>
              {data.store.skip
                ? "Counts from the last 7 days are left out. On hand is rolled forward from the count before."
                : "Using the latest count. Turn on to see what the order would be without it."}
            </small>
          </span>
          <button
            type="button"
            className={`cw__btn ${data.store.skip ? "cw__btn--primary" : ""}`}
            style={{ flex: "0 0 auto" }}
            disabled={busy}
            aria-pressed={data.store.skip}
            onClick={() => toggle(!data.store.skip)}
          >
            {data.store.skip ? "Turn off" : "Turn on"}
          </button>
        </div>
        <OutcomeLine outcome={outcome} />
        <div className="cw__chips" role="group" aria-label="Order enough to last">
            <span className="cw__mono" style={{ alignSelf: "center" }}>Last after it arrives</span>
            {COVER_DAY_CHOICES.map((n) => (
              <button
                key={n}
                type="button"
                className="cw__chip"
                aria-pressed={data.coverDays === n}
                onClick={() => router.push(href(`${path}?${new URLSearchParams({ store: data.store.id, cover: String(n) }).toString()}`))}
              >
                {n} days
              </button>
            ))}
        </div>
      </div>

      <>
          <div className="cw-pad">
            <p className="cw__sub">
              {lines === 0
                ? `Nothing to order for ${data.store.name} right now: everything counted is covered for ${data.coverDays} days after the next delivery.`
                : `${lines} ${lines === 1 ? "item" : "items"} to order from ${data.vendors.length} ${data.vendors.length === 1 ? "vendor" : "vendors"}, ${unpriced === lines ? "with no prices on file yet" : `about ${money(dollars)} at your latest prices${unpriced > 0 ? ` (${unpriced} without a price, not in that total)` : ""}`}. Estimate: check it against what you would order.`}
            </p>
          </div>
          {data.vendors.map((v) => (
            <div className="cd-vendor" key={v.vendor}>
              <div className="cd-vendor__head">
                <h3>{v.vendor}</h3>
                <span className="cw__mono">{v.lead} · {v.unpriced === v.rows.length ? "no prices yet" : `about ${money(v.dollars)}${v.unpriced > 0 ? `, ${v.unpriced} unpriced` : ""}`}</span>
              </div>
              <div className="cd-list">
                {v.rows.map((r) => (
                  <div className="cd-item" key={r.id}>
                    <div className="cd-item__top">
                      <b>{r.name}</b>
                      <span className="cd-item__order">{r.order}</span>
                    </div>
                    <span className={`cd-item__when ${r.urgent ? "cd-item__when--now" : ""}`}>{r.when}</span>
                    <span className="cd-item__facts">
                      On hand {r.onHand} · uses about {r.perDay} a day ({r.basis})
                      {r.caseNote ? ` · ${r.caseNote}` : ""}
                      {r.dollars != null ? ` · about ${money(r.dollars)}` : " · no price yet"}
                    </span>
                    <span className={`cd-item__facts ${r.stale ? "cd-item__stale" : ""}`}>
                      {r.counted}
                      {r.stale ? ". A count was skipped, so on hand is rolled forward from then using invoices and sales, and may be further off." : ""}
                    </span>
                    {r.needCaseSize && <span className="cd-item__facts">No case size set, so this is in {r.unit}. Set it on the ingredient page.</span>}
                    {r.partial && <span className="cd-item__facts">Some deliveries since the count need a case size, so on hand may read low.</span>}
                    <details>
                      <summary>How this was worked out</summary>
                      <p>{r.how}</p>
                    </details>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {(data.notCounted.length > 0 || data.belowZero.length > 0 || data.covered > 0) && (
            <div className="cw-pad" style={{ borderTop: "1px solid var(--line)" }}>
              {data.covered > 0 && <p className="cw__sub">{data.covered} counted {data.covered === 1 ? "item is" : "items are"} covered and left off.</p>}
              {data.notCounted.length > 0 && (
                <p className="cw__sub">
                  {data.store.skip ? "No count from before the last 7 days, so no draft" : `Can't draft until counted at ${data.store.name}`}: {data.notCounted.join(", ")}.{" "}
                  <Link href={href(`/dashboard/count?store=${data.store.id}`)}>Start a count</Link>
                </p>
              )}
              {data.belowZero.length > 0 && (
                <p className="cw__sub">On hand reads below zero, so count these again before ordering: {data.belowZero.join(", ")}.</p>
              )}
            </div>
          )}
      </>
    </div>
  )
}
