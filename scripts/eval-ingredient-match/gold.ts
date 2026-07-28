/**
 * Gold-set builder for the ingredient auto-match evaluation.
 *
 * Builds an answer key of (vendor, product name) -> canonical ingredient from
 * invoice line items a human already confirmed (via sku match or a manual
 * alias). A later eval harness (scripts/eval-ingredient-match/run.ts) runs
 * candidate matching strategies against this set and reports precision and
 * coverage.
 *
 * The matcher under test resolves a *product name* (plus vendor and unit) to
 * a canonical ingredient — sku matching is a separate deterministic layer
 * this evaluation deliberately does not exercise. So gold cases are keyed on
 * (vendor, normalized product name), NOT (vendor, sku): two differently
 * spelled names for the same sku are two genuinely different test inputs,
 * and collapsing them by sku would throw away exactly the harder cases that
 * decide whether name-based matching is safe to automate. `sku` is still
 * carried as a field for reporting/stratification, just not part of the id.
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
  /** Stable across runs: normalized vendor + normalized product name. */
  id: string
  vendorName: string
  sku: string | null
  productName: string
  unit: string | null
  expectedCanonicalId: string
  expectedCanonicalName: string
  source: "sku" | "alias" | "manual"
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

/** Raw SQL result before unit is resolved to a single deterministic value. */
type RawSqlRow = Omit<RawRow, "unit"> & { units: Array<string | null> }

/**
 * Lexicographic string compare where null sorts after every non-null value.
 * Shared tie-break rule for both the modal-unit picker and the representative
 * row picker below — reproducibility of the answer key depends on a single,
 * consistent, total order that never falls back to array/row order.
 */
function compareNullsLast(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a < b ? -1 : 1
}

/**
 * Deterministic mode: most-frequent *non-null* unit, ties broken by
 * lexicographically smallest unit. Replaces Postgres MODE() WITHIN GROUP,
 * which picks an arbitrary tied value — not safe for a reproducible answer
 * key. Matches MODE()'s null handling: nulls are ignored as candidates and
 * are excluded from the count entirely; the result is null only when every
 * input was null. (An earlier version of this function counted null as an
 * ordinary candidate, which could resolve a group to null even when a real
 * unit had plurality — filtering nulls first fixes that.)
 */
