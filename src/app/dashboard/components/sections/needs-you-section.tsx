import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { getAlertInbox } from "@/app/actions/alerts/inbox-actions"
import { getOpportunities } from "@/app/actions/growth/opportunities-actions"
import { buildNeedsYou } from "@/lib/dashboard/needs-you"
import { NeedsYouList } from "../needs-you-list"

/**
 * The overview's attention queue: open alerts and the latest growth
 * opportunities, merged and ranked by `buildNeedsYou` (exception-first, then
 * money). Both readers are already tenant-scoped and both fail soft — a dead
 * alert table must not take the daily report down with it.
 */

/** What the alert pipeline actually watches. Named, so the clean-day state can
 *  say what was checked rather than claiming a number nobody can verify. */
const WATCHED = [
  "Anomalies",
  "Price moves",
  "Labor variance",
  "Quantity spikes",
  "New products",
] as const

export async function NeedsYouSection() {
  const [inbox, growth] = await Promise.all([
    getAlertInbox().catch(() => null),
    getOpportunities({}).catch(() => null),
  ])

  const alerts =
    inbox && inbox.ok
      ? inbox.data.alerts.map((a) => ({
          id: a.id,
          severity: a.severity,
          source: a.source,
          title: a.title,
          body: a.body,
          detectedAt: a.detectedAt,
        }))
      : []

  const opportunities = growth?.ok ? growth.opportunities : []

  // Nothing to read at all — a broken reader is not the same as a clean day, so
  // render nothing rather than claiming everything is fine.
  if (!inbox && !growth) return null

  const { items, hiddenCount } = buildNeedsYou({ alerts, opportunities })

  return (
    <div className="dock-in dock-in-5">
      {items.length > 0 ? (
        <NeedsYouList items={items} hiddenCount={hiddenCount} />
      ) : (
        <>
          <div className="mb-0 flex items-center gap-3 border-b border-[var(--hairline-bold)] pb-3">
            <span className="editorial-section-label">What needs you</span>
            <div className="h-px flex-1 border-t border-dotted border-[var(--hairline-bold)]" />
            <Link
              href="/dashboard/alerts"
              className="group inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-(--ink-muted) transition-colors hover:text-(--accent)"
            >
              All alerts
              <ArrowUpRight className="h-3 w-3 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
            </Link>
          </div>
          <div className="needs-empty">
            <p className="needs-empty__head">
              Nothing needs you. Every watch came back clean.
            </p>
            <div className="needs-empty__checks">
              {WATCHED.map((w) => (
                <span key={w} className="needs-empty__check">
                  {w}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
