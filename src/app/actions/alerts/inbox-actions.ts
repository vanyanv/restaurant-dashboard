"use server"

import { revalidatePath } from "next/cache"
import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getAccountStoreRows } from "@/lib/account-stores"
import { anomalyHorizon } from "@/lib/anomaly-window"
import { bustTags } from "@/lib/cache/cached"
import { alertsCacheTag } from "@/lib/alerts/cache-tag"
import type {
  AlertSeverity,
  AlertSource,
  AlertStatus,
  AlertTarget,
} from "@/generated/prisma/client"

/**
 * Read/act layer for the alert inbox.
 *
 * The `Alert` table has been ingested on a schedule since F21 shipped — five
 * sources, severities, dedupe keys, per-store routing — with no interface of
 * any kind. Meanwhile the two noisiest surfaces in the product were a
 * fifty-row "alerts" list on Product Usage (mostly first-time purchases) and a
 * permanently-growing open-anomaly count on Decisions. This is the inbox those
 * two were missing.
 */

export interface InboxAlert {
  id: string
  storeId: string
  storeName: string
  source: AlertSource
  target: AlertTarget
  targetId: string | null
  severity: AlertSeverity
  status: AlertStatus
  title: string
  body: string | null
  occurredOn: Date
  detectedAt: Date
  /**
   * When the alert was closed — set by `acknowledgeAlert` AND by
   * `dismissAlert`, which is exactly why it is not an "acknowledged" signal.
   * Measured 2026-08-26: ten rows carry one and all ten are DISMISSED. Read
   * it for HOW LONG something took to close, never for WHETHER it was
   * acknowledged (ruling N-R2 — `status` is the only source for that).
   */
  acknowledgedAt: Date | null
  explanation: string | null
}

export interface AlertInboxData {
  alerts: InboxAlert[]
  counts: {
    open: number
    critical: number
    watch: number
    info: number
    /**
     * `status = ACKNOWLEDGED`, and nothing else. Today it is 0.
     *
     * NOT a count of rows with an `acknowledgedAt` — see that field. Sourcing
     * it there would report ten dismissals as ten acknowledgements, which is
     * the single most dangerous line on the inbox page.
     */
    acknowledged: number
    /** `status = DISMISSED`. */
    dismissed: number
  }
  /**
   * Every source's row count within the same store scope and horizon, ALL
   * STATUSES — including the four that have never fired. The inbox renders
   * one toggle per source carrying this number (ruling N-R1), so a zero here
   * is rendered as `0` rather than as an absent toggle.
   */
  bySource: Record<AlertSource, number>
  /**
   * The account's mute rules (`AlertPreference.muted = true`), narrowed to
   * what routing needs. Zero rows on the live database.
   *
   * The RULES, not a count of them, because the inbox's "Muted" segment has to
   * show which alerts a rule suppresses — and a count could only ever produce
   * a hard-coded empty list, which is a guess dressed as a measurement.
   */
  muteRules: Array<{ storeId: string | null; target: AlertTarget | null }>
  /** Distinct stores in scope, for the filter rail. */
  stores: Array<{ id: string; name: string }>
}

export type AlertInboxResult =
  | { ok: true; data: AlertInboxData }
  | { ok: false; error: "unauthorized" }

export interface AlertInboxFilters {
  storeId?: string | null
  severity?: AlertSeverity | null
  source?: AlertSource | null
  /** Defaults to open-only; pass true to include resolved history. */
  includeResolved?: boolean
}

const PAGE_SIZE = 100

const ALL_SOURCES: AlertSource[] = [
  "ANOMALY_EVENT",
  "PRICE_DELTA",
  "HARRI_VARIANCE",
  "QUANTITY_SPIKE",
  "NEW_PRODUCT",
  "STORE_CHECK",
]

/** Every source at zero — the shape `bySource` always has, so a source with no
 *  rows is a `0` rather than a missing key the caller has to `?? 0` at every
 *  read site. */
