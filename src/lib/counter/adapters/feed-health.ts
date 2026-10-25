import { prisma } from "@/lib/prisma"
import { cached } from "@/lib/cache/cached"

/**
 * What feeds the figures on this page, and how fresh each one is.
 *
 * ## Why an Overview carries this at all
 *
 * Every number above it is a quotient of two syncs that run on different
 * schedules, and when one of them stops the page does not go blank — it goes
 * SUBTLY WRONG. Sales per labor hour disappears while net sales stays. Prime
 * cost drops its labour half. An owner looking at that has no way, from the
 * figures alone, to tell "the restaurant did less" from "the rows have not
 * been pulled", and the second is the one that has actually been true on this
 * database since the crons were disabled.
 *
 * The topbar's sync chip answers the same question for ONE feed (Otter's
 * metrics run — see `shell-status.ts`). This answers it for all of them, in
 * the order they matter to the figures above, and it is the honest replacement
 * for a section that shows a figure nobody can source.
 *
 * ## What a reading is, and what it is not
 *
 * A `JobRun` row per feed, newest first: when it last completed and whether it
 * completed. That is a fact about the PIPELINE, not about the data — a sync
 * that ran an hour ago and found nothing still reads "synced an hour ago",
 * because it did. What it deliberately does NOT do is guess: a feed with no
 * `JobRun` at all reads "no run recorded" rather than "never synced", since
 * this table is retained on a window and an old success can age out of it.
 *
 * One query for every feed, grouped in the database rather than one call per
 * source, and cached for a minute alongside the shell's own status — this sits
 * under the fold on a page that already makes a dozen round trips.
 */

/** How long a feed may go unsynced before the line is drawn in the signal colour. */
const STALE_HOURS: Record<string, number> = {
  "otter.metrics.sync": 6,
  "otter.hourly.sync": 6,
  "harri-labor-sync": 8,
  "alerts.ingest": 26,
}

/**
 * The four feeds an Overview figure actually depends on, in the order the
 * figures above them appear: sales, sales by hour, hours and schedule, then
 * the queue.
 *
 * Named in the owner's words, not the job's. `harri-labor-sync` is "hours and
 * schedule" because that is what it puts on the screen; which vendor's API it
 * came from is our problem.
 */
const FEEDS: Array<{ job: string; label: string; note: string }> = [
  { job: "otter.metrics.sync", label: "Sales, orders and channels", note: "every 4 hours" },
  { job: "otter.hourly.sync", label: "Sales by hour", note: "every 4 hours" },
  { job: "harri-labor-sync", label: "Hours worked and the schedule", note: "every 4 hours" },
  { job: "alerts.ingest", label: "What needs you", note: "nightly" },
]

export interface FeedLine {
  key: string
  label: string
  /** "synced 3h ago", "last run failed", "no run recorded". */
  reading: string
  /** `ok` is fresh, `warn` is stale or failed, `off` is a feed that has never run here. */
  tone: "ok" | "warn" | "off"
}

/** "12 min ago", "3h ago", "2 days ago". Short, because it sits in a right-aligned column. */
function ago(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 60) return `${min} min ago`
  const hours = Math.round(min / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)} days ago`
}

export async function getFeedHealth(
  scope: { accountId: string; storeIds: string[] },
  now = new Date(),
): Promise<FeedLine[]> {
  const { accountId, storeIds } = scope

  // Dates do not survive the cache (see the Counter cache notes), so the
  // fold travels as ISO strings and is revived below.
  const rows = await cached<Array<{ jobName: string; at: string; status: string }>>(
    `counter:feed-health:${accountId}`,
    60,
    [],
    async () => {
      const runs = await prisma.jobRun.findMany({
        where: {
          jobName: { in: FEEDS.map((f) => f.job) },
          // A platform-wide run carries no store and counts for everyone; a
          // store-scoped one must be this account's. Same rule as
          // `shell-status.ts`, for the same tenancy reason.
          OR: [{ storeId: null }, { storeId: { in: storeIds } }],
        },
        orderBy: { startedAt: "desc" },
        select: { jobName: true, startedAt: true, completedAt: true, status: true },
      })
      const newest = new Map<string, { at: string; status: string }>()
      for (const r of runs) {
        // `findMany` is ordered newest-first, so the FIRST row per job wins
        // and the rest are that job's history.
        if (newest.has(r.jobName)) continue
        newest.set(r.jobName, {
          at: (r.completedAt ?? r.startedAt).toISOString(),
          status: r.status,
        })
      }
      return FEEDS.filter((f) => newest.has(f.job)).map((f) => ({
        jobName: f.job,
        ...(newest.get(f.job) as { at: string; status: string }),
      }))
    },
  )

  const byJob = new Map(rows.map((r) => [r.jobName, r]))

  return FEEDS.map((f): FeedLine => {
    const row = byJob.get(f.job)
    if (!row) {
      return {
        key: f.job,
        label: f.label,
        reading: "no run recorded",
        tone: "off",
      }
    }
    if (row.status === "RUNNING") {
      return { key: f.job, label: f.label, reading: "syncing now", tone: "ok" }
    }
    if (row.status === "FAILURE") {
      return { key: f.job, label: f.label, reading: "last run failed", tone: "warn" }
    }
    const age = now.getTime() - new Date(row.at).getTime()
    const stale = age / 3_600_000 > (STALE_HOURS[f.job] ?? 6)
    return {
      key: f.job,
      label: f.label,
      reading: `synced ${ago(age)}${stale ? " · overdue" : ` · ${f.note}`}`,
      tone: stale ? "warn" : "ok",
    }
  })
}
