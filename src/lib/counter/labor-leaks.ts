import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { toQueryBounds, type DateRange } from "@/lib/counter/date-range"

/**
 * The leak ledger: Harri's timekeeping alerts turned into a table of where
 * PAID hours went that the published schedule did not ask for.
 *
 * ## The sign is the whole module
 *
 * Harri emits seven alert codes on this store's data, and they are not all
 * the same kind of thing:
 *
 * - `LATE_CLOCK_OUT` and `EARLY_CLOCK_IN` are **leaks** — the employee was on
 *   the clock, and paid, for time the schedule never asked for.
 * - `LATE_CLOCK_IN` and `EARLY_CLOCK_OUT` are the OPPOSITE — the store paid
 *   for LESS time than it scheduled. Counting these as leaks does not just
 *   add noise, it flips the sign on real dollars: over the measured window
 *   (2026-08-20 … 2026-08-26, Hollywood) a sign-blind sum of all four costed
 *   alert codes reports **24.94 leaked hours** where the true leak, leak
 *   codes only, is **13.47 hours** (at the window's blended rate of
 *   $20.42/h, $509 claimed against the true $275).
 * - `MISSED_CLOCK_OUT_OT_NOW`, `MISSED_CLOCK_IN` and `UNSCHEDULED_CLOCK_IN`
 *   carry a null `timeDiffSec` — Harri never recorded a duration for them —
 *   so they cannot be costed at all. They are surfaced as `uncostableAlerts`
 *   so a reader knows what the dollar total does NOT include, not folded
 *   into `$0` (see below).
 *
 * `classifyAlertCode` is the one function that draws these lines, and it is
 * an ALLOW-LIST for the two costed kinds — `"leak"` and `"saving"` are each
 * named explicitly, and everything else, unconditionally, is `"uncostable"`.
 * That is deliberate: Harri can add an alert type any day, and a switch that
 * falls through an unrecognised code into the leak branch would silently
 * start counting money leaving the building on a code nobody has looked at.
 * The only way to be added to `"leak"` or `"saving"` is to be named here.
 *
 * ## `null` is not `0`
 *
 * An uncostable row has `hours: null` and `cost: null`, never `0`. Zero is
 * the claim that a missed clock-out cost nothing; the truth is nobody
 * measured what it cost, and those are different sentences.
 *
 * ## `blendedRate` is taken in, never computed here
 *
 * The ledger's cost is `hours * blendedRate`, where `blendedRate` is
 * `LaborWeek.blendedRate` from `src/lib/counter/labor-week.ts`
 * (`cost / actualHours` over the same range). Computing a second rate here —
 * even the same formula, over the same range — would be a second place the
 * page's leak dollars and its labour dollars could drift from each other for
 * no operational reason, the exact defect class `labor-week.ts`'s own module
 * comment describes for its two sales figures.
 *
 * ## Scoping
 *
 * Stores are resolved through `accountId` FIRST, exactly as
 * `loadChannelMix`/`loadServiceProfile`/`loadLaborWeek` do — `storeId: null`
 * has to mean "every active store on this account", not "every store in the
 * database". This module deliberately does not import `@/lib/auth`, for the
 * same reason `channel-mix.ts` and `labor-week.ts` don't: that import pulls
 * in `@/lib/prisma` at MODULE LOAD, which throws without `DATABASE_URL` and
 * takes every importer down with it, tests included. The page already has an
 * `accountId` from its own session lookup.
 */

export type LeakKind = "leak" | "saving" | "uncostable"

export interface LeakRow {
  code: string
  /** "Clocked out late" — the words a manager reads, not the enum. */
  label: string
  kind: LeakKind
  alerts: number
  /** `null` for an uncostable code — NEVER `0`. */
  hours: number | null
  /** `hours * blendedRate`, or `null`. */
  cost: number | null
  people: number
}

export interface LeakLedger {
  rows: LeakRow[]
  /** Leak rows only. */
  leakedHours: number
  leakedCost: number
  /** Alerts on codes with no `timeDiffSec`, so the reader knows what is uncounted. */
  uncostableAlerts: number
}

/**
 * The two costed kinds are an ALLOW-LIST, named explicitly. Anything not in
 * either set — a `MISSED_*`/`UNSCHEDULED_*` code, or a code Harri has not
 * invented yet — falls through to `"uncostable"` by construction, not by
 * accident of switch-statement ordering.
 */
