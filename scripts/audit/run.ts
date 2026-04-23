// scripts/audit/run.ts
//
// Runs every domain audit, merges findings, and renders:
//   docs/audits/YYYY-MM-DD-calculations-audit.md   (human-readable report)
//   docs/audits/YYYY-MM-DD-calculations-audit.json (raw findings, for diffing)
//
// Each audit is imported dynamically AFTER loadEnvLocal() so prisma initializes
// with DATABASE_URL in process.env. Errors from any one audit are caught and
// recorded as a finding instead of aborting the run.

import fs from "fs"
import path from "path"
import { loadEnvLocal, type Finding, type Severity, money } from "./lib"

loadEnvLocal()

type DomainRunner = { name: string; run: () => Promise<Finding[]> }

async function loadRunners(): Promise<DomainRunner[]> {
  const { auditInvoices } = await import("./invoices")
  const { auditUnitConversion } = await import("./unit-conversion")
  const { auditRecipeCost } = await import("./recipe-cost")
  const { auditCogsMaterialization } = await import("./cogs-materialization")
  const { auditOtterSales } = await import("./otter-sales")
  const { auditPnlAggregation } = await import("./pnl-aggregation")
  const { auditIngredientMatching } = await import("./ingredient-matching")
  return [
    { name: "invoices", run: auditInvoices },
    { name: "unit-conversion", run: auditUnitConversion },
    { name: "recipe-cost", run: auditRecipeCost },
    { name: "cogs-materialization", run: auditCogsMaterialization },
    { name: "otter-sales", run: auditOtterSales },
    { name: "pnl-aggregation", run: auditPnlAggregation },
    { name: "ingredient-matching", run: auditIngredientMatching },
  ]
}

function today(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

const SEVERITY_ORDER: Record<Severity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
}

function renderReport(findings: Finding[], domainCounts: Map<string, Record<Severity, number>>): string {
  const lines: string[] = []
  lines.push(`# Calculations & Invoices Audit — ${today()}`)
  lines.push("")
  lines.push(
    "Read-only sweep across every calculation domain (invoices, unit conversion, recipe cost, COGS materialization, Otter sales, P&L aggregation, ingredient matching). Every finding is tagged **CRITICAL** (material dollar impact), **WARNING** (unexplained drift or stale-but-live), or **INFO** (rounding noise — aggregated, not listed). No data was mutated."
  )
  lines.push("")

  // ── Executive summary ────────────────────────────────────────────
  lines.push("## Executive summary")
  lines.push("")
  lines.push("| Domain | Critical | Warning | Info |")
  lines.push("| --- | ---: | ---: | ---: |")
  const totals: Record<Severity, number> = { CRITICAL: 0, WARNING: 0, INFO: 0 }
  for (const [domain, counts] of domainCounts) {
    lines.push(`| ${domain} | ${counts.CRITICAL} | ${counts.WARNING} | ${counts.INFO} |`)
    totals.CRITICAL += counts.CRITICAL
    totals.WARNING += counts.WARNING
    totals.INFO += counts.INFO
  }
  lines.push(`| **Total** | **${totals.CRITICAL}** | **${totals.WARNING}** | **${totals.INFO}** |`)
  lines.push("")

  // ── Per-domain sections ─────────────────────────────────────────
  const byDomain = new Map<string, Finding[]>()
  for (const f of findings) {
    const list = byDomain.get(f.domain) ?? []
    list.push(f)
    byDomain.set(f.domain, list)
  }

  for (const [domain, list] of byDomain) {
    lines.push(`## ${domain}`)
    lines.push("")
    list.sort((a, b) => {
      const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
      if (s !== 0) return s
      return (b.deltaDollars ?? 0) - (a.deltaDollars ?? 0)
    })

    const byCheck = new Map<string, Finding[]>()
    for (const f of list) {
      const k = `${f.check}`
      const arr = byCheck.get(k) ?? []
      arr.push(f)
      byCheck.set(k, arr)
    }

    for (const [check, arr] of byCheck) {
      lines.push(`### ${check}`)
      lines.push("")
      const critical = arr.filter((f) => f.severity === "CRITICAL")
      const warning = arr.filter((f) => f.severity === "WARNING")
      const info = arr.filter((f) => f.severity === "INFO")

      if (critical.length === 0 && warning.length === 0 && info.length === 0) {
        lines.push("_No findings._")
        lines.push("")
        continue
      }

      if (critical.length > 0) {
        lines.push(`**CRITICAL (${critical.length})**`)
        lines.push("")
        for (const f of critical.slice(0, 25)) {
          lines.push(`- ${f.message}`)
        }
        if (critical.length > 25) lines.push(`- …and ${critical.length - 25} more`)
        lines.push("")
      }
      if (warning.length > 0) {
        lines.push(`**WARNING (${warning.length})**`)
        lines.push("")
        for (const f of warning.slice(0, 15)) {
          lines.push(`- ${f.message}`)
        }
        if (warning.length > 15) lines.push(`- …and ${warning.length - 15} more (see JSON)`)
        lines.push("")
      }
      if (info.length > 0) {
        lines.push(`INFO: ${info.length} finding(s) grouped (rounding noise; see JSON for detail).`)
        lines.push("")
      }
    }
  }

  // ── Appendix: fix-order suggestion ─────────────────────────────
  lines.push("## Appendix: suggested fix order")
  lines.push("")
  lines.push(
    "1. **Structural critical issues first** — cycle_detected, period_bucket_alignment, tax_remitted_exceeds_collected. These break invariants that downstream code relies on."
  )
  lines.push(
    "2. **High-dollar header↔lines and orphan menu items** — both directly distort the numbers users see on the dashboard."
  )
  lines.push(
    "3. **Stale canonical costs + sku ambiguity** — correctness leaks into every recipe, P&L, and COGS read until resolved."
  )
  lines.push(
    "4. **Unit conversion gaps (cross-category)** — each one breaks ALL recipes using that ingredient; fix these before chasing individual recipe drift."
  )
  lines.push(
    "5. **Recipe override drift** — usually downstream of costs being wrong, not the other way round. Often resolves itself after canonical-cost fixes."
  )
  lines.push("")
  lines.push(
    `_Generated by \`pnpm tsx scripts/audit/run.ts\` on ${today()}. Re-run after any fix to verify — the runner is idempotent except for date-sensitive freshness checks._`
  )
  lines.push("")

  return lines.join("\n")
}