function emptyBySource(): Record<AlertSource, number> {
  return Object.fromEntries(ALL_SOURCES.map((s) => [s, 0])) as Record<AlertSource, number>
}

export async function getAlertInbox(
  filters: AlertInboxFilters = {},
): Promise<AlertInboxResult> {
  const session = await getServerSession(authOptions)
  if (!session?.user || !hasOwnerAccess(session.user.role)) {
    return { ok: false, error: "unauthorized" }
  }
  const accountId = session.user.accountId

  // The one store query a request makes — `@/lib/account-stores` — with this
  // caller's own `isActive` filter applied over it.
  const stores = (await getAccountStoreRows(accountId)).filter((s) => s.isActive)
  const storeName = new Map(stores.map((s) => [s.id, s.name]))
  const scopedStoreIds =
    filters.storeId && storeName.has(filters.storeId)
      ? [filters.storeId]
      : stores.map((s) => s.id)

  if (scopedStoreIds.length === 0) {
    return {
      ok: true,
      data: {
        alerts: [],
        counts: { open: 0, critical: 0, watch: 0, info: 0, acknowledged: 0, dismissed: 0 },
        bySource: emptyBySource(),
        muteRules: [],
        stores,
      },
    }
  }

  // Same relevance horizon the anomaly feed uses — an alert nobody acted on
  // three months ago is history, not an inbox item.
  const where = {
    storeId: { in: scopedStoreIds },
    occurredOn: { gte: anomalyHorizon() },
    ...(filters.includeResolved ? {} : { status: "OPEN" as const }),
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.source ? { source: filters.source } : {}),
  }

  const [rows, tally, muteRules] = await Promise.all([
    prisma.alert.findMany({
      where,
      orderBy: [{ severity: "desc" }, { occurredOn: "desc" }, { detectedAt: "desc" }],
      take: PAGE_SIZE,
      select: {
        id: true,
        storeId: true,
        source: true,
        target: true,
        targetId: true,
        severity: true,
        status: true,
        title: true,
        body: true,
        occurredOn: true,
        detectedAt: true,
        acknowledgedAt: true,
        explanation: true,
      },
    }),
    /*
     * ONE cross-tab, replacing what used to be a severity-only groupBy over
     * OPEN rows. Every count the inbox prints — the three severities, the two
     * closed statuses and the five source tallies — is a projection of this
     * single result, so no figure on the page costs a query of its own and no
     * two of them can be scoped differently by accident.
     *
     * The `status: "OPEN"` filter is GONE from the `where` and moved into the
     * projections below, because `acknowledged` and `dismissed` are questions
     * about the statuses this used to exclude. `countFor` re-applies it, so
     * `counts.critical/watch/info/open` mean exactly what they meant before.
     */
    prisma.alert.groupBy({
      by: ["severity", "status", "source"],
      where: {
        storeId: { in: scopedStoreIds },
        occurredOn: { gte: anomalyHorizon() },
      },
      _count: { _all: true },
    }),
    // The account's hard mutes. Zero rows today; asked for rather than assumed
    // so the inbox's "Muted" segment reports a measurement.
    prisma.alertPreference.findMany({
      where: { accountId, muted: true },
      select: { storeId: true, target: true },
    }),
  ])

  const sum = (pick: (r: (typeof tally)[number]) => boolean) =>
    tally.reduce((n, r) => (pick(r) ? n + r._count._all : n), 0)

  const countFor = (s: AlertSeverity) =>
    sum((r) => r.status === "OPEN" && r.severity === s)

  const bySource = emptyBySource()
  for (const r of tally) bySource[r.source] += r._count._all

  return {
    ok: true,
    data: {
      alerts: rows.map((r) => ({
        ...r,
        storeName: storeName.get(r.storeId) ?? "Unknown store",
      })),
      counts: {
        critical: countFor("CRITICAL"),
        watch: countFor("WATCH"),
        info: countFor("INFO"),
        open: countFor("CRITICAL") + countFor("WATCH") + countFor("INFO"),
        // STATUS, not `acknowledgedAt`. See `InboxAlert.acknowledgedAt`.
        acknowledged: sum((r) => r.status === "ACKNOWLEDGED"),
        dismissed: sum((r) => r.status === "DISMISSED"),
      },
      bySource,
      muteRules,
      stores,
    },
  }
}

