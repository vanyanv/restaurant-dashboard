"use server"

// F21 — Server actions backing the /dashboard/alerts inbox.
//   listAlerts        — paginated read (filters by status + store)
//   acknowledgeAlert  — mark a row ACKNOWLEDGED (or EXPLAINED w/ note)
//   dismissAlert      — mark a row DISMISSED (intentional ignore)
//
// All actions are account-scoped — a caller can only touch alerts whose
// storeId is in their account.

import { prisma } from "@/lib/prisma"
import { getCachedSession, resolveStoreContext } from "@/app/actions/forecasts/_shared"

export type AlertSeverityT = "INFO" | "WATCH" | "CRITICAL"
export type AlertStatusT = "OPEN" | "ACKNOWLEDGED" | "DISMISSED" | "EXPLAINED"
export type AlertTargetT =
  | "REVENUE"
  | "MENU_ITEM"
  | "INGREDIENT"
  | "LABOR"
  | "REFUNDS"
  | "PRICE"
  | "PRODUCT"
export type AlertSourceT =
  | "ANOMALY_EVENT"
  | "PRICE_DELTA"
  | "HARRI_VARIANCE"
  | "QUANTITY_SPIKE"
  | "NEW_PRODUCT"

export interface AlertRow {
  id: string
  storeId: string
  /** Populated when the caller is aggregating across multiple stores. */
  storeName?: string
  source: AlertSourceT
  target: AlertTargetT
  targetId: string | null
  severity: AlertSeverityT
  title: string
  body: string | null
  metadata: Record<string, unknown> | null
  occurredOn: Date
  detectedAt: Date
  status: AlertStatusT
  acknowledgedAt: Date | null
  explanation: string | null
}

export interface ListAlertsData {
  storeId: string | null
  storeName: string
  alerts: AlertRow[]
}

export type ListAlertsResult =
  | { ok: true; data: ListAlertsData }
  | { ok: false; error: "store_not_in_account" }

export async function listAlerts(input: {
  storeId?: string
  /** Defaults to ["OPEN"]. Pass empty array to fetch everything. */
  statuses?: AlertStatusT[]
  /** Defaults to all severities. */
  minSeverity?: AlertSeverityT
  limit?: number
}): Promise<ListAlertsResult | null> {
  const session = await getCachedSession()
  const user = session?.user ?? null
  if (!user) return null

  const resolved = await resolveStoreContext(input.storeId, user.accountId)
  if (!resolved.ok) return resolved
  const { storeIds, storeName, storeIdOut, storeNameById } = resolved.ctx

  const statuses = input.statuses ?? ["OPEN"]
  const severityFilter: { in: AlertSeverityT[] } | undefined =
    input.minSeverity === "CRITICAL"
      ? { in: ["CRITICAL"] }
      : input.minSeverity === "WATCH"
        ? { in: ["WATCH", "CRITICAL"] }
        : undefined

  const rows = await prisma.alert.findMany({
    where: {
      storeId: { in: storeIds },
      ...(statuses.length > 0 ? { status: { in: statuses } } : {}),
      ...(severityFilter ? { severity: severityFilter } : {}),
    },
    orderBy: [{ occurredOn: "desc" }, { detectedAt: "desc" }],
    take: input.limit ?? 50,
  })

  const isAggregate = storeIds.length > 1
  return {
    ok: true,
    data: {
      storeId: storeIdOut,
      storeName,
      alerts: rows.map((r) => ({
        id: r.id,
        storeId: r.storeId,
        ...(isAggregate && storeNameById.has(r.storeId)
          ? { storeName: storeNameById.get(r.storeId)! }
          : {}),
        source: r.source as AlertSourceT,
        target: r.target as AlertTargetT,
        targetId: r.targetId,
        severity: r.severity as AlertSeverityT,
        title: r.title,
        body: r.body,
        metadata: (r.metadata ?? null) as Record<string, unknown> | null,
        occurredOn: r.occurredOn,
        detectedAt: r.detectedAt,
        status: r.status as AlertStatusT,
        acknowledgedAt: r.acknowledgedAt,
        explanation: r.explanation,
      })),
    },
  }
}

export type UpdateAlertResult =
  | { ok: true }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "not_in_account" }

async function assertAlertInAccount(alertId: string, accountId: string) {
  const alert = await prisma.alert.findUnique({
    where: { id: alertId },
    select: { id: true, store: { select: { accountId: true } } },
  })
  if (!alert) return { ok: false as const, error: "not_found" as const }
  if (alert.store.accountId !== accountId) {
    return { ok: false as const, error: "not_in_account" as const }
  }
  return { ok: true as const }
}

export async function acknowledgeAlert(input: {
  alertId: string
  explanation?: string | null
}): Promise<UpdateAlertResult | null> {
  const session = await getCachedSession()
  const user = session?.user ?? null
  if (!user) return null

  const guard = await assertAlertInAccount(input.alertId, user.accountId)
  if (!guard.ok) return guard

  await prisma.alert.update({
    where: { id: input.alertId },
    data: {
      status: input.explanation ? "EXPLAINED" : "ACKNOWLEDGED",
      explanation: input.explanation ?? null,
      acknowledgedAt: new Date(),
    },
  })
  return { ok: true }
}

export async function dismissAlert(input: {
  alertId: string
}): Promise<UpdateAlertResult | null> {
  const session = await getCachedSession()
  const user = session?.user ?? null
  if (!user) return null

  const guard = await assertAlertInAccount(input.alertId, user.accountId)
  if (!guard.ok) return guard

  await prisma.alert.update({
    where: { id: input.alertId },
    data: { status: "DISMISSED", acknowledgedAt: new Date() },
  })
  return { ok: true }
}
