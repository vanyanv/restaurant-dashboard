"use client"

import { useState } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import type { NeedsYouItem } from "@/lib/dashboard/needs-you"

/**
 * The expandable attention queue. Collapsed, a row is severity, source, the
 * sentence, the money and its horizon. Opened, it shows the evidence the
 * generator recorded — the impact range it was ranked on, the fit behind it,
 * and the caveats — so the figure can be argued with rather than just believed.
 *
 * Rows are <button> so the whole target is keyboard-reachable and screen
 * readers get the expanded state; the red bar comes from `.needs-row::before`.
 */
export function NeedsYouList({
  items,
  hiddenCount,
}: {
  items: NeedsYouItem[]
  hiddenCount: number
}) {
  // The first item WITH EVIDENCE opens on landing. Opening the top row
  // unconditionally exposed an empty panel whenever it was an alert: alerts
  // carry no opportunity, so the body had nothing in it but a repeat of the
  // headline and a detected-at stamp, which reads worse than collapsed.
  const [open, setOpen] = useState<Set<string>>(() => {
    const first = items.find((i) => i.opportunity != null)
    return new Set(first ? [first.id] : [])
  })

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const allOpen = items.length > 0 && open.size === items.length

  return (
    <>
      <div className="mb-0 flex items-center gap-3 border-b border-[var(--hairline-bold)] pb-3">
        <span className="editorial-section-label">What needs you</span>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-(--ink-faint)">
          Ranked by money at stake · conservative estimate
        </span>
        <div className="h-px flex-1 border-t border-dotted border-[var(--hairline-bold)]" />
        {items.length > 0 && (
          <button
            type="button"
            onClick={() =>
              setOpen(allOpen ? new Set() : new Set(items.map((i) => i.id)))
            }
            className="font-mono text-[10px] uppercase tracking-[0.16em] text-(--ink-muted) transition-colors hover:text-(--accent)"
          >
            {allOpen ? "Collapse" : "Expand all"}
          </button>
        )}
      </div>

      <div className="needs-list">
        {items.map((item) => {
          const isOpen = open.has(item.id)
          return (
            <div key={item.id}>
              <button
                type="button"
                className="needs-row"
                aria-expanded={isOpen}
                onClick={() => toggle(item.id)}
              >
                <ChevronRight
                  className="needs-row__chevron h-3 w-3"
                  aria-hidden="true"
                />
                <span
                  className={cn(
                    "needs-row__severity",
                    item.severity === "critical" && "is-critical"
                  )}
                >
                  {item.severity === "opportunity" ? "Upside" : item.severity}
                </span>
                <span className="needs-row__source">{item.sourceLabel}</span>
                <span className="needs-row__title">{item.title}</span>
                {item.amount && (
                  <span className="needs-row__amount">{item.amount}</span>
                )}
                {item.horizon && (
                  <span className="needs-row__horizon">{item.horizon}</span>
                )}
              </button>
              {isOpen && <NeedsYouDetail item={item} />}
            </div>
          )
        })}
      </div>

      {hiddenCount > 0 && (
        <div className="flex items-baseline gap-3 border-b border-[var(--hairline-bold)] py-3">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-(--ink-faint)">
            {hiddenCount} more
          </span>
          <span className="text-[13px] text-(--ink-muted)">
            Lower down the queue and not shown here.
          </span>
        </div>
      )}
    </>
  )
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

/** "ITEM_VELOCITY" → "Item velocity". */
function humanKind(kind: string): string {
  const words = kind.replace(/[_-]+/g, " ").trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * "DailyCogsItem:Single Patty Slider" → "Single Patty Slider".
 * The generator prefixes evidence refs with the model they came from, which is
 * useful in a log and noise in front of an owner.
 */
function humanRef(ref: string): string {
  const i = ref.lastIndexOf(":")
  const tail = i >= 0 ? ref.slice(i + 1) : ref
  return tail.trim() || ref
}

/** Round long decimals; the generator emits full float precision. */
function humanValue(value: number | string): string {
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? value.toLocaleString()
      : value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  return value
}

function NeedsYouDetail({ item }: { item: NeedsYouItem }) {
  const o = item.opportunity

  return (
    <div className="needs-body">
      <div className="needs-body__grid">
        <div>
          {item.body && item.body !== item.title && (
            <p className="needs-body__prose">{item.body}</p>
          )}

          {o && o.evidence.length > 0 && (
            <div className="mt-4 border-t border-[var(--hairline)]">
              {o.evidence.map((e, i) => (
                <div key={`${e.kind}-${e.ref}-${i}`} className="needs-meta-row">
                  <span className="needs-meta-row__key">{humanKind(e.kind)}</span>
                  <span className="min-w-0 truncate text-[13px]">
                    {humanRef(e.ref)}
                  </span>
                  <span className="needs-meta-row__val">
                    {humanValue(e.value)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          {o && <ImpactRange opportunity={o} />}
          <div className="mt-4 border-t border-[var(--hairline)]">
            {o && (
              <>
                <div className="needs-meta-row">
                  <span className="needs-meta-row__key">Confidence</span>
                  <span className="needs-meta-row__val capitalize">
                    {o.confidence}
                  </span>
                </div>
                <div className="needs-meta-row">
                  <span className="needs-meta-row__key">Horizon</span>
                  <span className="needs-meta-row__val">{o.horizonDays} days</span>
                </div>
              </>
            )}
            <div className="needs-meta-row border-b-0">
              <span className="needs-meta-row__key">Detected</span>
              <span
                className="needs-meta-row__val"
                suppressHydrationWarning
              >
                {item.detectedAt.toLocaleString("en-US", {
                  timeZone: "America/Los_Angeles",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </div>
          </div>

          {o && o.caveats.length > 0 && (
            <p className="mt-3 font-mono text-[10px] leading-[1.7] text-(--ink-faint)">
              Caveats · {o.caveats.join("; ")}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * p10 → p90 as the span, p25 as the mark. Rendered only when the generator
 * propagated a standard error; otherwise the point estimate stands alone rather
 * than being dressed in a fabricated interval.
 */
function ImpactRange({ opportunity: o }: { opportunity: NonNullable<NeedsYouItem["opportunity"]> }) {
  const lo = o.impactP10
  const hi = o.impactP90
  const mid = o.impactP25

  if (lo == null || hi == null || mid == null || !(hi > lo)) {
    return (
      <>
        <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-(--ink-faint)">
          Estimated impact
        </div>
        <div className="mt-2 text-[20px] font-semibold tabular-nums tracking-[-0.016em]">
          {money(o.estimatedDollarImpact)}
        </div>
        <div className="mt-1.5 font-mono text-[10px] text-(--ink-muted)">
          No interval — the fit reported no standard error.
        </div>
      </>
    )
  }

  const pct = (v: number) => ((v - lo) / (hi - lo)) * 100

  return (
    <>
      <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-(--ink-faint)">
        Impact range · {o.horizonDays} days
      </div>
      <div className="needs-range" aria-hidden="true">
        <div className="needs-range__track" />
        <div className="needs-range__span" style={{ left: "0%", width: "100%" }} />
        <div className="needs-range__mark" style={{ left: `${pct(mid)}%` }} />
        <span className="needs-range__cap" style={{ left: 0 }}>
          {money(lo)}
        </span>
        <span className="needs-range__cap" style={{ right: 0 }}>
          {money(hi)}
        </span>
      </div>
      <div className="mt-1.5 font-mono text-[10px] tabular-nums text-(--ink-muted)">
        Ranked on p25 · {money(mid)}
      </div>
      <span className="sr-only">
        Estimated impact between {money(lo)} and {money(hi)} over {o.horizonDays}{" "}
        days; ranked on the 25th percentile, {money(mid)}.
      </span>
    </>
  )
}
