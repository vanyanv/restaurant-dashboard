import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { fetchInvoiceSummary, type OtterPromise } from "./data"

const SYNC_OVERDUE_HOURS = 3

/**
 * The masthead's attention queue — everything on the page that actually wants
 * the owner's action, promoted from footnotes to the top strip. Red is spent
 * here and only here when something needs a human; the quiet state is ink.
 */
export async function DispatchesStrip({
  otterPromise,
}: {
  otterPromise: OtterPromise
}) {
  const [otter, invoices] = await Promise.all([
    otterPromise,
    fetchInvoiceSummary(),
  ])

  const reviewCount = invoices?.pendingReviewCount ?? 0
  const lastSyncAt = otter?.lastSyncAt ? new Date(otter.lastSyncAt) : null
  const asOf = lastSyncAt
    ? lastSyncAt.toLocaleTimeString("en-US", {
        timeZone: "America/Los_Angeles",
        hour: "numeric",
        minute: "2-digit",
      })
    : null
  const syncOverdue =
    lastSyncAt != null &&
    Date.now() - lastSyncAt.getTime() > SYNC_OVERDUE_HOURS * 3600_000

  const divider = (
    <span
      className="inline-block h-[3px] w-[3px] rotate-45 bg-[var(--ink-faint)]"
      aria-hidden="true"
    />
  )

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-(--ink-muted)">
      <span className="text-(--ink-faint)">Dispatch</span>
      {divider}
      {reviewCount > 0 ? (
        <Link
          href="/dashboard/invoices"
          className="group inline-flex items-center gap-1 text-(--accent) transition-colors hover:text-(--accent-dark)"
        >
          {reviewCount} invoice{reviewCount === 1 ? "" : "s"} need
          {reviewCount === 1 ? "s" : ""} review
          <ArrowUpRight className="h-3 w-3 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
        </Link>
      ) : (
        <span>nothing needs review</span>
      )}
      {asOf ? (
        <>
          {divider}
          <span
            suppressHydrationWarning
            className={syncOverdue ? "text-(--accent)" : undefined}
          >
            figures as of {asOf}
            {syncOverdue ? " · sync overdue" : ""}
          </span>
        </>
      ) : null}
    </div>
  )
}