function pickModalUnit(units: Array<string | null>): string | null {
  const nonNull = units.filter((u): u is string => u !== null)
  if (nonNull.length === 0) return null
  const counts = new Map<string, number>()
  for (const u of nonNull) counts.set(u, (counts.get(u) ?? 0) + 1)
  let best: string | null = null
  let bestCount = -1
  for (const [u, count] of counts) {
    if (count > bestCount || (count === bestCount && compareNullsLast(u, best) < 0)) {
      best = u
      bestCount = count
    }
  }
  return best
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
  // 2026-07-28 measurement).
  //
  // `units` collects every raw unit value for the group; `pickModalUnit`
  // below resolves it to one deterministic value. `ORDER BY` is added even
  // though the query is aggregated — Postgres gives no stable row order for
  // an un-ordered GROUP BY (hash aggregation, parallel workers can reorder
  // between runs), and this row order is what the representative-row picker
  // in the id-collapse step below would otherwise depend on for ties. The
  // ORDER BY here uses the raw (non-normalized) vendor string only to pin
  // down row order deterministically — vendor normalization for grouping
  // purposes still happens in JS via normalizeVendorName further down.
  //
  // ORDER BY covers every GROUP BY column except ci.name, which is safe to
  // omit — it's functionally determined by canonicalIngredientId, which IS
  // ordered, so it can't introduce an unordered tie on its own. matchSource
  // is nullable, so it needs NULLS LAST like sku.
  const sqlRows = await prisma.$queryRawUnsafe<RawSqlRow[]>(`
    SELECT i."vendorName", li.sku, li."productName",
           array_agg(li.unit) AS units,
           li."canonicalIngredientId", ci.name AS "canonicalName",
           li."matchSource", COUNT(*)::int AS occurrences
      FROM "InvoiceLineItem" li
      JOIN "Invoice" i ON i.id = li."invoiceId"
      JOIN "CanonicalIngredient" ci ON ci.id = li."canonicalIngredientId"
     WHERE li."canonicalIngredientId" IS NOT NULL
     GROUP BY i."vendorName", li.sku, li."productName",
              li."canonicalIngredientId", ci.name, li."matchSource"
     ORDER BY i."vendorName", li.sku NULLS LAST, li."productName",
              li."canonicalIngredientId", li."matchSource" NULLS LAST
  `)

  const rows: RawRow[] = sqlRows.map((r) => ({
    vendorName: r.vendorName,
    sku: r.sku,
    productName: r.productName,
    unit: pickModalUnit(r.units),
    canonicalIngredientId: r.canonicalIngredientId,
    canonicalName: r.canonicalName,
    matchSource: r.matchSource,
    occurrences: r.occurrences,
  }))

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
  //
  // Keyed on (vendor, normalized product name) UNCONDITIONALLY — never on
  // sku. The matcher under test resolves a name to a canonical; sku match is
  // a separate deterministic layer this evaluation does not exercise. Two
  // spelling variants of the same sku are two distinct test inputs and must
  // not collapse into one gold case. `sku` is still carried on the case for
  // reporting, just not part of the identity.
  type Group = { rows: RawRow[]; vendor: string }
  const groups = new Map<string, Group>()
  for (const r of kept) {
    const vendor = normalizeVendorName(r.vendorName)
    const id = `${vendor}::name::${r.productName.trim().toLowerCase()}`
    const group = groups.get(id)
    if (group) group.rows.push(r)
    else groups.set(id, { rows: [r], vendor })
  }

  const cases: GoldCase[] = []
  const conflicts: Array<{ id: string; canonicals: string[]; occurrences: number }> = []

  for (const [id, group] of groups) {
    const distinctCanonicals = new Set(group.rows.map((r) => r.canonicalIngredientId))
    if (distinctCanonicals.size > 1) {
      // Ambiguous human data for this vendor+name: cannot be fairly scored
      // against a single answer. Drop the whole id and warn.
      const names = [...new Set(group.rows.map((r) => r.canonicalName))]
      conflicts.push({
        id,
        canonicals: names,
        occurrences: group.rows.reduce((sum, r) => sum + r.occurrences, 0),
      })
      continue
    }

    // Single canonical for this id. Multiple raw rows can still collapse
    // here (e.g. exact-cased vs. differently-cased productName text, or the
    // same name reused under a different sku/unit/matchSource) — sum
    // occurrences and use the most-frequent row as the representative for
    // descriptive fields (including which sku to report on the case).
    //
    // Tie-break (equal occurrences) is a deterministic TOTAL order — smaller
    // sku, then smaller productName, then smaller matchSource — never
    // array/row order. Every field consulted uses compareNullsLast so no
    // step can return "equal" without falling through to the next one;
    // matchSource is included because it feeds the emitted `source` field
    // and can co-vary with the resolved `unit`, so it must be covered too,
    // not just the fields used to pick a winner on typical data. Name-keying
    // merges rows across genuinely different skus (unlike the old sku-keyed
    // id, which only ever merged spelling variants of one sku), so a tie now
    // picks between materially different rows; this answer key must be
    // reproducible run-to-run since a zero-error accuracy gate is measured
    // against it.
    const occurrences = group.rows.reduce((sum, r) => sum + r.occurrences, 0)
    const representative = group.rows.reduce((best, r) => {
      if (r.occurrences !== best.occurrences) return r.occurrences > best.occurrences ? r : best
      const skuCmp = compareNullsLast(r.sku, best.sku)
      if (skuCmp !== 0) return skuCmp < 0 ? r : best
      const nameCmp = compareNullsLast(r.productName, best.productName)
      if (nameCmp !== 0) return nameCmp < 0 ? r : best
      const matchSourceCmp = compareNullsLast(r.matchSource, best.matchSource)
      return matchSourceCmp < 0 ? r : best
    })

    // "manual" is a valid matchSource per schema (InvoiceLineItem.matchSource
    // comment) even though today's live data has none (sku=1155, alias=133,
    // null=47, as of the 2026-07-28 measurement) — map it through rather
    // than throwing, so a single manual confirm doesn't crash this builder.
    const matchSource = representative.matchSource
    if (matchSource !== "sku" && matchSource !== "alias" && matchSource !== "manual") {
      throw new Error(
        `Unexpected matchSource "${matchSource}" for gold id "${id}" — expected "sku", "alias", or "manual".`,
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
