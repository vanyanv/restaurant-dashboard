"use server"

import { prisma } from "@/lib/prisma"
import { requireAuthScope } from "@/lib/auth-scope"

export interface AccuracyRow {
  target: "REVENUE" | "MENU_ITEM" | "BUSY_HOURS"
  storeId: string
  storeName: string
  wape: number | null
  baselineWape: number | null
  enrichedWape: number | null
  intervalCoverage80: number | null
  /** Calibration verdict: green inside [0.78, 0.82], yellow inside [0.75, 0.85], red outside. */
  coverageVerdict: "green" | "yellow" | "red" | "unknown"
}

export interface ReconciliationRow {
  storeId: string
  storeName: string
  preMedian: number | null
  prePctP95: number | null
  postMedian: number | null
  postP95: number | null
  /** Trailing 14 days of post-median for the sparkline. */
  spark: { date: string; value: number | null }[]
  /** Threshold flag: red when post-median > 15%. */
  exceedsThreshold: boolean
}

export async function getAccuracyTable(): Promise<AccuracyRow[]> {
  const { accountId } = await requireAuthScope()
  // Latest MlForecastEvaluation per (storeId, target).
  const rows = await prisma.$queryRaw<
    {
      target: "REVENUE" | "MENU_ITEM" | "BUSY_HOURS"
      storeId: string
      storeName: string
      wape: number | null
      baselineWape: number | null
      enrichedWape: number | null
      intervalCoverage80: number | null
    }[]
  >`
    SELECT DISTINCT ON (e."storeId", e.target)
           e.target,
           e."storeId",
           s.name AS "storeName",
           e.wape,
           e."baselineWape",
           e."enrichedWape",
           e."intervalCoverage80"
    FROM "MlForecastEvaluation" e
    JOIN "Store" s ON s.id = e."storeId"
    WHERE s."isActive" = true
      AND s."accountId" = ${accountId}
    ORDER BY e."storeId", e.target, e."computedAt" DESC
  `

  return rows.map((r) => ({
    ...r,
    coverageVerdict: classifyCoverage(r.intervalCoverage80),
  }))
}

function classifyCoverage(c: number | null): AccuracyRow["coverageVerdict"] {
  if (c == null) return "unknown"
  if (c >= 0.78 && c <= 0.82) return "green"
  if (c >= 0.75 && c <= 0.85) return "yellow"
  return "red"
}

export async function getReconciliationTable(): Promise<ReconciliationRow[]> {
  const { accountId } = await requireAuthScope()
  const today = new Date()
  const fourteenDaysAgo = new Date(today)
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)
  const rows = await prisma.mlReconciliationDaily.findMany({
    where: { date: { gte: fourteenDaysAgo }, store: { accountId } },
    orderBy: [{ storeId: "asc" }, { date: "asc" }],
    include: { store: { select: { id: true, name: true } } },
  })

  const byStore = new Map<string, typeof rows>()
  for (const r of rows) {
    const k = r.storeId
    if (!byStore.has(k)) byStore.set(k, [])
    byStore.get(k)!.push(r)
  }

  return Array.from(byStore.entries()).map(([storeId, series]) => {
    const latest = series[series.length - 1]
    return {
      storeId,
      storeName: latest.store.name,
      preMedian: latest.prePctDiscrepancyMedian,
      prePctP95: latest.prePctDiscrepancyP95,
      postMedian: latest.postPctDiscrepancyMedian,
      postP95: latest.postPctDiscrepancyP95,
      spark: series.map((s) => ({
        date: s.date.toISOString().slice(0, 10),
        value: s.postPctDiscrepancyMedian,
      })),
      exceedsThreshold: (latest.postPctDiscrepancyMedian ?? 0) > 0.15,
    }
  })
}