export type AlertActionResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "not_found" | "not_in_account" }

async function resolveOwnedAlert(alertId: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user || !hasOwnerAccess(session.user.role)) {
    return { ok: false as const, error: "unauthorized" as const }
  }
  const alert = await prisma.alert.findUnique({
    where: { id: alertId },
    select: { id: true, store: { select: { accountId: true } } },
  })
  if (!alert) return { ok: false as const, error: "not_found" as const }
  if (alert.store.accountId !== session.user.accountId) {
    return { ok: false as const, error: "not_in_account" as const }
  }
  return { ok: true as const }
}

/**
 * Acknowledge ("seen, no action needed") or explain ("here's what it was").
 * Passing an explanation records EXPLAINED, mirroring `acknowledgeAnomaly`.
 */
export async function acknowledgeAlert(input: {
  alertId: string
  explanation?: string
}): Promise<AlertActionResult> {
  const owned = await resolveOwnedAlert(input.alertId)
  if (!owned.ok) return owned

  const explanation = input.explanation?.trim() || null
  await prisma.alert.update({
    where: { id: input.alertId },
    data: {
      status: explanation ? "EXPLAINED" : "ACKNOWLEDGED",
      explanation,
      acknowledgedAt: new Date(),
    },
  })
  revalidatePath("/dashboard/alerts")
  return { ok: true }
}

/** Dismiss without explanation — "not worth tracking". */
export async function dismissAlert(input: {
  alertId: string
}): Promise<AlertActionResult> {
  const owned = await resolveOwnedAlert(input.alertId)
  if (!owned.ok) return owned

  await prisma.alert.update({
    where: { id: input.alertId },
    data: { status: "DISMISSED", acknowledgedAt: new Date() },
  })
  revalidatePath("/dashboard/alerts")
  return { ok: true }
}

/**
 * Open-alert count for the topbar dispatch strip. Never throws — a failure
 * yields null and the caller omits the badge rather than showing a fake zero.
 */
export async function getOpenAlertCount(): Promise<number | null> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || !hasOwnerAccess(session.user.role)) return null
    return await prisma.alert.count({
      where: {
        store: { accountId: session.user.accountId, isActive: true },
        status: "OPEN",
        occurredOn: { gte: anomalyHorizon() },
      },
    })
  } catch (error) {
    console.error("getOpenAlertCount error:", error)
    return null
  }
}

/**
 * What "Clear all" on Needs you clears.
 *
 * `ids` — the desk passes the alerts behind the rows it is showing, so the
 * count in its confirm is exactly what gets cleared. Otherwise the scope is
 * re-derived here (the phone, which draws six rows of a longer list): the
 * store, severity, source and search filters, each optional.
 */
export interface ClearAlertsScope {
  ids?: string[]
  storeId?: string | null
  severities?: AlertSeverity[]
  sources?: AlertSource[]
  search?: string
}

export type ClearAlertsResult =
  | { ok: true; ids: string[]; at: string }
  | { ok: false; error: "unauthorized" }

/**
 * Upper bound on one clear, and on one undo. The inbox is tens of rows today;
 * the cap keeps a forged call from handing either action an unbounded list.
 */
const CLEAR_LIMIT = 1000

