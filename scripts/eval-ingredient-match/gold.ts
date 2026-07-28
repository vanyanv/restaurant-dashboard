/**
 * Gold-set builder for the ingredient auto-match evaluation.
 *
 * Builds an answer key of (vendor, sku-or-name) -> canonical ingredient from
 * invoice line items a human already confirmed (via sku match or a manual
 * alias). A later eval harness (scripts/eval-ingredient-match/run.ts) runs
 * candidate matching strategies against this set and reports precision and
 * coverage.
 *
 * Read-only. Never writes, never migrates.
 *
 * Usage:
 *   npx tsx scripts/eval-ingredient-match/gold.ts --summary
 */

import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { normalizeVendorName } from "../../src/lib/vendor-normalize"

export type GoldCase = {
  /** Stable across runs: normalized vendor + sku-or-name. */
  id: string
  vendorName: string
  sku: string | null
  productName: string
  unit: string | null
  expectedCanonicalId: string
  expectedCanonicalName: string
  source: "sku" | "alias"
  occurrences: number
}

type RawRow = {
  vendorName: string
  sku: string | null
  productName: string
  unit: string | null
  canonicalIngredientId: string
  canonicalName: string
  matchSource: string | null
  occurrences: number
}

/** Copied verbatim from scripts/eval-chat/run.ts:253-274 (.env.local is not auto-loaded outside Next). */
export async function loadEnvLocal(): Promise<void> {
  try {
    const raw = await readFile(resolve(process.cwd(), ".env.local"), "utf-8")
    for (const line of raw.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (value && process.env[key] === undefined) process.env[key] = value
    }
  } catch {
    // Optional file; fall through to existing environment.
  }
}

export type BuildGoldSetResult = {
  cases: GoldCase[]
  /** Rows before dedup dropped because productName leaks into the target's own embedding text. */
  excluded: number
  /** CanonicalIngredient row count — the pantry the matcher must choose from. */
  pantrySize: number
  /** Distinct (vendor, sku, productName) -> canonical pairs before exclusion/dedup. */
  totalPairsBeforeExclusion: number
  /** ids that mapped to more than one distinct canonical and were dropped as unscoreable. */
  conflicts: Array<{ id: string; canonicals: string[]; occurrences: number }>
}

