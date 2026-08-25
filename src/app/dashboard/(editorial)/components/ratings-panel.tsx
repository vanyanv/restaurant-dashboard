"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"

export interface RatingsScope {
  id: string
  label: string
  /** Pre-open stores render an explanation instead of a zero. */
  preOpen: boolean
  summary: {
    average: number | null
    count: number
    lowCount: number
    distribution: number[]
    windowDays: number
    stale: boolean
    deltaVsPrior: number | null
    byPlatform: Array<{ platform: string; count: number; average: number }>
    recent: Array<{
      id: string
      rating: number
      reviewText: string | null
      platform: string
      storeName: string
      reviewedAt: string
      orderItems: string[]
    }>
  } | null
  /** Only on the "all" scope: one line per store. */
  perStore?: Array<{
    id: string
    label: string
    preOpen: boolean
    average: number | null
    count: number
  }>
}

/**
 * Reviews scoped by store. Every scope is fetched server-side and switched
 * locally, so the tabs are instant and no scope re-renders the page — the
 * counts here are small enough that fetching all of them costs less than a
 * round trip per click.
 */
export function RatingsPanel({ scopes }: { scopes: RatingsScope[] }) {
  const [active, setActive] = useState(scopes[0]?.id ?? "all")
  const scope = scopes.find((s) => s.id === active) ?? scopes[0]
  if (!scope) return null

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-(--hairline) pb-3">
        <span className="editorial-section-label">
          What customers said
          {scope.summary && !scope.summary.stale
            ? ` · last ${scope.summary.windowDays} days`
            : ""}
        </span>
        <div className="h-px flex-1 border-t border-dotted border-[var(--hairline-bold)]" />
        <div
          className="flex border border-[var(--hairline-bold)] bg-white/55"
          role="tablist"
          aria-label="Review scope"
        >
          {scopes.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === active}
              onClick={() => setActive(s.id)}
              className={cn(
                "px-[9px] py-[3px] font-mono text-[9.5px] uppercase tracking-[0.14em] transition-colors",
                i > 0 && "border-l border-[var(--hairline)]",
                s.id === active
                  ? "bg-(--accent-bg) text-(--accent)"
                  : s.preOpen
                    ? "text-(--ink-faint) hover:text-(--ink-muted)"
                    : "text-(--ink-muted) hover:text-(--ink)"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <section className="inv-panel inv-panel--flush">
        {scope.preOpen || !scope.summary ? (
          <PreOpen label={scope.label} />
        ) : (
          <ScopeBody scope={scope} />
        )}
      </section>
    </>
  )
}

function PreOpen({ label }: { label: string }) {
  return (
    <div className="px-6 py-8">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-(--ink-faint)">
        {label} · pre-open
      </div>
      <p className="font-display mt-3 max-w-[44ch] text-[21px] italic leading-[1.3] tracking-[-0.02em]">
        No reviews yet. This store has not taken an order.
      </p>
      <p className="mt-3 max-w-[56ch] text-[13px] leading-[1.6] text-(--ink-muted)">
        Ratings begin arriving once the delivery platforms go live against this
        location.
      </p>
    </div>
  )
}

function ScopeBody({ scope }: { scope: RatingsScope }) {
  const s = scope.summary!
  const max = Math.max(...s.distribution, 1)
  // The store name only earns its place when more than one store has reviews.
  // With a single trading site every row said "· CHRIS N EDDYS", which is the
  // brand, not the location, and identical on all of them.
  const showStore =
    (scope.perStore?.filter((st) => !st.preOpen).length ?? 0) > 1

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3 border-b border-(--hairline) px-5 py-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-muted)">
            {scope.label}
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="text-[32px] leading-none font-semibold tabular-nums">
              {s.average != null ? s.average.toFixed(2) : "—"}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--ink-muted)">
              of 5
            </span>
            {!s.stale &&
            s.deltaVsPrior != null &&
            Math.abs(s.deltaVsPrior) >= 0.05 ? (
              <span
                className="font-mono text-[10px] uppercase tracking-[0.14em] tabular-nums"
                style={{
                  color:
                    s.deltaVsPrior < 0 ? "var(--accent)" : "var(--ink-muted)",
                }}
              >
                {s.deltaVsPrior > 0 ? "▲" : "▼"}{" "}
                {Math.abs(s.deltaVsPrior).toFixed(2)} vs prior {s.windowDays}d
              </span>
            ) : null}
          </div>
        </div>

        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-muted)">
            Reviews
          </div>
          <div className="mt-0.5 text-[32px] leading-none font-semibold tabular-nums">
            {s.count}
          </div>
        </div>

        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-muted)">
            1–2 star
          </div>
          <div
            className="mt-0.5 text-[32px] leading-none font-semibold tabular-nums"
            style={{ color: s.lowCount > 0 ? "var(--accent)" : "var(--ink)" }}
          >
            {s.lowCount}
          </div>
        </div>

        <div className="ml-auto flex items-end gap-1" aria-hidden>
          {s.distribution.map((n, i) => (
            <div key={i} className="flex w-6 flex-col items-center gap-1">
              <div
                className="w-full bg-(--ink)"
                style={{ height: `${Math.max(2, (n / max) * 44)}px` }}
              />
              <span className="font-mono text-[9px] text-(--ink-muted)">
                {i + 1}
              </span>
            </div>
          ))}
        </div>
        <span className="sr-only">
          Rating distribution:{" "}
          {s.distribution
            .map((n, i) => `${n} at ${i + 1} star${n === 1 ? "" : "s"}`)
            .join(", ")}
        </span>
      </div>

      {scope.perStore && scope.perStore.length > 1 && (
        <div>
          <div className="px-5 pt-3 pb-1.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-(--ink-faint)">
            By store
          </div>
          {scope.perStore.map((st) => (
            <div
              key={st.id}
              className="flex items-baseline gap-3 border-b border-(--hairline) px-5 py-2.5"
            >
              <span
                className={cn(
                  "flex-1 text-[13px]",
                  st.preOpen && "text-(--ink-muted)"
                )}
              >
                {st.label}
              </span>
              {st.preOpen ? (
                <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-(--ink-faint)">
                  Pre-open
                </span>
              ) : (
                <span className="font-mono text-[11px] tabular-nums text-(--ink-muted)">
                  {st.count} reviews
                </span>
              )}
              <span
                className="w-[52px] text-right text-[14px] font-semibold tabular-nums"
                style={{ color: st.average == null ? "var(--ink-faint)" : undefined }}
              >
                {st.average != null ? st.average.toFixed(2) : "—"}
              </span>
            </div>
          ))}
        </div>
      )}

      {!scope.perStore && s.byPlatform.length > 1 && (
        <div>
          <div className="px-5 pt-3 pb-1.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-(--ink-faint)">
            By platform
          </div>
          {s.byPlatform.map((p) => {
            // Red only where a platform sits materially below the scope's own
            // blend — that gap is the actionable signal, not the mean itself.
            const behind =
              s.average != null && p.average <= s.average - 0.2
            return (
              <div
                key={p.platform}
                className="flex items-baseline gap-3 border-b border-(--hairline) px-5 py-2.5"
              >
                <span className="flex-1 text-[13px] capitalize">{p.platform}</span>
                <span className="font-mono text-[11px] tabular-nums text-(--ink-muted)">
                  {p.count} reviews
                </span>
                <span
                  className="w-[52px] text-right text-[14px] font-semibold tabular-nums"
                  style={{ color: behind ? "var(--accent)" : undefined }}
                >
                  {p.average.toFixed(2)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <ul>
        {s.recent.map((r) => (
          <li key={r.id} className="stack-row">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span
                className="font-mono text-[11px] tabular-nums"
                style={{
                  color: r.rating <= 2 ? "var(--accent)" : "var(--ink-muted)",
                }}
              >
                {r.rating}/5
              </span>
              <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-(--ink-muted)">
                {r.platform}
                {showStore ? ` · ${r.storeName}` : ""}
              </span>
              <span className="ml-auto font-mono text-[10px] tabular-nums text-(--ink-muted)">
                {r.reviewedAt}
              </span>
            </div>
            {r.reviewText ? (
              <p className="mt-1 max-w-[80ch] text-[13px] leading-6 text-(--ink)">
                {r.reviewText}
              </p>
            ) : (
              <p className="mt-1 text-[13px] italic text-(--ink-muted)">
                Rating left without a comment.
              </p>
            )}
            {r.orderItems.length > 0 ? (
              <p className="mt-1 font-mono text-[10px] text-(--ink-muted)">
                Ordered: {r.orderItems.join(" · ")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  )
}
