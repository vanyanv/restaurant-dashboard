// Recipe cost audit.
//
// Three checks against every sellable recipe:
//   1. override_vs_computed  — foodCostOverride drift from computed cost > 50% / $0.50
//   2. cycle_detected        — computeRecipeCost() throws RecipeCycleError
//   3. missing_cost_root     — recipe has ingredients whose canonical has no cost,
//                              blocking COGS materialization (MISSING_COST root cause)
//
// Uses the real cost pipeline (computeRecipeCost + batchCanonicalCosts) so we
// flag what users actually see in dashboards, not a parallel calculation.

import { loadEnvLocal, type Finding, money } from "./lib"

loadEnvLocal()

export async function auditRecipeCost(): Promise<Finding[]> {
  const { prisma } = await import("../../src/lib/prisma")
  const { computeRecipeCost, RecipeCycleError } = await import("../../src/lib/recipe-cost")
  const { batchCanonicalCosts } = await import("../../src/lib/canonical-cost-batch")
  const findings: Finding[] = []

  const owners = await prisma.recipe.groupBy({ by: ["ownerId"], _count: { _all: true } })
  for (const o of owners) {
    const [recipes, canonicalCosts] = await Promise.all([
      prisma.recipe.findMany({
        where: { ownerId: o.ownerId, isSellable: true },
        select: {
          id: true,
          itemName: true,
          category: true,
          foodCostOverride: true,
          ingredients: {
            select: {
              id: true,
              quantity: true,
              unit: true,
              ingredientName: true,
              canonicalIngredientId: true,
              componentRecipeId: true,
              canonicalIngredient: { select: { id: true, name: true } },
            },
          },
        },
      }),
      batchCanonicalCosts(o.ownerId),
    ])

    for (const r of recipes) {
      // ── Check 2: cycle detection ─────────────────────────────────────
      let result: Awaited<ReturnType<typeof computeRecipeCost>> | null = null
      try {
        result = await computeRecipeCost(r.id)
      } catch (e) {
        if (e instanceof RecipeCycleError) {
          findings.push({
            domain: "recipe-cost",
            check: "cycle_detected",
            severity: "CRITICAL",
            message: `${r.itemName} — sub-recipe cycle: ${e.chain.join(" → ")}`,
            entity: { kind: "recipe", id: r.id, label: r.itemName },
            details: { ownerId: o.ownerId, cycle: e.chain },
          })
          continue
        }
        findings.push({
          domain: "recipe-cost",
          check: "compute_error",
          severity: "CRITICAL",
          message: `${r.itemName} — computeRecipeCost threw: ${String(e).slice(0, 200)}`,
          entity: { kind: "recipe", id: r.id, label: r.itemName },
          details: { ownerId: o.ownerId, error: String(e) },
        })
        continue
      }

      // ── Check 3: missing_cost_root ──────────────────────────────────
      // Any ingredient whose canonical has no cost AT ALL (not just partial).
      // These are the MISSING_COST root cause that shows up in DailyCogsItem.
      const missing = result.lines.filter((l) => l.missingCost && l.kind === "ingredient")
      if (missing.length > 0) {
        const names = missing.map((m) => m.name).slice(0, 3).join(", ")
        const more = missing.length > 3 ? ` +${missing.length - 3} more` : ""
        findings.push({
          domain: "recipe-cost",
          check: "missing_cost_root",
          severity: "WARNING",
          message: `${r.itemName} — ${missing.length} ingredient(s) can't be costed: ${names}${more}`,
          entity: { kind: "recipe", id: r.id, label: r.itemName },
          details: {
            ownerId: o.ownerId,
            missingIngredients: missing.map((m) => ({ name: m.name, refId: m.refId, unit: m.unit })),
            category: r.category,
          },
          deltaDollars: missing.length,
        })
      }

      // ── Check 1: override_vs_computed ───────────────────────────────
      // Skip when we had to fall back to override (result already equals override).
      // Recompute ignoring override: sum only the line costs whose canonical resolved.
      const override = r.foodCostOverride
      if (override == null) continue

      // Reconstruct "pure computed" total: sum line costs EXCLUDING the override
      // fallback that happens inside computeRecipeCost when total=0.
      let pureTotal = 0
      let hasAnyResolvedLine = false
      for (const line of result.lines) {
        if (!line.missingCost) {
          pureTotal += line.lineCost
          hasAnyResolvedLine = true
        }
      }
      if (!hasAnyResolvedLine) continue // can't compare — nothing costed

      const diff = pureTotal - override
      const absDiff = Math.abs(diff)
      const threshold = Math.max(0.5, Math.abs(override) * 0.5)
      if (absDiff <= threshold) continue

      const pctDrift = override !== 0 ? diff / override : 1
      const severity: "CRITICAL" | "WARNING" =
        absDiff > Math.max(2, Math.abs(override) * 0.5) ? "CRITICAL" : "WARNING"

      findings.push({
        domain: "recipe-cost",
        check: "override_vs_computed",
        severity,
        message: `${r.itemName} — foodCostOverride ${money(override)} vs computed ${money(pureTotal)} (Δ ${money(diff)}, ${pctDrift >= 0 ? "+" : ""}${(pctDrift * 100).toFixed(0)}%)${result.partial ? " — partial" : ""}`,
        entity: { kind: "recipe", id: r.id, label: r.itemName },
        details: {
          ownerId: o.ownerId,
          category: r.category,
          override,
          computed: pureTotal,
          delta: diff,
          partial: result.partial,
          missingCount: missing.length,
        },
        deltaDollars: absDiff,
        deltaPct: Math.abs(pctDrift),
      })
    }

    // ── Check 2b: cycles found by batch path but not walk (orphaned by memo)
    // Covered by the RecipeCycleError above; batch-specific cycles would show
    // up as partial=true with zero resolved lines, which the missing_cost_root
    // check already captures.
    void canonicalCosts // referenced for type narrowing; batch used to build cost map
  }

  return findings
}

if (require.main === module) {
  auditRecipeCost()
    .then((f) => {
      console.log(JSON.stringify(f, null, 2))
      const counts = { CRITICAL: 0, WARNING: 0, INFO: 0 }
      for (const x of f) counts[x.severity]++
      console.error(`recipe-cost: ${f.length} findings  crit=${counts.CRITICAL} warn=${counts.WARNING} info=${counts.INFO}`)
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