export async function buildGoldSet(): Promise<BuildGoldSetResult> {
  await loadEnvLocal()
  // Dynamic import: prisma.ts reads process.env.DATABASE_URL at module-eval
  // time, so it must load after loadEnvLocal() has populated process.env —
  // a static top-level import would be hoisted ahead of that.
  const { prisma } = await import("../../src/lib/prisma")

  // Grouping key is (vendor, sku, productName) -> canonical, per the brief's
  // definition of "distinct pairs." `unit` is NOT part of the grouping key —
  // the same (vendor, sku, productName) occasionally carries a differently
  // recorded unit across invoices (e.g. "CS" vs "SCS"), and grouping on it
  // too inflates the distinct-pair count (486 -> 490, verified against the
  // 2026-07-28 measurement). MODE() picks the most-frequent unit per group
  // as the representative, consistent with how duplicate ids are collapsed
  // in the id-grouping step below.
  const rows = await prisma.$queryRawUnsafe<RawRow[]>(`
    SELECT i."vendorName", li.sku, li."productName",
           MODE() WITHIN GROUP (ORDER BY li.unit) AS unit,
           li."canonicalIngredientId", ci.name AS "canonicalName",
           li."matchSource", COUNT(*)::int AS occurrences
      FROM "InvoiceLineItem" li
      JOIN "Invoice" i ON i.id = li."invoiceId"
      JOIN "CanonicalIngredient" ci ON ci.id = li."canonicalIngredientId"
     WHERE li."canonicalIngredientId" IS NOT NULL
     GROUP BY i."vendorName", li.sku, li."productName",
              li."canonicalIngredientId", ci.name, li."matchSource"
  `)

  const totalPairsBeforeExclusion = rows.length

  // Exclusion: buildCanonicalIngredientText folds alias rawNames into the
  // canonical's embedding text. A gold case whose productName is itself an
  // alias rawName would be scored against text containing its own answer.
  const aliasNames = new Set(
    (await prisma.ingredientAlias.findMany({ select: { rawName: true } })).map(
      (a) => a.rawName.trim().toLowerCase(),
    ),
  )
  const kept = rows.filter((r) => !aliasNames.has(r.productName.trim().toLowerCase()))
  const excluded = rows.length - kept.length

  const pantrySize = await prisma.canonicalIngredient.count()

  // Normalize vendor, build stable ids, collapse duplicates.
  type Group = { rows: RawRow[]; vendor: string }
  const groups = new Map<string, Group>()
  for (const r of kept) {
    const vendor = normalizeVendorName(r.vendorName)
    const id = r.sku
      ? `${vendor}::sku::${r.sku}`
      : `${vendor}::name::${r.productName.toLowerCase()}`
    const group = groups.get(id)
    if (group) group.rows.push(r)
    else groups.set(id, { rows: [r], vendor })
  }

  const cases: GoldCase[] = []
  const conflicts: Array<{ id: string; canonicals: string[]; occurrences: number }> = []

  for (const [id, group] of groups) {
    const distinctCanonicals = new Set(group.rows.map((r) => r.canonicalIngredientId))
    if (distinctCanonicals.size > 1) {
      // Ambiguous human data for this vendor+sku-or-name: cannot be fairly
      // scored against a single answer. Drop the whole id and warn.
      const names = [...new Set(group.rows.map((r) => r.canonicalName))]
      conflicts.push({
        id,
        canonicals: names,
        occurrences: group.rows.reduce((sum, r) => sum + r.occurrences, 0),
      })
      continue
    }

    // Single canonical for this id. Multiple raw rows can still collapse
    // here (e.g. same sku with a productName/unit/matchSource variant) —
    // sum occurrences and use the most-frequent row as the representative
    // for descriptive fields.
    const occurrences = group.rows.reduce((sum, r) => sum + r.occurrences, 0)
    const representative = group.rows.reduce((best, r) =>
      r.occurrences > best.occurrences ? r : best,
    )

    const matchSource = representative.matchSource
    if (matchSource !== "sku" && matchSource !== "alias") {
      throw new Error(
        `Unexpected matchSource "${matchSource}" for gold id "${id}" — expected "sku" or "alias".`,
      )
    }

    cases.push({
      id,
      vendorName: group.vendor,
      sku: representative.sku,
      productName: representative.productName,
      unit: representative.unit,
      expectedCanonicalId: representative.canonicalIngredientId,
      expectedCanonicalName: representative.canonicalName,
      source: matchSource,
      occurrences,
    })
  }

  return { cases, excluded, pantrySize, totalPairsBeforeExclusion, conflicts }
}

async function main() {
  const args = process.argv.slice(2)
  const summary = args.includes("--summary")

  const result = await buildGoldSet()

  if (summary) {
    console.log(`Total distinct pairs before exclusion: ${result.totalPairsBeforeExclusion}`)
    console.log(`Excluded (alias leakage): ${result.excluded}`)
    console.log(`Pantry size (CanonicalIngredient rows): ${result.pantrySize}`)
    console.log(`Gold cases: ${result.cases.length}`)
    console.log(
      `  source=sku: ${result.cases.filter((c) => c.source === "sku").length}, ` +
        `source=alias: ${result.cases.filter((c) => c.source === "alias").length}`,
    )
    console.log(`Conflicts dropped (id -> >1 canonical): ${result.conflicts.length}`)
    for (const c of result.conflicts) {
      console.log(`  ${c.id} -> [${c.canonicals.join(", ")}] (${c.occurrences} occurrences)`)
    }
  } else {
    console.log(JSON.stringify(result, null, 2))
  }
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.url.replace("file://", ""))
if (isMainModule) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