/**
 * Close every open alert in scope at once — the owner's "Clear all".
 *
 * Writes ACKNOWLEDGED ("seen"), never DISMISSED: a bulk clear says "I have
 * looked at this list", not "never show me this kind of alert again", and the
 * two verbs are kept apart on purpose (see `@/lib/counter/actions/alert`).
 *
 * Scoped like `getAlertInbox`: the account's ACTIVE stores (one of them when
 * `storeId` belongs to the account), the relevance horizon, OPEN only. Every
 * row gets ONE `acknowledgedAt` stamp, returned as `at` with the ids the
 * write actually changed, and `reopenAlerts` matches on both — so Undo can
 * only reopen what this clear closed, never an acknowledgement someone made
 * in between.
 */
export async function clearOpenAlerts(
  scope: ClearAlertsScope = {},
): Promise<ClearAlertsResult> {
  const session = await getServerSession(authOptions)
  if (!session?.user || !hasOwnerAccess(session.user.role)) {
    return { ok: false, error: "unauthorized" }
  }
  const accountId = session.user.accountId
  const at = new Date()

  const stores = (await getAccountStoreRows(accountId)).filter((s) => s.isActive)
  const storeIds =
    scope.storeId && stores.some((s) => s.id === scope.storeId)
      ? [scope.storeId]
      : stores.map((s) => s.id)
  if (storeIds.length === 0) return { ok: true, ids: [], at: at.toISOString() }

  const search = scope.search?.trim() ?? ""
  const where = {
    storeId: { in: storeIds },
    store: { accountId },
    status: "OPEN" as const,
    occurredOn: { gte: anomalyHorizon(at) },
    ...(scope.ids ? { id: { in: scope.ids.slice(0, CLEAR_LIMIT) } } : {}),
    ...(scope.severities?.length ? { severity: { in: scope.severities } } : {}),
    ...(scope.sources?.length ? { source: { in: scope.sources } } : {}),
    ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}),
  }

  const rows = await prisma.alert.findMany({ where, select: { id: true }, take: CLEAR_LIMIT })
  if (rows.length === 0) return { ok: true, ids: [], at: at.toISOString() }

  // `status: OPEN` again on the write, and the ids RETURNED by the write: a
  // row closed by someone else between the read and here keeps their
  // decision and is left out of what Undo may reopen.
  const changed = await prisma.alert.updateManyAndReturn({
    where: { id: { in: rows.map((r) => r.id) }, store: { accountId }, status: "OPEN" },
    data: { status: "ACKNOWLEDGED", acknowledgedAt: at },
    select: { id: true },
  })
  await afterWrite(accountId)
  return { ok: true, ids: changed.map((r) => r.id), at: at.toISOString() }
}

/**
 * Undo for `clearOpenAlerts`: put back to OPEN the alerts that clear closed.
 *
 * Matches the clear's own stamp (`at`) as well as the ids, and only rows still
 * ACKNOWLEDGED with no explanation — so an alert explained, dismissed or
 * acknowledged by anything else keeps that decision, and an id from another
 * account matches nothing.
 */
export async function reopenAlerts(input: {
  ids: string[]
  at: string
}): Promise<{ ok: true; reopened: number } | { ok: false; error: "unauthorized" | "invalid" }> {
  const session = await getServerSession(authOptions)
  if (!session?.user || !hasOwnerAccess(session.user.role)) {
    return { ok: false, error: "unauthorized" }
  }
  const at = new Date(input.at)
  if (Number.isNaN(at.getTime())) return { ok: false, error: "invalid" }
  const ids = input.ids.slice(0, CLEAR_LIMIT)
  if (ids.length === 0) return { ok: true, reopened: 0 }

  const result = await prisma.alert.updateMany({
    where: {
      id: { in: ids },
      store: { accountId: session.user.accountId },
      status: "ACKNOWLEDGED",
      acknowledgedAt: at,
      explanation: null,
    },
    data: { status: "OPEN", acknowledgedAt: null },
  })
  await afterWrite(session.user.accountId)
  return { ok: true, reopened: result.count }
}

/** Both inbox pages, and the rail's cached count. */
async function afterWrite(accountId: string) {
  revalidatePath("/dashboard/alerts")
  revalidatePath("/m/alerts")
  await bustTags([alertsCacheTag(accountId)])
}
