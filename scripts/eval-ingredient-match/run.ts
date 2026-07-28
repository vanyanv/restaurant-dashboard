/**
 * Eval runner for the ingredient auto-match bake-off. Free arms first: they
 * cost nothing, and if vector-only clears the zero-error gate at useful
 * coverage, the LLM-adjudicator layer never needs to be built.
 *
 * Read-only against the live Neon database — no writes, no migrations.
 *
 * Usage:
 *   npm run eval:ingredient-match
 *   npm run eval:ingredient-match -- --arms token-overlap,vector-only
 *   npm run eval:ingredient-match -- --arms vector-only,vector-productname-only
 */

import { resolve } from "node:path"

import { buildGoldSet, loadEnvLocal } from "./gold"
import { vectorOnlyArm, vectorProductNameOnlyArm, sweepThresholds, type Arm, type ArmContext, type ArmResult } from "./arms"
import { tokenOverlapArm } from "./token-overlap-arm"
import { writeReport, timestampForFilename, type ArmRun } from "./report"

const ARMS: Record<string, Arm> = {
  "token-overlap": tokenOverlapArm,
  "vector-only": vectorOnlyArm,
  "vector-productname-only": vectorProductNameOnlyArm,
}

async function main() {
  await loadEnvLocal()

  const requested = parseArmsArg(process.argv.slice(2))
  for (const name of requested) {
    if (!ARMS[name]) {
      console.error(`Unknown arm: "${name}". Known arms: ${Object.keys(ARMS).join(", ")}`)
      process.exit(1)
    }
  }
  const selected = requested.length > 0 ? requested : Object.keys(ARMS)

  console.log("Building gold set...")
  const gold = await buildGoldSet()
  console.log(
    `Gold cases: ${gold.cases.length} (excluded=${gold.excluded}, pantry=${gold.pantrySize}, ` +
      `conflicts=${gold.conflicts.length})`,
  )
  if (gold.cases.length === 0) {
    console.error("Gold set is empty — nothing to evaluate. Aborting.")
    process.exit(1)
  }

  // Dynamic import: prisma.ts reads process.env.DATABASE_URL at module-eval
  // time, so it must load after loadEnvLocal() has populated process.env.
  const { prisma } = await import("../../src/lib/prisma")

  // Assert single-tenant, not just "a row exists": findFirst() alone would
  // silently pick an arbitrary account if the table ever holds more than
  // one, and every arm in this harness assumes a single accountId scopes
  // the whole pantry.
  const distinctAccounts = await prisma.canonicalIngredientEmbedding.findMany({
    distinct: ["accountId"],
    select: { accountId: true },
  })
  if (distinctAccounts.length === 0) {
    console.error(
      "No CanonicalIngredientEmbedding rows found — cannot resolve accountId for the vector search. " +
        "Run the ingredient embedding sync first.",
    )
    process.exit(1)
  }
  if (distinctAccounts.length > 1) {
    console.error(
      `Expected exactly one account in CanonicalIngredientEmbedding, found ${distinctAccounts.length}: ` +
        `${distinctAccounts.map((a) => a.accountId).join(", ")}. This harness assumes single-tenant scope — ` +
        "extend it to take --account before running against multi-account data.",
    )
    process.exit(1)
  }
  const ctx: ArmContext = { prisma, accountId: distinctAccounts[0].accountId }

  const startedAt = new Date()
  const startMs = Date.now()
  const armRuns: ArmRun[] = []

  for (const name of selected) {
    const arm = ARMS[name]
    console.log(`\nRunning arm: ${arm.name} (${gold.cases.length} cases)...`)
    const t0 = Date.now()
    const results: ArmResult[] = await arm.resolve(gold.cases, ctx)
    console.log(`  resolved in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

    const sweep = sweepThresholds(results)
    const autoCount = results.filter((r) => r.decision === "auto").length
    const wrongCount = results.filter((r) => r.decision === "auto" && r.correct === false).length
    console.log(
      `  default policy: ${autoCount}/${results.length} auto-linked, ${wrongCount} wrong`,
    )

    armRuns.push({ arm, results, sweep })
  }

  const totalMs = Date.now() - startMs

  const outPath = resolve(process.cwd(), "scripts/eval-ingredient-match/runs", `${timestampForFilename(startedAt)}.md`)
  await writeReport(outPath, { gold, armRuns, startedAt, totalMs })

  console.log(`\nDone in ${(totalMs / 1000).toFixed(1)}s.`)
  console.log(`Report: ${outPath}`)
}

function parseArmsArg(argv: string[]): string[] {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--arms") {
      const val = argv[i + 1]
      if (!val) return []
      return val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    }
    if (argv[i] === "--help" || argv[i] === "-h") {
      printUsage()
      process.exit(0)
    }
  }
  return []
}

function printUsage() {
  console.log(`Usage: tsx scripts/eval-ingredient-match/run.ts [options]
  --arms <a,b,...>   Comma-separated arm names to run (default: all). Known: ${Object.keys(ARMS).join(", ")}
  --help             Show this help`)
}

main().catch((err) => {
  console.error("Eval harness crashed:", err)
  process.exit(1)
})
