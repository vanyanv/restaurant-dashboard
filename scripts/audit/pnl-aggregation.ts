// P&L aggregation audit.
//
// Three checks:
//   1. cogs_kpis_vs_raw_sum  — getCogsKpis() total vs independent Σ DailyCogsItem
//   2. period_bucket_overlap — buildPeriods() produces any day in 0 or >1 buckets
//   3. cogs_pct_sanity       — monthly cogsPct outside [15%, 65%] for a store,
//                              flagged as data-gap warning
//
// Uses a standard test window of the last 90 days to normalize output.

import { loadEnvLocal, type Finding, classifyDollarDelta, money } from "./lib"

loadEnvLocal()

export async function auditPnlAggregation(): Promise<Finding[]> {
  const { prisma } = await import("../../src/lib/prisma")
  const { getCogsKpis } = await import("../../src/lib/cogs")
  const { buildPeriods } = await import("../../src/lib/pnl")
  const findings: Finding[] = []

  const stores = await prisma.store.findMany({
    where: { isActive: true },
    select: { id: true, name: true, targetCogsPct: true },
  })

  // ── 1. cogs_kpis_vs_raw_sum (90-day) ────────────────────────────
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date(end)
  start.setDate(start.getDate() - 90)
  start.setHours(0, 0, 0, 0)

  for (const store of stores) {
    const [kpis, rawAgg] = await Promise.all([
      getCogsKpis(store.id, start, end),
      prisma.dailyCogsItem.aggregate({
        where: { storeId: store.id, date: { gte: start, lt: end } },
        _sum: { lineCost: true, salesRevenue: true },
      }),
    ])
    const rawCogs = rawAgg._sum.lineCost ?? 0
    const rawRev = rawAgg._sum.salesRevenue ?? 0

    const cogsDelta = Math.abs(kpis.cogsDollars - rawCogs)
    const revDelta = Math.abs(kpis.revenueDollars - rawRev)
    const total = Math.max(rawCogs, kpis.cogsDollars, 1)
    if (cogsDelta > 0.01 || revDelta > 0.01) {
      const severity = classifyDollarDelta(Math.max(cogsDelta, revDelta), total)
      if (severity !== "INFO") {
        findings.push({
          domain: "pnl-aggregation",
          check: "cogs_kpis_vs_raw_sum",
          severity,
          message: `${store.name} — getCogsKpis cogs ${money(kpis.cogsDollars)} vs raw Σ ${money(rawCogs)}; rev ${money(kpis.revenueDollars)} vs ${money(rawRev)}`,
          entity: { kind: "store", id: store.id, label: store.name },
          details: {
            storeId: store.id,
            window: { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) },
            kpisCogs: kpis.cogsDollars,
            rawCogs,
            kpisRev: kpis.revenueDollars,
            rawRev,
          },
          deltaDollars: Math.max(cogsDelta, revDelta),
        })
      }
    }

    // ── 3. cogs_pct_sanity ────────────────────────────────────────
    if (rawRev >= 1000) {
      const pct = rawRev > 0 ? (rawCogs / rawRev) * 100 : 0
      if (pct > 0 && (pct < 15 || pct > 65)) {
        const severity: "CRITICAL" | "WARNING" = pct > 80 || (pct > 0 && pct < 10) ? "CRITICAL" : "WARNING"
        findings.push({
          domain: "pnl-aggregation",
          check: "cogs_pct_sanity",
          severity,
          message: `${store.name} — 90d COGS% = ${pct.toFixed(1)}% (revenue ${money(rawRev)}, cogs ${money(rawCogs)}) — outside typical 15–65% band`,
          entity: { kind: "store", id: store.id, label: store.name },
          details: {
            storeId: store.id,
            cogsPct: pct,
            cogsDollars: rawCogs,
            revenueDollars: rawRev,
            targetCogsPct: store.targetCogsPct,
          },
          deltaDollars: Math.abs(rawCogs - (rawRev * (store.targetCogsPct ?? 30)) / 100),
          deltaPct: pct / 100,
        })
      }
    }
  }

  // ── 2. period_bucket_overlap ─────────────────────────────────────
  // Generate periods for the last year at weekly / monthly and verify every
  // day appears in exactly one bucket. buildPeriods normalizes its internal
  // boundaries to startOfDay, so our iterator must also use startOfDay time
  // components or we'll see spurious "gap" days at the window edge.
  const endDay = new Date(end)
  endDay.setHours(0, 0, 0, 0)
  const yearStart = new Date(endDay)
  yearStart.setDate(yearStart.getDate() - 365)
  for (const gran of ["weekly", "monthly"] as const) {
    const periods = buildPeriods(yearStart, endDay, gran)
    let overlap = 0
    let gap = 0
    const sample: Array<{ day: string; matches: number }> = []
    for (let d = new Date(yearStart); d <= endDay; d.setDate(d.getDate() + 1)) {
      const t = d.getTime()
      let matches = 0
      for (const p of periods) {
        if (t >= p.startDate.getTime() && t <= p.endDate.getTime()) matches++
      }
      if (matches !== 1) {
        if (matches === 0) gap++
        else overlap++
        if (sample.length < 5) sample.push({ day: d.toISOString().slice(0, 10), matches })
      }
    }
    if (overlap > 0 || gap > 0) {
      findings.push({
        domain: "pnl-aggregation",
        check: "period_bucket_alignment",
        severity: "CRITICAL",
        message: `buildPeriods(${gran}) over last 365d: ${overlap} day(s) in >1 bucket, ${gap} day(s) in 0 buckets`,
        entity: { kind: "period", id: `periods::${gran}`, label: gran },
        details: { granularity: gran, overlap, gap, periodsCount: periods.length, sample },
        deltaDollars: overlap + gap,
      })
    }
  }

  return findings
}

if (require.main === module) {
  auditPnlAggregation()
    .then((f) => {
      console.log(JSON.stringify(f, null, 2))
      const counts = { CRITICAL: 0, WARNING: 0, INFO: 0 }
      for (const x of f) counts[x.severity]++
      console.error(`pnl-aggregation: ${f.length} findings  crit=${counts.CRITICAL} warn=${counts.WARNING} info=${counts.INFO}`)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
    .finally(async () => {
      const { prisma } = await import("../../src/lib/prisma")
      await prisma.$disconnect()
    })
}