const LEAK_CODES = new Set<string>(["LATE_CLOCK_OUT", "EARLY_CLOCK_IN"])
const SAVING_CODES = new Set<string>(["LATE_CLOCK_IN", "EARLY_CLOCK_OUT"])

export function classifyAlertCode(code: string): LeakKind {
  if (LEAK_CODES.has(code)) return "leak"
  if (SAVING_CODES.has(code)) return "saving"
  return "uncostable"
}

/** The words a manager reads. Known codes are hand-labelled; anything else
 *  (a code Harri adds later) is humanised from the enum rather than shown
 *  blank — its `kind` is always `"uncostable"` via `classifyAlertCode`
 *  regardless of what this function returns for it. */
const LABELS: Record<string, string> = {
  LATE_CLOCK_OUT: "Clocked out late",
  EARLY_CLOCK_IN: "Clocked in early",
  LATE_CLOCK_IN: "Clocked in late",
  EARLY_CLOCK_OUT: "Clocked out early",
  MISSED_CLOCK_OUT_OT_NOW: "Missed clock-out",
  MISSED_CLOCK_IN: "Missed clock-in",
  UNSCHEDULED_CLOCK_IN: "Unscheduled clock-in",
}

function labelFor(code: string): string {
  const known = LABELS[code]
  if (known) return known
  return code
    .toLowerCase()
    .split("_")
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ")
}

interface Bucket {
  alerts: number
  /** Sum of `|timeDiffSec|` across rows that carried one. */
  secs: number
  people: Set<number>
}

/**
 * The ledger, off raw alert rows already scoped to a range and store set.
 *
 * Pulled out as its own pure function — the brief's own assertions (the
 * classify cases, the 13.47h/$275 total, the null contract, the 41-alert
 * uncostable count) are all against this function, never against Prisma.
 */
export function leakLedger(
  rows: Array<{ alertCode: string; timeDiffSec: number | null; userId: number }>,
  blendedRate: number,
): LeakLedger {
  const buckets = new Map<string, Bucket>()

  for (const r of rows) {
    const b = buckets.get(r.alertCode) ?? { alerts: 0, secs: 0, people: new Set<number>() }
    b.alerts += 1
    if (r.timeDiffSec !== null) b.secs += Math.abs(r.timeDiffSec)
    b.people.add(r.userId)
    buckets.set(r.alertCode, b)
  }

  const outRows: LeakRow[] = []
  let leakedHours = 0
  let leakedCost = 0
  let uncostableAlerts = 0

  for (const [code, b] of buckets) {
    const kind = classifyAlertCode(code)
    const costable = kind !== "uncostable"
    const hours = costable ? b.secs / 3600 : null
    const cost = costable ? (hours as number) * blendedRate : null

    if (kind === "uncostable") {
      uncostableAlerts += b.alerts
    } else if (kind === "leak") {
      leakedHours += hours as number
      leakedCost += cost as number
    }

    outRows.push({
      code,
      label: labelFor(code),
      kind,
      alerts: b.alerts,
      hours,
      cost,
      people: b.people.size,
    })
  }

  return { rows: outRows, leakedHours, leakedCost, uncostableAlerts }
}

/**
 * The range's leak ledger, queried.
 *
 * ONE query against `HarriTimekeepingAlert` answers the whole ledger — every
 * alert in range, for the account's active stores, folded by
 * `leakLedger` above.
 */
export async function loadLeakLedger(input: {
  range: DateRange
  storeId: string | null
  accountId: string
  blendedRate: number
}): Promise<LeakLedger> {
  const { range, storeId, accountId, blendedRate } = input
  const { startDate, endDate } = toQueryBounds(range)

  const stores = await getScopedStores(accountId, storeId ?? null)
  // A storeId that is not on this account resolves to no stores, not to the
  // whole account (same rule as `loadChannelMix`/`loadServiceProfile`/
  // `loadLaborWeek`).
  if (stores.length === 0) {
    return { rows: [], leakedHours: 0, leakedCost: 0, uncostableAlerts: 0 }
  }
  const storeIds = stores.map((s) => s.id)

  const alerts = await prisma.harriTimekeepingAlert.findMany({
    where: { storeId: { in: storeIds }, date: { gte: startDate, lte: endDate } },
    select: { alertCode: true, timeDiffSec: true, userId: true },
  })

  return leakLedger(alerts, blendedRate)
}
