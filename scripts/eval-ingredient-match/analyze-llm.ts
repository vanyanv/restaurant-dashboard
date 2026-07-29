/**
 * Re-run the LLM bake-off ANALYSIS from already-stored raw responses in
 * runs/llm-raw/ — no OpenAI calls, no spend. Exists specifically so a bug
 * found in the analysis/report code (as happened here: llm-kfold.ts's
 * pooled "correct"/"precision" figures were computed from a stale field —
 * see the comment on `fixedVectorForFold` in llm-kfold.ts) can be fixed and
 * re-verified without re-spending on the models. Recomputes vector-only
 * (cheap — embeddings only, no chat-completion spend) to reconstruct the
 * fixed auto-link/pool split, then asserts the freshly computed pool matches
 * the pool the stored responses were actually generated against before
 * trusting them — if OpenAI embedding drift (documented ~0.0017 run-to-run
 * in task-4-report.md) ever moved a case across the gate, this refuses to
 * silently produce a mismatched report.
 *
 * Usage:
 *   npx tsx scripts/eval-ingredient-match/analyze-llm.ts --prefix 2026-07-28-1646
 */

import { resolve } from "node:path"
import { readdir, readFile } from "node:fs/promises"

import { buildGoldSet, loadEnvLocal, type GoldCase } from "./gold"
import { vectorOnlyArm } from "./arms"
import { analyzeGroupedKFold } from "./holdout-analysis"
import { splitPool, buildAdjudicatorCases } from "./llm-pool"
import { resolveLlmResults } from "./llm-resolve"
import { computeCalibration } from "./llm-calibration"
import { analyzeLlmGroupedKFold } from "./llm-kfold"
import { writeLlmReport, type LlmArmRun } from "./llm-report"
import type { LlmCallResult } from "./llm-call"
import type { AdjudicatorDraft } from "../../src/lib/ingredient-match-llm"

type StoredRaw = {
  model: string
  poolCaseIds: string[]
  rawContent: string | null
  drafts: AdjudicatorDraft[]
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  costUsd: number
  durationMs: number
  error: string | null
}

async function main() {
  const prefix = parsePrefixArg(process.argv.slice(2))
  if (!prefix) {
    console.error("Usage: analyze-llm.ts --prefix <timestamp-prefix, e.g. 2026-07-28-1646>")
    process.exit(1)
  }

  await loadEnvLocal()
  const gold = await buildGoldSet()
  console.log(`Gold cases: ${gold.cases.length} (excluded=${gold.excluded}, pantry=${gold.pantrySize}, conflicts=${gold.conflicts.length})`)
  const caseIndex = new Map<string, GoldCase>(gold.cases.map((c) => [c.id, c]))

  const { prisma } = await import("../../src/lib/prisma")
  const distinctAccounts = await prisma.canonicalIngredientEmbedding.findMany({
    distinct: ["accountId"],
    select: { accountId: true },
  })
  const ctx = { prisma, accountId: distinctAccounts[0].accountId }

  console.log("Recomputing vector-only (embeddings only, no chat-completion spend)...")
  const vectorResults = await vectorOnlyArm.resolve(gold.cases, ctx)
  const kfoldMedian = analyzeGroupedKFold(gold.cases, vectorResults, "median")
  const gate = kfoldMedian.sharedGate ?? { high: 0.72, margin: 0.1 }
  const split = splitPool(vectorResults, gate)
  const freshPoolIds = new Set(split.poolResults.map((r) => r.caseId))
  console.log(
    `Gate HIGH=${gate.high.toFixed(2)}, MARGIN=${gate.margin.toFixed(2)} — vector fixed auto ${split.vectorAutoCorrect.length + split.vectorAutoWrong.length}` +
      ` (${split.vectorAutoCorrect.length} correct, ${split.vectorAutoWrong.length} wrong), pool ${split.poolResults.length}`,
  )

  const rawDir = resolve(process.cwd(), "scripts/eval-ingredient-match/runs/llm-raw")
  const files = (await readdir(rawDir)).filter((f) => f.startsWith(`${prefix}-`) && f.endsWith(".json"))
  if (files.length === 0) {
    console.error(`No raw files found matching ${prefix}-*.json in ${rawDir}`)
    process.exit(1)
  }

  const armRuns: LlmArmRun[] = []
  let anyMismatch = false

  for (const file of files.sort()) {
    const raw: StoredRaw = JSON.parse(await readFile(resolve(rawDir, file), "utf-8"))
    const storedIds = new Set(raw.poolCaseIds)
    const symmetricDiff =
      [...storedIds].filter((id) => !freshPoolIds.has(id)).length + [...freshPoolIds].filter((id) => !storedIds.has(id)).length
    if (symmetricDiff > 0) {
      console.error(
        `  MISMATCH for ${raw.model}: stored pool (${storedIds.size}) differs from freshly computed pool ` +
          `(${freshPoolIds.size}) by ${symmetricDiff} case(s) — likely embedding drift moved a case across the gate. ` +
          "Using the STORED pool ids for this arm's analysis, not the fresh recomputation.",
      )
      anyMismatch = true
    }

    // Reconstruct exactly the pool the model actually saw, from stored ids —
    // authoritative over the freshly recomputed pool if they ever disagree.
    const poolForThisArm = split.poolResults.filter((r) => storedIds.has(r.caseId))

    const callResult: LlmCallResult = {
      model: raw.model,
      cases: buildAdjudicatorCases(poolForThisArm, caseIndex),
      prompt: "(not persisted — see runs/llm-raw for the raw response; prompt is reconstructible via buildAdjudicatorPrompt)",
      rawContent: raw.rawContent,
      drafts: raw.drafts,
      inputTokens: raw.inputTokens,
      outputTokens: raw.outputTokens,
      cachedTokens: raw.cachedTokens,
      costUsd: raw.costUsd,
      durationMs: raw.durationMs,
      error: raw.error,
    }

    const poolResults = resolveLlmResults(poolForThisArm, raw.drafts, caseIndex, 5)
    const calibration = computeCalibration(poolResults)
    const kfold =
      poolResults.length > 0
        ? analyzeLlmGroupedKFold(gold.cases, split.vectorAutoCorrect, split.vectorAutoWrong, poolResults)
        : null

    armRuns.push({ model: raw.model, callResult, poolResults, calibration, kfold, estimatedCostUsd: raw.costUsd })
    console.log(`  ${raw.model}: ${raw.drafts.length} drafts, cost $${raw.costUsd.toFixed(4)} (from disk, not re-spent)`)
  }

  if (anyMismatch) {
    console.log("\nNote: pool mismatches were detected and handled per-arm using stored ids — see warnings above.")
  }

  const outPath = resolve(process.cwd(), "scripts/eval-ingredient-match/runs", `${prefix}-llm.md`)
  await writeLlmReport(outPath, {
    gate,
    totalGoldCases: gold.cases.length,
    poolSize: split.poolResults.length,
    vectorFixedAutoCount: split.vectorAutoCorrect.length + split.vectorAutoWrong.length,
    vectorFixedCorrect: split.vectorAutoCorrect.length,
    vectorFixedWrong: split.vectorAutoWrong.length,
    vectorFixedWrongCases: split.vectorAutoWrong,
    armRuns,
    caseIndex,
    startedAt: new Date(),
  })

  console.log(`\nRegenerated (no spend): ${outPath}`)
}

function parsePrefixArg(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--prefix") return argv[i + 1] ?? null
  }
  return null
}

main().catch((err) => {
  console.error("Analysis re-run crashed:", err)
  process.exit(1)
})