async function main() {
  const runners = await loadRunners()
  const all: Finding[] = []
  const domainCounts = new Map<string, Record<Severity, number>>()

  for (const r of runners) {
    const startedAt = Date.now()
    console.error(`▶ ${r.name} …`)
    let findings: Finding[]
    try {
      findings = await r.run()
    } catch (e) {
      console.error(`  ✗ ${r.name} threw:`, e)
      findings = [
        {
          domain: r.name,
          check: "audit_error",
          severity: "CRITICAL",
          message: `${r.name} audit threw: ${String(e).slice(0, 300)}`,
          details: { error: String(e) },
        },
      ]
    }
    const counts: Record<Severity, number> = { CRITICAL: 0, WARNING: 0, INFO: 0 }
    for (const f of findings) counts[f.severity]++
    domainCounts.set(r.name, counts)
    all.push(...findings)
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.error(`  ${r.name}: ${findings.length} findings (crit=${counts.CRITICAL} warn=${counts.WARNING} info=${counts.INFO}) — ${elapsed}s`)
  }

  const outDir = path.resolve(process.cwd(), "docs/audits")
  fs.mkdirSync(outDir, { recursive: true })
  const base = `${today()}-calculations-audit`
  const mdPath = path.join(outDir, `${base}.md`)
  const jsonPath = path.join(outDir, `${base}.json`)

  const md = renderReport(all, domainCounts)
  fs.writeFileSync(mdPath, md)
  fs.writeFileSync(jsonPath, JSON.stringify(all, null, 2))

  console.error("")
  console.error(`✓ report  → ${path.relative(process.cwd(), mdPath)}`)
  console.error(`✓ raw     → ${path.relative(process.cwd(), jsonPath)}`)
  console.error("")
  const totalCrit = [...domainCounts.values()].reduce((a, b) => a + b.CRITICAL, 0)
  const totalWarn = [...domainCounts.values()].reduce((a, b) => a + b.WARNING, 0)
  console.error(`TOTAL: ${all.length} findings  crit=${totalCrit} warn=${totalWarn}`)
  // unused imports touched for lint clarity
  void money
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
