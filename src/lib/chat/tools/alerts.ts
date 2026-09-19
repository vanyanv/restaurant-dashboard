import { z } from "zod"
import {
  resolveStoreIds,
  storeIdsSchema,
  ymd,
} from "./_shared"
import type { $Enums } from "@/generated/prisma/client"
import type { ChatTool } from "./types"

type AlertSeverity = $Enums.AlertSeverity

/**
 * The alert inbox, as the assistant can read it.
 *
 * `getOpenAnomalies` already exposes the z-score detector, but the detector is
 * one of five sources that write an `Alert` (`ANOMALY_EVENT`, `PRICE_DELTA`,
 * `HARRI_VARIANCE`, `QUANTITY_SPIKE`, `NEW_PRODUCT`). Asking the assistant
 * "what needs my attention?" reached only the first, so a price hike or a
 * labour variance sitting at the top of the owner's inbox was invisible to the
 * one surface they asked in prose. This reads the inbox itself.
 *
 * Read-only on purpose. Acknowledging or dismissing an alert is a decision
 * with a record attached, and the chat does not take those; it reports.
 */
const params = z
  .object({
    storeIds: storeIdsSchema,
    status: z
      .enum(["OPEN", "ACKNOWLEDGED", "DISMISSED", "EXPLAINED", "any"])
      .optional()
      .default("OPEN")
      .describe(
        "Alert lifecycle state. 'OPEN' is the default and is what 'what needs attention' means. 'any' returns every state.",
      ),
    severity: z
      .enum(["INFO", "WATCH", "CRITICAL"])
      .optional()
      .describe(
        "Minimum severity to return. Omit for all three. 'CRITICAL' alone is the 'what is on fire' question.",
      ),
    target: z
      .enum([
        "REVENUE",
        "MENU_ITEM",
        "INGREDIENT",
        "LABOR",
        "REFUNDS",
        "PRICE",
        "PRODUCT",
      ])
      .optional()
      .describe("Restrict to alerts about one subject. Omit for all."),
    sinceDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .default(30)
      .describe("Only alerts whose business date falls in the last N days."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(25)
      .describe("Maximum alerts to return, most severe and most recent first."),
  })
  .strict()

export type AlertChatRow = {
  source: string
  target: string
  /** Menu-item sku, ingredient id or vendor id. Null for store-wide signals. */
  targetId: string | null
  severity: string
  status: string
  title: string
  body: string | null
  /** The owner's own written explanation, when they have recorded one. */
  explanation: string | null
  occurredOn: string
  storeName: string
}

export type AlertsChatResult = {
  alerts: AlertChatRow[]
  /** Counts across the whole matching set, not just the returned page. */
  counts: { critical: number; watch: number; info: number; total: number }
  /**
   * True when the account has muted this kind of alert, or raised its floor
   * above what was asked for. An empty inbox because nothing happened and an
   * empty inbox because delivery is muted are different answers, and the
   * assistant has to be able to tell them apart.
   */
  mutedByPreference: boolean
}

/**
 * Ordered, and total over the enum by construction.
 *
 * It was a `Record<string, number>` over three literals, so a fourth
 * `AlertSeverity` would have made every lookup `undefined`, and
 * `undefined >= minRank` is `false` -- the new severity would have vanished
 * from the list AND from the counts with nothing raised. An alert severity
 * added precisely because it matters, silently dropped.
 *
 * `satisfies Record<AlertSeverity, number>` makes that a compile error, and
 * `rankOf` handles a value from an older row that no longer maps: it ranks
 * lowest rather than nowhere, so it is still counted and still returned when
 * no floor was asked for.
 */
const SEVERITY_RANK = {
  CRITICAL: 3,
  WATCH: 2,
  INFO: 1,
} as const satisfies Record<AlertSeverity, number>

const LOWEST_RANK = 1

function rankOf(severity: string): number {
  return SEVERITY_RANK[severity as AlertSeverity] ?? LOWEST_RANK
}

/** The severities at or above a floor, so the floor can go into the query. */
function atOrAbove(floor: AlertSeverity): AlertSeverity[] {
  const min = SEVERITY_RANK[floor]
  return (Object.keys(SEVERITY_RANK) as AlertSeverity[]).filter(
    (s) => SEVERITY_RANK[s] >= min,
  )
}

export const getAlerts: ChatTool<typeof params, AlertsChatResult> = {
  name: "getAlerts",
  description:
    "Returns the alert inbox: everything the detectors have raised that the owner has not dealt with. Covers all five sources (anomaly events, ingredient price deltas, labour variance against Harri, quantity spikes, new products on an invoice), which is wider than getOpenAnomalies. Use for 'what needs my attention?', 'anything wrong?', 'what's critical?', 'have there been any price alerts?'. Also reports whether alert delivery is muted by the account's preferences, so an empty inbox can be explained.",
  parameters: params,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const sinceDays = args.sinceDays ?? 30
    /*
     * `occurredOn` is `@db.Date`, so every row sits at UTC midnight. A cutoff
     * carrying the current time of day therefore excludes the day exactly
     * `sinceDays` back, and "the last 30 days" quietly returns 29.
     */
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
    since.setUTCHours(0, 0, 0, 0)
    const status = args.status ?? "OPEN"
    const minRank = args.severity ? SEVERITY_RANK[args.severity] : 0

    const where = {
      storeId: { in: storeIds },
      occurredOn: { gte: since },
      ...(status === "any" ? {} : { status }),
      ...(args.target ? { target: args.target } : {}),
      ...(args.severity ? { severity: { in: atOrAbove(args.severity) } } : {}),
    }

    /*
     * Counts by aggregate, rows by page.
     *
     * `counts` has to describe the WHOLE matching set -- "3 critical" is the
     * headline and a count of the first 25 rows is not it -- but reading
     * every row to get there meant `status: "any"` with `sinceDays: 365`
     * across every store pulled a year of every detector's output into memory
     * to return 25. `groupBy` does the counting in Postgres.
     */
    const [tallies, rows] = await Promise.all([
      ctx.prisma.alert.groupBy({ by: ["severity"], where, _count: { _all: true } }),
      ctx.prisma.alert.findMany({
        where,
        select: {
          source: true,
          target: true,
          targetId: true,
          severity: true,
          status: true,
          title: true,
          body: true,
          explanation: true,
          occurredOn: true,
          store: { select: { name: true } },
        },
        // Severity first, so the cap keeps what matters rather than what is
        // most recent. Postgres sorts the enum in declaration order, which is
        // INFO, WATCH, CRITICAL -- hence `desc`.
        orderBy: [{ severity: "desc" }, { occurredOn: "desc" }, { detectedAt: "desc" }],
        take: Math.max(args.limit ?? 25, 1),
      }),
    ])

    const tally = (s: AlertSeverity) =>
      tallies.find((t) => t.severity === s)?._count._all ?? 0
    const counts = {
      critical: tally("CRITICAL"),
      watch: tally("WATCH"),
      info: tally("INFO"),
      total: tallies.reduce((n, t) => n + t._count._all, 0),
    }

    /*
     * Preferences are account-owned, not store-owned, so they are the one
     * query here that filters on `accountId` directly rather than reaching it
     * through `store`. A row with a null `storeId` is the account-wide
     * default; a row with one overrides it for that store.
     */
    const prefs = await ctx.prisma.alertPreference.findMany({
      where: {
        accountId: ctx.accountId,
        OR: [{ storeId: null }, { storeId: { in: storeIds } }],
      },
      select: { muted: true, minSeverity: true, storeId: true, target: true },
    })
    /*
     * A preference row with a null `target` is the account-wide default and
     * applies to every subject; one with a target applies only to that
     * subject. Filtering `target` in the query would drop the default, which
     * is the row most likely to be the reason the inbox looks empty.
     */
    const relevant = args.target
      ? prefs.filter((p) => p.target == null || p.target === args.target)
      : prefs
    const askedRank = minRank || LOWEST_RANK
    const mutedByPreference = relevant.some(
      (p) => p.muted || rankOf(p.minSeverity) > askedRank,
    )

    const alerts = rows.map((r) => ({
        source: r.source,
        target: r.target,
        targetId: r.targetId,
        severity: r.severity,
        status: r.status,
        title: r.title,
        body: r.body,
        explanation: r.explanation,
      occurredOn: ymd(r.occurredOn),
      storeName: r.store.name,
    }))

    return { alerts, counts, mutedByPreference }
  },
}
