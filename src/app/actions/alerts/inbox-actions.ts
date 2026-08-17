"use server"

import { revalidatePath } from "next/cache"
import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { anomalyHorizon } from "@/lib/anomaly-window"
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
  explanation: string | null
}

export interface AlertInboxData {
  alerts: InboxAlert[]
  counts: {
    open: number
    critical: number
    watch: number
    info: number
  }
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

export async function getAlertInbox(
  filters: AlertInboxFilters = {},
): Promise<AlertInboxResult> {
  const session = await getServerSession(authOptions)
  if (!session?.user || !hasOwnerAccess(session.user.role)) {
    return { ok: false, error: "unauthorized" }
  }
  const accountId = session.user.accountId

  const stores = await prisma.store.findMany({
    where: { accountId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
  const storeName = new Map(stores.map((s) => [s.id, s.name]))
  const scopedStoreIds =
    filters.storeId && storeName.has(filters.storeId)
      ? [filters.storeId]
      : stores.map((s) => s.id)

  if (scopedStoreIds.length === 0) {
    return {
      ok: true,
      data: { alerts: [], counts: { open: 0, critical: 0, watch: 0, info: 0 }, stores },
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

  const [rows, bySeverity] = await Promise.all([
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
        explanation: true,
      },
    }),
    prisma.alert.groupBy({
      by: ["severity"],
      where: {
        storeId: { in: scopedStoreIds },
        occurredOn: { gte: anomalyHorizon() },
        status: "OPEN",
      },
      _count: { _all: true },
    }),
  ])

  const countFor = (s: AlertSeverity) =>
    bySeverity.find((r) => r.severity === s)?._count._all ?? 0

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
      },
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
