// F21 — Alert ingestion. Pure functions that translate detector outputs
// (currently F12 AnomalyEvent rows) into Alert rows. Used by:
//   - the alerts-ingest cron POST endpoint (nightly post-step)
//   - one-shot backfill (first-run hydration of existing OPEN AnomalyEvents)
//
// Idempotency: Alert.dedupeKey is a unique constraint, so re-running ingest
// against the same input is safe — duplicates upsert into the existing row
// with `status` and `acknowledgedAt` preserved.

import { prisma } from "@/lib/prisma"
import type { AnomalyEvent, Prisma } from "@/generated/prisma/client"

// Enum types are not re-exported from the generated client; redeclare as
// string-literal unions matching the schema (same convention as anomaly-actions.ts).
export type AlertSource =
  | "ANOMALY_EVENT"
  | "PRICE_DELTA"
  | "HARRI_VARIANCE"
  | "QUANTITY_SPIKE"
  | "NEW_PRODUCT"
export type AlertTarget =
  | "REVENUE"
  | "MENU_ITEM"
  | "INGREDIENT"
  | "LABOR"
  | "REFUNDS"
  | "PRICE"
  | "PRODUCT"
export type AlertSeverity = "INFO" | "WATCH" | "CRITICAL"

interface IngestResult {
  scanned: number
  created: number
  updated: number
}

// |z| → severity. INFO for noise, WATCH for meaningful, CRITICAL for action-now.
function severityFromZScore(z: number | null): AlertSeverity {
  if (z == null || !Number.isFinite(z)) return "INFO"
  const abs = Math.abs(z)
  if (abs >= 4) return "CRITICAL"
  if (abs >= 2.5) return "WATCH"
  return "INFO"
}

function buildDedupeKey(
  source: AlertSource,
  storeId: string,
  target: AlertTarget,
  targetId: string | null,
  occurredOn: Date,
): string {
  const dateKey = occurredOn.toISOString().slice(0, 10)
  return `${source}:${storeId}:${target}:${targetId ?? "-"}:${dateKey}`
}

// Map AnomalyTarget → AlertTarget. AlertTarget is a strict superset.
function mapAnomalyTarget(t: AnomalyEvent["target"]): AlertTarget {
  return t as AlertTarget
}

function fmtSigned(n: number): string {
  const sign = n > 0 ? "+" : ""
  return `${sign}${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

// Human-readable title. Kept short — long context lives in the inbox row.
function titleFor(ev: AnomalyEvent): string {
  const dir = ev.residual >= 0 ? "above" : "below"
  switch (ev.target) {
    case "REVENUE":
      return `Revenue ${fmtSigned(ev.residual)} ${dir} forecast`
    case "LABOR":
      return `Labor ${fmtSigned(ev.residual)} ${dir} forecast`
    case "REFUNDS":
      return `Refunds ${fmtSigned(ev.residual)} ${dir} forecast`
    case "MENU_ITEM":
      return `Menu-item demand ${fmtSigned(ev.residual)} ${dir} forecast`
    case "INGREDIENT":
      return `Ingredient usage ${fmtSigned(ev.residual)} ${dir} forecast`
    default:
      return `Anomaly ${fmtSigned(ev.residual)}`
  }
}

// Translate a single AnomalyEvent → upsert payload for Alert.
export interface AlertUpsert {
  dedupeKey: string
  storeId: string
  source: AlertSource
  anomalyEventId: string
  target: AlertTarget
  targetId: string | null
  severity: AlertSeverity
  title: string
  body: string | null
  metadata: Prisma.InputJsonValue
  occurredOn: Date
}

function anomalyEventToAlert(ev: AnomalyEvent): AlertUpsert {
  const target = mapAnomalyTarget(ev.target)
  return {
    dedupeKey: buildDedupeKey("ANOMALY_EVENT", ev.storeId, target, ev.targetId, ev.occurredOn),
    storeId: ev.storeId,
    source: "ANOMALY_EVENT",
    anomalyEventId: ev.id,
    target,
    targetId: ev.targetId,
    severity: severityFromZScore(ev.zScore),
    title: titleFor(ev),
    body: null,
    metadata: {
      residual: ev.residual,
      zScore: ev.zScore,
      method: ev.method,
    },
    occurredOn: ev.occurredOn,
  }
}

// Scan recent OPEN AnomalyEvents and upsert Alert rows. `sinceDays` bounds
// the scan so the nightly post-step doesn't rescan the entire history.
export async function ingestFromAnomalyEvents(
  options: { sinceDays?: number; storeIds?: string[] } = {},
): Promise<IngestResult> {
  const sinceDays = options.sinceDays ?? 14
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - sinceDays)

  const events = await prisma.anomalyEvent.findMany({
    where: {
      detectedAt: { gte: cutoff },
      ...(options.storeIds ? { storeId: { in: options.storeIds } } : {}),
    },
    orderBy: { detectedAt: "asc" },
  })

  let created = 0
  let updated = 0

  for (const ev of events) {
    const payload = anomalyEventToAlert(ev)
    const { storeId, ...rest } = payload
    const result = await prisma.alert.upsert({
      where: { dedupeKey: payload.dedupeKey },
      // We don't overwrite status/explanation/acknowledgedAt — those are
      // user-driven and the detector shouldn't undo a triage action. The
      // detection-side fields (severity, title, metadata) can refresh.
      update: {
        severity: payload.severity,
        title: payload.title,
        metadata: payload.metadata,
        anomalyEventId: payload.anomalyEventId,
      },
      create: {
        ...rest,
        store: { connect: { id: storeId } },
      },
      select: { id: true, detectedAt: true },
    })
    // Approximate created vs updated: detectedAt within last 2s of now.
    if (Date.now() - result.detectedAt.getTime() < 2000) {
      created++
    } else {
      updated++
    }
  }

  return { scanned: events.length, created, updated }
}
