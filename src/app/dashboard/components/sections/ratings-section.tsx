import { getRatingsSummary } from "@/app/actions/ratings/ratings-actions"

/**
 * "What customers said" — the first surface for `OtterRating`, a table that was
 * being written and read by nothing.
 *
 * Deliberately worst-first and short: a five-star review needs no action, so
 * the section exists to put the handful that do need one in front of the owner
 * alongside the numbers they explain.
 */
export async function RatingsSection() {
  const summary = await getRatingsSummary()

  // Same contract as the invoice-count and labor-glance readers: a failure or
  // a genuinely empty table renders nothing rather than an empty frame.
  if (!summary || summary.count === 0) return null

  const avg = summary.average
  const delta = summary.deltaVsPrior

  return (
    <div className="dock-in dock-in-4">
      <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-(--hairline) pb-3">
        <span className="editorial-section-label">
          What customers said
          {summary.stale ? "" : ` · last ${summary.windowDays} days`}
        </span>
        <div className="h-px flex-1 border-t border-dotted border-(--hairline-bold)" />
        {summary.stale && summary.latestReviewAt ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-(--ink-muted)">
            No reviews in {summary.windowDays}d · newest{" "}
            {summary.latestReviewAt.toISOString().slice(0, 10)}
          </span>
        ) : null}
      </div>

      <section className="inv-panel inv-panel--flush">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3 border-b border-(--hairline) px-5 py-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-muted)">
              Average
            </div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="text-[32px] leading-none font-semibold tabular-nums">
                {avg != null ? avg.toFixed(2) : "—"}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--ink-muted)">
                of 5
              </span>
              {summary.stale ? null : delta != null && Math.abs(delta) >= 0.05 ? (
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.14em] tabular-nums"
                  style={{
                    color: delta < 0 ? "var(--accent)" : "var(--ink-muted)",
                  }}
                >
                  {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(2)} vs prior{" "}
                  {summary.windowDays}d
                </span>
              ) : null}
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-muted)">
              Reviews
            </div>
            <div className="mt-0.5 text-[32px] leading-none font-semibold tabular-nums">
              {summary.count}
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-muted)">
              1–2 star
            </div>
            <div
              className="mt-0.5 text-[32px] leading-none font-semibold tabular-nums"
              style={{
                color: summary.lowCount > 0 ? "var(--accent)" : "var(--ink)",
              }}
            >
              {summary.lowCount}
            </div>
          </div>

          <div className="ml-auto flex items-end gap-1" aria-hidden>
            {summary.distribution.map((n, i) => {
              const max = Math.max(...summary.distribution, 1)
              return (
                <div key={i} className="flex w-6 flex-col items-center gap-1">
                  <div
                    className="w-full bg-(--ink)"
                    style={{ height: `${Math.max(2, (n / max) * 44)}px` }}
                  />
                  <span className="font-mono text-[9px] text-(--ink-muted)">
                    {i + 1}
                  </span>
                </div>
              )
            })}
          </div>
          <span className="sr-only">
            Rating distribution:{" "}
            {summary.distribution
              .map((n, i) => `${n} at ${i + 1} star${n === 1 ? "" : "s"}`)
              .join(", ")}
          </span>
        </div>

        <ul>
          {summary.recent.map((r) => (
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
                </span>
                <span className="ml-auto font-mono text-[10px] tabular-nums text-(--ink-muted)">
                  {r.reviewedAt.toISOString().slice(0, 10)}
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
      </section>
    </div>
  )
}
