// scripts/audit/cogs-flow.ts
//
// Read-only end-to-end reconciliation of the invoice → ingredient cost →
// recipe cost → DailyCogsItem pipeline for one store (Hollywood by default).
// It does not mutate database rows.
//
// Sections:
//   1. Invoice intake       — invoices by status, unmatched + underivable lines
//   2. Canonical cost sanity — both-direction spike-guard rejections, ratios
//   3. Recipe cost drift    — today vs −7d for sellable recipes, partials
//   4. Daily reconciliation — DailyCogsItem status shares vs OtterMenuItem sales
//   5. Stored-row spot check — top-revenue items recomputed vs stored lineCost
//   6. Modifier reconciliation — per-day sub-item buckets rebuilt with the
//      production buildModifierUsage; flags unmapped SKUs and orphaned dollars
//      (parent order-item names with no OtterMenuItem row that day)
//
// Usage:
//   ./node_modules/.bin/tsx scripts/audit/cogs-flow.ts
//   ./node_modules/.bin/tsx scripts/audit/cogs-flow.ts --days 28 --drift-pct 20
//   ./node_modules/.bin/tsx scripts/audit/cogs-flow.ts --store <storeId>
//   ./node_modules/.bin/tsx scripts/audit/cogs-flow.ts --json
//   ./node_modules/.bin/tsx scripts/audit/cogs-flow.ts --strict
//   ./node_modules/.bin/tsx scripts/audit/cogs-flow.ts --suggest-eval
//
// --suggest-eval scores the embedding-based recipe suggester against
// already-mapped items (the mapping is ground truth): top-1 hit rate and the
// similarity distribution of hits vs misses, to calibrate confidence bands.
//
// --strict exits non-zero when: UNMAPPED revenue share > 2%, any low-side
// (too-cheap) guard rejection, or any day where materialized food sales drift
// > $1 from the OtterMenuItem rollup.

import { loadEnvLocal, money } from "./lib"

loadEnvLocal()

type Jsonish = Record<string, unknown>

function flag(name: string): boolean {
  return process.argv.includes(name)
}

function argValue(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null
}

function dateKey(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "-"
}

