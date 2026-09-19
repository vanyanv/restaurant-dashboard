import { z } from "zod"
import {
  resolveStoreIds,
  storeIdsSchema,
  ymd,
} from "./_shared"
import type { ChatTool } from "./types"

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

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 3, WATCH: 2, INFO: 1 }

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

    const rows = await ctx.prisma.alert.findMany({
      where: {
        storeId: { in: storeIds },
        occurredOn: { gte: since },
        ...(status === "any" ? {} : { status }),
        ...(args.target ? { target: args.target } : {}),
      },
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
      orderBy: [{ occurredOn: "desc" }, { detectedAt: "desc" }],
    })

    const matching = rows.filter(
      (r) => SEVERITY_RANK[r.severity] >= minRank,
    )

    const counts = {
      critical: matching.filter((r) => r.severity === "CRITICAL").length,
      watch: matching.filter((r) => r.severity === "WATCH").length,
      info: matching.filter((r) => r.severity === "INFO").length,
      total: matching.length,
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
    const askedRank = minRank || SEVERITY_RANK.INFO
    const mutedByPreference = relevant.some(
      (p) => p.muted || SEVERITY_RANK[p.minSeverity] > askedRank,
    )

    const limit = args.limit ?? 25
    const alerts = [...matching]
      .sort(
        (a, b) =>
          SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
          b.occurredOn.getTime() - a.occurredOn.getTime(),
      )
      .slice(0, limit)
      .map((r) => ({
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
