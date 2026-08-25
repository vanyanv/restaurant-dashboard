import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { getOpenAlertCount } from "@/app/actions/alerts/inbox-actions"
import { fetchInvoiceSummary, type OtterPromise } from "./data"

const SYNC_OVERDUE_HOURS = 3

/**
 * The masthead's dispatch line — a one-line summary of the page beneath it.
 *
 * It used to lead with the invoice-review count, which is now stated twice more
 * further down (in Still moving and in the queue itself). What the top right of
 * a masthead is good for is the shape of the report: how much needs a human,
 * how much is trading, and whether the figures can be trusted at all. Red is
 * spent here and only here when something needs action; the quiet state is ink.
 */
export async function DispatchesStrip({
  otterPromise,
}: {
  otterPromise: OtterPromise
}) {
  const [otter, invoices, openAlerts] = await Promise.all([
    otterPromise,
    fetchInvoiceSummary(),
    getOpenAlertCount().catch(() => null),
  ])

  const reviewCount = invoices?.pendingReviewCount ?? 0
  const needsYou = (openAlerts ?? 0) + (reviewCount > 0 ? 1 : 0)

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
      className="inline-block h-[3px] w-[3px] rotate-45 bg-[var(--ink-ornament)]"
      aria-hidden="true"
    />
  )

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-(--ink-muted)">
      <span className="text-(--ink-faint)">Dispatch</span>
      {divider}
      {needsYou > 0 ? (
        <Link
          href="/dashboard/alerts"
          className="group inline-flex items-center gap-1 text-(--accent) transition-colors hover:text-(--accent-dark)"
        >
          {needsYou} need{needsYou === 1 ? "s" : ""} you
          <ArrowUpRight className="h-3 w-3 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
        </Link>
      ) : (
        <span>nothing needs you</span>
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