function pctStr(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function printSection(title: string): void {
  console.log("")
  console.log(title)
  console.log("-".repeat(title.length))
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

async function main(): Promise<void> {
  const json = flag("--json")
  const strict = flag("--strict")
  const days = Number(argValue("--days") ?? 28)
  const driftPct = Number(argValue("--drift-pct") ?? 20)
  const storeIdArg = argValue("--store")

  const { prisma } = await import("../../src/lib/prisma")
  const { computeRecipeCost } = await import("../../src/lib/recipe-cost")
  const { deriveCostFromLineItem } = await import("../../src/lib/ingredient-cost")
  const { selectNonSpikeCostIndex, COST_CANDIDATE_WINDOW, COST_SPIKE_THRESHOLD } =
    await import("../../src/lib/invoice-line-shape")

  // ── Store resolve ────────────────────────────────────────────────────────
  const store = storeIdArg
    ? await prisma.store.findUnique({
        where: { id: storeIdArg },
        select: { id: true, name: true, accountId: true },
      })
    : await prisma.store.findFirst({
        where: { name: { contains: "Hollywood", mode: "insensitive" } },
        select: { id: true, name: true, accountId: true },
      })
  if (!store) throw new Error(`Store not found (${storeIdArg ?? "Hollywood"})`)

  // ── --suggest-eval: embedding suggester calibration ──────────────────────
  if (flag("--suggest-eval")) {
    const { rankRecipeCandidatesForMenuItems } = await import(
      "../../src/lib/recipe-similarity"
    )
    const mapped = await prisma.otterItemMapping.findMany({
      where: { storeId: store.id },
      select: { otterItemName: true, recipeId: true },
    })
    const ranked = await rankRecipeCandidatesForMenuItems({
      accountId: store.accountId,
      items: mapped.map((m) => ({
        storeId: store.id,
        itemName: m.otterItemName,
        category: "",
      })),
      maxCandidates: 3,
    })
    let covered = 0
    let top1Hits = 0
    const hitSims: number[] = []
    const missTop: Array<{ item: string; got: string; sim: number }> = []
    for (const m of mapped) {
      const candidates = ranked.get(m.otterItemName)
      if (!candidates || candidates.length === 0) continue
      covered++
      if (candidates[0].recipeId === m.recipeId) {
        top1Hits++
        hitSims.push(candidates[0].similarity)
      } else {
        missTop.push({
          item: m.otterItemName,
          got: candidates[0].recipeName,
          sim: candidates[0].similarity,
        })
      }
    }
    console.log(`Suggest-eval — ${store.name}`)
    console.log(
      `Mapped items: ${mapped.length}; with embeddings: ${covered}; top-1 hits: ${top1Hits} ` +
        `(${covered > 0 ? ((top1Hits / covered) * 100).toFixed(1) : "0"}%)`
    )
    if (hitSims.length > 0) {
      const sorted = [...hitSims].sort((a, b) => a - b)
      console.log(
        `Hit similarity: min ${sorted[0].toFixed(3)}, median ${median(sorted).toFixed(3)}, max ${sorted[sorted.length - 1].toFixed(3)}`
      )
    }
    console.log(`Top-1 misses: ${missTop.length}`)
    for (const miss of missTop.slice(0, 15)) {
      console.log(`- ${miss.item} → ${miss.got} (${miss.sim.toFixed(3)})`)
    }
    return
  }

  const windowEnd = new Date()
  windowEnd.setUTCHours(0, 0, 0, 0)
  const windowStart = new Date(windowEnd)
  windowStart.setUTCDate(windowStart.getUTCDate() - days)

  // ── 1. Invoice intake ────────────────────────────────────────────────────
  const invoicesByStatus = await prisma.invoice.groupBy({
    by: ["status"],
    where: { storeId: store.id, invoiceDate: { gte: windowStart } },
    _count: { _all: true },
    _sum: { totalAmount: true },
  })

  const unmatchedLines = await prisma.invoiceLineItem.findMany({
    where: {
      canonicalIngredientId: null,
      invoice: { storeId: store.id, invoiceDate: { gte: windowStart } },
    },
    select: {
      productName: true,
      extendedPrice: true,
      invoice: { select: { vendorName: true, invoiceDate: true } },
    },
  })
  const unmatchedDollars = unmatchedLines.reduce(
    (s, l) => s + Math.abs(l.extendedPrice),
    0
  )

  // Matched lines whose cost cannot be derived into the canonical's recipe
  // unit — these silently contribute nothing to ingredient pricing.
  const matchedLines = await prisma.invoiceLineItem.findMany({
    where: {
      canonicalIngredientId: { not: null },
      quantity: { not: 0 },
      invoice: { storeId: store.id, invoiceDate: { gte: windowStart } },
    },
    select: {
      id: true,
      productName: true,
      quantity: true,
      unit: true,
      packSize: true,
      unitSize: true,
      unitSizeUom: true,
      unitPrice: true,
      extendedPrice: true,
      canonicalIngredient: { select: { name: true, recipeUnit: true } },
      invoice: { select: { vendorName: true, invoiceDate: true } },
    },
  })
  const underivable = matchedLines
    .filter(
      (l) =>
        l.canonicalIngredient?.recipeUnit &&
        deriveCostFromLineItem(l, l.canonicalIngredient.recipeUnit) == null
    )
    .map((l) => ({
      productName: l.productName,
      canonical: l.canonicalIngredient?.name,
      recipeUnit: l.canonicalIngredient?.recipeUnit,
      invoiceUnit: l.unit,
      vendor: l.invoice.vendorName,
      date: dateKey(l.invoice.invoiceDate),
      extendedPrice: l.extendedPrice,
    }))

  // ── 2. Canonical cost sanity (both-direction spike report) ───────────────
  const usedCanonicals = await prisma.canonicalIngredient.findMany({
    where: { recipeIngredients: { some: {} } },
    select: {
      id: true,
      name: true,
      recipeUnit: true,
      costLocked: true,
      costSource: true,
      skuMatches: {
        take: 1,
        select: { conversionFactor: true, fromUnit: true, toUnit: true },
      },
      invoiceLineItems: {
        where: { quantity: { not: 0 } },
        orderBy: { invoice: { invoiceDate: "desc" } },
        take: COST_CANDIDATE_WINDOW,
        select: {
          id: true,
          quantity: true,
          unit: true,
          packSize: true,
          unitSize: true,
          unitSizeUom: true,
          unitPrice: true,
          extendedPrice: true,
          invoice: { select: { invoiceDate: true, vendorName: true } },
        },
      },
    },
  })

  type SpikeFinding = {
    canonical: string
    canonicalId: string
    direction: "high" | "low"
    newestCost: number
    baselineMedian: number
    ratio: number
    newestVendor: string | null
    newestDate: string
  }
  const spikeFindings: SpikeFinding[] = []
  const guardRejections: Array<SpikeFinding & { chosenCost: number }> = []

  for (const c of usedCanonicals) {
    const lines = c.invoiceLineItems
    if (lines.length < 2) continue
    const costs = lines
      .map((l) => {
        if (c.recipeUnit) {
          const conv = c.skuMatches[0]
          const derived = deriveCostFromLineItem(
            l,
            c.recipeUnit,
            conv ?? undefined
          )
          if (derived != null) return derived
        }
        return l.quantity !== 0 ? l.extendedPrice / l.quantity : NaN
      })
      .map((v) => (isFinite(v) && v > 0 ? v : NaN))

    const finite = costs.filter((v) => isFinite(v))
    if (finite.length < 2) continue

    const { index, rejectedSpike } = selectNonSpikeCostIndex(costs.map((v) => (isFinite(v) ? v : 0)))
    const newest = finite[0]
    const olderMedian = median(finite.slice(1))
    if (olderMedian <= 0) continue
    const ratio = newest / olderMedian

    const outOfBand =
      ratio > COST_SPIKE_THRESHOLD || ratio < 1 / COST_SPIKE_THRESHOLD
    if (outOfBand) {
      const finding: SpikeFinding = {
        canonical: c.name,
        canonicalId: c.id,
        direction: ratio > 1 ? "high" : "low",
        newestCost: newest,
        baselineMedian: olderMedian,
        ratio,
        newestVendor: lines[0].invoice.vendorName,
        newestDate: dateKey(lines[0].invoice.invoiceDate),
      }
      spikeFindings.push(finding)
      if (rejectedSpike) {
        guardRejections.push({ ...finding, chosenCost: costs[index] })
      }
    }
  }
  spikeFindings.sort((a, b) => Math.max(b.ratio, 1 / b.ratio) - Math.max(a.ratio, 1 / a.ratio))
  const lowSideRejections = guardRejections.filter((f) => f.direction === "low")

  // ── 3. Recipe cost drift (today vs −7d) ──────────────────────────────────
  const sellableRecipes = await prisma.recipe.findMany({
    where: { accountId: store.accountId, isSellable: true },
    select: { id: true, itemName: true, category: true },
  })
  const weekAgo = new Date(windowEnd)
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 7)

  type DriftRow = {
    itemName: string
    category: string
    costNow: number | null
    costWeekAgo: number | null
    deltaPct: number | null
    partial: boolean
  }
  const driftRows: DriftRow[] = []
  for (const r of sellableRecipes) {
    const [now, prior] = await Promise.all([
      computeRecipeCost(r.id, undefined, { storeId: store.id }).catch(() => null),
      computeRecipeCost(r.id, weekAgo, { storeId: store.id }).catch(() => null),
    ])
    const costNow = now?.totalCost ?? null
    const costWeekAgo = prior?.totalCost ?? null
    const deltaPct =
      costNow != null && costWeekAgo != null && costWeekAgo > 0
        ? ((costNow - costWeekAgo) / costWeekAgo) * 100
        : null
    driftRows.push({
      itemName: r.itemName,
      category: r.category,
      costNow,
      costWeekAgo,
      deltaPct,
      partial: now?.partial ?? true,
    })
  }
  const bigDrift = driftRows
    .filter((r) => r.deltaPct != null && Math.abs(r.deltaPct) > driftPct)
    .sort((a, b) => Math.abs(b.deltaPct!) - Math.abs(a.deltaPct!))
  const partialRecipes = driftRows.filter((r) => r.partial)

  // ── 4. Daily reconciliation ──────────────────────────────────────────────
  const [cogsDays, otterDays] = await Promise.all([
    prisma.dailyCogsItem.groupBy({
      by: ["date", "status"],
      where: {
        storeId: store.id,
        date: { gte: windowStart, lte: windowEnd },
        category: { not: "Packaging" },
      },
      _sum: { salesRevenue: true, lineCost: true, qtySold: true },
    }),
    prisma.otterMenuItem.groupBy({
      by: ["date"],
      where: {
        storeId: store.id,
        isModifier: false,
        date: { gte: windowStart, lte: windowEnd },
      },
      _sum: { fpTotalSales: true, tpTotalSales: true },
    }),
  ])

  type DayRow = {
    date: string
    otterSales: number
    cogsSales: number
    driftDollars: number
    unmappedRevenue: number
    missingCostRevenue: number
    costedRevenue: number
    lineCost: number
  }
  const byDay = new Map<string, DayRow>()
  const ensureDay = (key: string): DayRow => {
    let d = byDay.get(key)
    if (!d) {
      d = {
        date: key,
        otterSales: 0,
        cogsSales: 0,
        driftDollars: 0,
        unmappedRevenue: 0,
        missingCostRevenue: 0,
        costedRevenue: 0,
        lineCost: 0,
      }
      byDay.set(key, d)
    }
    return d
  }
  for (const row of otterDays) {
    const d = ensureDay(dateKey(row.date))
    d.otterSales += (row._sum.fpTotalSales ?? 0) + (row._sum.tpTotalSales ?? 0)
  }
  for (const row of cogsDays) {
    const d = ensureDay(dateKey(row.date))
    const rev = row._sum.salesRevenue ?? 0
    d.cogsSales += rev
    d.lineCost += row._sum.lineCost ?? 0
    if (row.status === "UNMAPPED") d.unmappedRevenue += rev
    else if (row.status === "MISSING_COST") d.missingCostRevenue += rev
    else d.costedRevenue += rev
  }
  const dayRows = Array.from(byDay.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  )
  for (const d of dayRows) d.driftDollars = d.cogsSales - d.otterSales
  const driftDays = dayRows.filter((d) => Math.abs(d.driftDollars) > 1)
  const totalSales = dayRows.reduce((s, d) => s + d.cogsSales, 0)
  const totalUnmapped = dayRows.reduce((s, d) => s + d.unmappedRevenue, 0)
  const totalMissing = dayRows.reduce((s, d) => s + d.missingCostRevenue, 0)
  const unmappedShare = totalSales > 0 ? totalUnmapped / totalSales : 0

  // ── 5. Stored-row spot check ─────────────────────────────────────────────
  const topItems = await prisma.dailyCogsItem.groupBy({
    by: ["itemName"],
    where: {
      storeId: store.id,
      date: { gte: windowStart, lte: windowEnd },
      status: "COSTED",
      category: { not: "Packaging" },
    },
    _sum: { salesRevenue: true },
    orderBy: { _sum: { salesRevenue: "desc" } },
    take: 20,
  })
  type SpotRow = {
    itemName: string
    date: string
    storedLineCost: number
    recomputedBase: number
    deviationPct: number
  }
  const spotDeviations: SpotRow[] = []
  for (const item of topItems) {
    const latest = await prisma.dailyCogsItem.findFirst({
      where: {
        storeId: store.id,
        itemName: item.itemName,
        status: "COSTED",
        date: { gte: windowStart, lte: windowEnd },
      },
      orderBy: { date: "desc" },
      select: {
        date: true,
        recipeId: true,
        qtySold: true,
        lineCost: true,
      },
    })
    if (!latest?.recipeId || latest.qtySold <= 0 || latest.lineCost <= 0) continue
    const recomputed = await computeRecipeCost(latest.recipeId, latest.date, {
      storeId: store.id,
    }).catch(() => null)
    if (!recomputed || recomputed.totalCost <= 0) continue
    const recomputedBase = recomputed.totalCost * latest.qtySold
    // Stored lineCost includes the modifier share; recomputed base does not.
    // Small positive gaps are expected — flag only >15% deviation.
    const deviationPct =
      (Math.abs(latest.lineCost - recomputedBase) / recomputedBase) * 100
    if (deviationPct > 15) {
      spotDeviations.push({
        itemName: item.itemName,
        date: dateKey(latest.date),
        storedLineCost: latest.lineCost,
        recomputedBase,
        deviationPct,
      })
    }
  }
  spotDeviations.sort((a, b) => b.deviationPct - a.deviationPct)

  // ── 6. Modifier COGS reconciliation ──────────────────────────────────────
  // Rebuild the per-day modifier buckets with the SAME code the materializer
  // uses (buildModifierUsage), then check the two ways modifier dollars can
  // silently leak: (a) sub-item SKUs with no OtterSubItemMapping, and
  // (b) orphaned buckets — parent order-item names with no OtterMenuItem row
  // that day, whose allocated dollars the materializer has nowhere to land.
  const { buildModifierUsage } = await import("../../src/lib/cogs-materializer")
  const dayAfterEnd = new Date(windowEnd)
  dayAfterEnd.setUTCDate(dayAfterEnd.getUTCDate() + 1)

  const [windowSubItems, subItemMappings, menuNameRows] = await Promise.all([
    prisma.otterOrderSubItem.findMany({
      where: {
        orderItem: {
          order: {
            storeId: store.id,
            referenceTimeLocal: { gte: windowStart, lt: dayAfterEnd },
          },
        },
      },
      select: {
        skuId: true,
        name: true,
        quantity: true,
        orderItem: {
          select: {
            name: true,
            quantity: true,
            order: { select: { referenceTimeLocal: true } },
          },
        },
      },
    }),
    prisma.otterSubItemMapping.findMany({
      where: { storeId: store.id },
      select: { skuId: true, recipeId: true },
    }),
    prisma.otterMenuItem.findMany({
      where: {
        storeId: store.id,
        isModifier: false,
        date: { gte: windowStart, lte: windowEnd },
      },
      select: { date: true, itemName: true },
    }),
  ])
  const subRecipeBySku = new Map(subItemMappings.map((m) => [m.skuId, m.recipeId]))
  const menuNameByDay = new Set(
    menuNameRows.map((r) => `${dateKey(r.date)}::${r.itemName}`)
  )

  const subItemsByDay = new Map<string, typeof windowSubItems>()
  for (const s of windowSubItems) {
    const day = dateKey(s.orderItem?.order?.referenceTimeLocal ?? null)
    if (day === "-") continue
    const list = subItemsByDay.get(day) ?? []
    list.push(s)
    subItemsByDay.set(day, list)
  }

  const modCostCache = new Map<string, Promise<Awaited<ReturnType<typeof computeRecipeCost>> | null>>()
  const costForOnDay = (dayKeyStr: string) => (recipeId: string) => {
    const key = `${recipeId}::${dayKeyStr}`
    const hit = modCostCache.get(key)
    if (hit) return hit
    const p = computeRecipeCost(recipeId, new Date(`${dayKeyStr}T00:00:00Z`), {
      storeId: store.id,
    }).catch(() => null)
    modCostCache.set(key, p)
    return p
  }

  let totalModifierDollars = 0
  let orphanedModifierDollars = 0
  const orphanedByName = new Map<string, { dollars: number; days: number }>()
  const unmappedSubUses = new Map<string, { skuId: string; uses: number }>()
  const zeroWalkNames = new Map<string, number>() // intentional $0 mods (info)

  for (const [day, subs] of subItemsByDay) {
    const buckets = await buildModifierUsage({
      subItems: subs,
      subRecipeBySku,
      costFor: costForOnDay(day),
    })
    for (const [parentName, bucket] of buckets) {
      totalModifierDollars += bucket.extraLineCost
      if (!menuNameByDay.has(`${day}::${parentName}`)) {
        orphanedModifierDollars += bucket.extraLineCost
        if (bucket.extraLineCost > 0) {
          const o = orphanedByName.get(parentName) ?? { dollars: 0, days: 0 }
          o.dollars += bucket.extraLineCost
          o.days++
          orphanedByName.set(parentName, o)
        }
      }
      for (const b of bucket.breakdown) {
        if (b.unitCost == null) {
          const u = unmappedSubUses.get(b.name) ?? { skuId: b.skuId, uses: 0 }
          u.uses += b.uses
          unmappedSubUses.set(b.name, u)
        } else if (b.unitCost === 0) {
          zeroWalkNames.set(b.name, (zeroWalkNames.get(b.name) ?? 0) + b.uses)
        }
      }
    }
  }
  const orphanedList = [...orphanedByName.entries()]
    .map(([name, o]) => ({ name, ...o }))
    .sort((a, b) => b.dollars - a.dollars)
  const unmappedSubList = [...unmappedSubUses.entries()]
    .map(([name, u]) => ({ name, ...u }))
    .sort((a, b) => b.uses - a.uses)

  // ── Report ───────────────────────────────────────────────────────────────
  const report: Jsonish = {
    generatedAt: new Date().toISOString(),
    store: { id: store.id, name: store.name },
    window: { start: dateKey(windowStart), end: dateKey(windowEnd), days },
    invoiceIntake: {
      byStatus: invoicesByStatus,
      unmatchedLineCount: unmatchedLines.length,
      unmatchedDollars,
      underivableLines: underivable,
    },
    canonicalCostSanity: {
      canonicalsChecked: usedCanonicals.length,
      outOfBand: spikeFindings,
      guardRejections,
      lowSideRejections: lowSideRejections.length,
    },
    recipeDrift: {
      recipesChecked: sellableRecipes.length,
      driftThresholdPct: driftPct,
      bigDrift,
      partialRecipes: partialRecipes.map((r) => r.itemName),
    },
    dailyReconciliation: {
      days: dayRows,
      driftDays,
      totals: {
        sales: totalSales,
        unmappedRevenue: totalUnmapped,
        missingCostRevenue: totalMissing,
        unmappedShare,
      },
    },
    spotCheck: { deviations: spotDeviations },
    modifierReconciliation: {
      totalModifierDollars,
      orphanedModifierDollars,
      orphaned: orphanedList,
      unmappedSubItems: unmappedSubList,
      intentionalZeroUses: Object.fromEntries(zeroWalkNames),
    },
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`COGS flow audit — ${store.name} — ${new Date().toISOString()}`)
    console.log(`Window: ${dateKey(windowStart)} → ${dateKey(windowEnd)} (${days}d)`)

    printSection("1. Invoice Intake")
    for (const row of invoicesByStatus) {
      console.log(
        `- ${row.status}: ${row._count._all} invoices, ${money(row._sum.totalAmount)}`
      )
    }
    console.log(
      `Unmatched line items (no canonical): ${unmatchedLines.length} lines, ${money(unmatchedDollars)}`
    )
    console.log(`Matched lines whose cost cannot be derived: ${underivable.length}`)
    for (const l of underivable.slice(0, 10)) {
      console.log(
        `- ${l.productName} → ${l.canonical}: invoice ${l.invoiceUnit ?? "-"} → recipe ${l.recipeUnit} (${l.vendor}, ${l.date})`
      )
    }

    printSection("2. Canonical Cost Sanity")
    console.log(
      `Canonicals checked: ${usedCanonicals.length}; newest-vs-history out of [1/${COST_SPIKE_THRESHOLD}, ${COST_SPIKE_THRESHOLD}x]: ${spikeFindings.length}`
    )
    for (const f of spikeFindings.slice(0, 15)) {
      console.log(
        `- [${f.direction.toUpperCase()}] ${f.canonical}: newest ${money(f.newestCost)} vs median ${money(f.baselineMedian)} ` +
          `(${f.ratio.toFixed(2)}x, ${f.newestVendor ?? "?"}, ${f.newestDate})`
      )
    }
    console.log(
      `Guard rejections live right now: ${guardRejections.length} (${lowSideRejections.length} low-side)`
    )

    printSection("3. Recipe Cost Drift (7d)")
    console.log(
      `Sellable recipes: ${sellableRecipes.length}; |Δ| > ${driftPct}%: ${bigDrift.length}; partial: ${partialRecipes.length}`
    )
    for (const r of bigDrift.slice(0, 10)) {
      console.log(
        `- ${r.itemName} [${r.category}]: ${money(r.costWeekAgo)} → ${money(r.costNow)} (${r.deltaPct!.toFixed(1)}%)`
      )
    }
    for (const r of partialRecipes.slice(0, 10)) {
      console.log(`- PARTIAL ${r.itemName} [${r.category}] total=${money(r.costNow)}`)
    }

    printSection("4. Daily Reconciliation")
    console.log(
      `Days with |materialized − Otter| > $1: ${driftDays.length} of ${dayRows.length}`
    )
    for (const d of driftDays.slice(0, 10)) {
      console.log(
        `- ${d.date}: cogs ${money(d.cogsSales)} vs otter ${money(d.otterSales)} (drift ${money(d.driftDollars)})`
      )
    }
    console.log(
      `Window totals: sales ${money(totalSales)}, UNMAPPED ${money(totalUnmapped)} (${pctStr(unmappedShare)}), MISSING_COST ${money(totalMissing)}`
    )

    printSection("5. Stored-Row Spot Check")
    console.log(`Top-revenue items deviating > 15% from recomputed cost: ${spotDeviations.length}`)
    for (const s of spotDeviations.slice(0, 10)) {
      console.log(
        `- ${s.itemName} (${s.date}): stored ${money(s.storedLineCost)} vs recomputed ${money(s.recomputedBase)} (${s.deviationPct.toFixed(1)}%)`
      )
    }

    printSection("6. Modifier COGS Reconciliation")
    console.log(
      `Window modifier dollars (recomputed): ${money(totalModifierDollars)}; ` +
        `orphaned (no menu row to land on): ${money(orphanedModifierDollars)}`
    )
    for (const o of orphanedList.slice(0, 10)) {
      console.log(`- ORPHANED ${o.name}: ${money(o.dollars)} across ${o.days} day(s)`)
    }
    console.log(`Unmapped sub-item SKUs in window: ${unmappedSubList.length}`)
    for (const u of unmappedSubList.slice(0, 10)) {
      console.log(`- ${u.name} (sku ${u.skuId}): ${u.uses} uses`)
    }
    const zeroList = [...zeroWalkNames.entries()].sort((a, b) => b[1] - a[1])
    console.log(
      `Intentional $0 modifiers (clean zero-walk): ${zeroList
        .slice(0, 6)
        .map(([n, uses]) => `${n} (${uses})`)
        .join(", ") || "none"}`
    )

    printSection("Summary")
    console.log(`UNMAPPED revenue share: ${pctStr(unmappedShare)} (${money(totalUnmapped)})`)
    console.log(`Low-side guard rejections: ${lowSideRejections.length}`)
    console.log(`Reconciliation drift days: ${driftDays.length}`)
    console.log("This script is read-only. Review findings before applying DB corrections.")
  }

  if (strict) {
    const failures: string[] = []
    if (unmappedShare > 0.02)
      failures.push(`UNMAPPED revenue share ${pctStr(unmappedShare)} > 2%`)
    if (lowSideRejections.length > 0)
      failures.push(`${lowSideRejections.length} low-side guard rejections`)
    if (driftDays.length > 0)
      failures.push(`${driftDays.length} days with reconciliation drift > $1`)
    if (orphanedModifierDollars > 1)
      failures.push(
        `${money(orphanedModifierDollars)} modifier dollars orphaned (no menu row)`
      )
    if (failures.length > 0) {
      throw new Error(`Strict COGS-flow audit failed: ${failures.join("; ")}`)
    }
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    const { prisma } = await import("../../src/lib/prisma")
    await prisma.$disconnect()
  })
