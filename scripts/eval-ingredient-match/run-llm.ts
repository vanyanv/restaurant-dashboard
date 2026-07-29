/**
 * Task-6 LLM adjudicator bake-off runner. Runs vector-only once to establish
 * the fixed ship-gate split (auto-links vs. abstention pool), then calls each
 * requested model exactly once over the whole pool, storing every raw
 * response to disk before any analysis — so the analysis can be re-run later
 * from stored data without spending again.
 *
 * Read-only against the database. Never calls recordAiUsage (would write
 * AiUsageEvent). Budget guard: prints estimated cost before each call, prints
 * actual cost after, and refuses to start a further arm once actual spend
 * for any single arm has exceeded $0.50 or cumulative spend nears $4.50.
 *
 * Usage:
 *   npx tsx scripts/eval-ingredient-match/run-llm.ts
 *   npx tsx scripts/eval-ingredient-match/run-llm.ts --models gpt-4.1-mini,o4-mini
 */

import { resolve } from "node:path"
import { mkdir, writeFile } from "node:fs/promises"

import { buildGoldSet, loadEnvLocal, type GoldCase } from "./gold"
import { vectorOnlyArm } from "./arms"
import { analyzeGroupedKFold } from "./holdout-analysis"
import { splitPool, buildAdjudicatorCases } from "./llm-pool"
import { callAdjudicatorModelOnce } from "./llm-call"
import { resolveLlmResults, countDuplicateDraftIds } from "./llm-resolve"
import { computeCalibration } from "./llm-calibration"
import { analyzeLlmGroupedKFold, computeFixedTauSensitivity } from "./llm-kfold"
import { estimateCostUsd } from "./llm-pricing"
import { writeLlmReport, timestampForFilename, type LlmArmRun } from "./llm-report"
import { excludeDisputed, excludeDisputedCases } from "./disputed-labels"

const ARM_ORDER = ["gpt-5.4-nano", "gpt-4.1-mini", "gpt-5.4-mini", "o4-mini", "gpt-5.5"]
const PER_ARM_CAP_USD = 0.5
const CUMULATIVE_CAP_USD = 4.5
const SHORTLIST_FOR_LLM = 5

async function main() {
  await loadEnvLocal()
  const requested = parseModelsArg(process.argv.slice(2))
  const models = requested.length > 0 ? requested : ARM_ORDER

  console.log("Building gold set...")
  const gold = await buildGoldSet()
  console.log(`Gold cases: ${gold.cases.length} (excluded=${gold.excluded}, pantry=${gold.pantrySize}, conflicts=${gold.conflicts.length})`)
  const caseIndex = new Map<string, GoldCase>(gold.cases.map((c) => [c.id, c]))

  const { prisma } = await import("../../src/lib/prisma")
  const distinctAccounts = await prisma.canonicalIngredientEmbedding.findMany({
    distinct: ["accountId"],
    select: { accountId: true },
  })
  if (distinctAccounts.length !== 1) {
    console.error(`Expected exactly one account, found ${distinctAccounts.length}.`)
    process.exit(1)
  }
  const ctx = { prisma, accountId: distinctAccounts[0].accountId }

  console.log("\nRunning vector-only to establish the fixed ship-gate split...")
  const vectorResults = await vectorOnlyArm.resolve(gold.cases, ctx)

  // Ship gate: the cross-fold MEDIAN gate from the grouped k-fold analysis —
  // one shared (HIGH, MARGIN) applied uniformly to the whole gold set, not a
  // per-fold value (which has no single meaning outside its own fold). This
  // is the natural choice for "vector-only at its ship gate" as a single
  // fixed production policy: it is the value holdout-analysis.ts's own
  // docstring describes as answering "where does the whole gold set sit at
  // one shared threshold" — exactly what's needed to split ALL 255 cases
  // into auto vs. abstain in one consistent pass, not just fold-tuning
  // portions. See task-6-report.md for the full rationale and the
  // alternative (full-sample bestZeroErrorRow) considered and rejected as
  // more overfit to this exact sample.
  const kfoldMedian = analyzeGroupedKFold(gold.cases, vectorResults, "median")
  const gate = kfoldMedian.sharedGate ?? { high: 0.72, margin: 0.1 }
  console.log(`Ship gate: HIGH=${gate.high.toFixed(2)}, MARGIN=${gate.margin.toFixed(2)}`)

  const split = splitPool(vectorResults, gate)
  const vectorFixedAuto = [...split.vectorAutoCorrect, ...split.vectorAutoWrong]
  console.log(
    `Vector fixed auto-links: ${vectorFixedAuto.length}/${gold.cases.length} ` +
      `(${split.vectorAutoCorrect.length} correct, ${split.vectorAutoWrong.length} wrong). Pool: ${split.poolResults.length}.`,
  )

  const adjudicatorCases = buildAdjudicatorCases(split.poolResults, caseIndex)
  // Dynamic import: same DATABASE_URL-at-module-eval ordering hazard as
  // llm-call.ts — see its header comment.
  const { buildAdjudicatorPrompt } = await import("../../src/lib/ingredient-match-llm")
  const prompt = buildAdjudicatorPrompt({ cases: adjudicatorCases })
  console.log(`Prompt length: ${prompt.length} chars for ${adjudicatorCases.length} pool cases.`)

  const startedAt = new Date()
  const rawDir = resolve(process.cwd(), "scripts/eval-ingredient-match/runs/llm-raw")
  await mkdir(rawDir, { recursive: true })

  const armRuns: LlmArmRun[] = []
  let cumulativeSpend = 0
  let stopped = false

  for (const model of models) {
    if (stopped) {
      console.log(`\nSkipping ${model} — budget guard tripped on a prior arm.`)
      continue
    }
    const estimatedCostUsd = estimateCostUsd(model, prompt, adjudicatorCases.length * 130)
    console.log(`\nCalling ${model} (${adjudicatorCases.length} cases)... estimated cost ~$${estimatedCostUsd.toFixed(4)}`)

    const callResult = await callAdjudicatorModelOnce(model, adjudicatorCases)
    console.log(
      callResult.error
        ? `  FAILED: ${callResult.error}`
        : `  actual cost $${callResult.costUsd.toFixed(4)} (${callResult.inputTokens} in / ${callResult.outputTokens} out), ` +
            `${callResult.drafts.length} drafts returned, ${(callResult.durationMs / 1000).toFixed(1)}s`,
    )

    await writeFile(
      resolve(rawDir, `${timestampForFilename(startedAt)}-${model}.json`),
      JSON.stringify(
        {
          model,
          poolCaseIds: adjudicatorCases.map((c) => c.caseId),
          rawContent: callResult.rawContent,
          drafts: callResult.drafts,
          inputTokens: callResult.inputTokens,
          outputTokens: callResult.outputTokens,
          cachedTokens: callResult.cachedTokens,
          costUsd: callResult.costUsd,
          durationMs: callResult.durationMs,
          error: callResult.error,
        },
        null,
        2,
      ),
      "utf-8",
    )

    cumulativeSpend += callResult.costUsd
    if (callResult.costUsd > PER_ARM_CAP_USD) {
      console.error(`  *** BUDGET GUARD: ${model} cost $${callResult.costUsd.toFixed(4)} > $${PER_ARM_CAP_USD} per-arm cap. Stopping further arms. ***`)
      stopped = true
    }
    if (cumulativeSpend > CUMULATIVE_CAP_USD) {
      console.error(`  *** BUDGET GUARD: cumulative spend $${cumulativeSpend.toFixed(4)} > $${CUMULATIVE_CAP_USD}. Stopping further arms. ***`)
      stopped = true
    }

    const poolResults = resolveLlmResults(split.poolResults, callResult.drafts, caseIndex, SHORTLIST_FOR_LLM)
    const duplicateDraftCount = countDuplicateDraftIds(callResult.drafts)
    const calibration = computeCalibration(poolResults)
    const kfold =
      poolResults.length > 0
        ? analyzeLlmGroupedKFold(gold.cases, split.vectorAutoCorrect, split.vectorAutoWrong, poolResults)
        : null

    const casesExcl = excludeDisputedCases(gold.cases)
    const vectorCorrectExcl = excludeDisputed(split.vectorAutoCorrect)
    const vectorWrongExcl = excludeDisputed(split.vectorAutoWrong)
    const poolResultsExcl = excludeDisputed(poolResults)
    const kfoldExcludingDisputed =
      poolResultsExcl.length > 0 ? analyzeLlmGroupedKFold(casesExcl, vectorCorrectExcl, vectorWrongExcl, poolResultsExcl) : null

    const fixedTauSensitivity = kfold
      ? computeFixedTauSensitivity(split.vectorAutoCorrect, split.vectorAutoWrong, poolResults, kfold.folds)
      : null
    const fixedTauSensitivityExcludingDisputed = kfoldExcludingDisputed
      ? computeFixedTauSensitivity(vectorCorrectExcl, vectorWrongExcl, poolResultsExcl, kfoldExcludingDisputed.folds)
      : null

    armRuns.push({
      model,
      callResult,
      poolResults,
      calibration,
      duplicateDraftCount,
      kfold,
      kfoldExcludingDisputed,
      fixedTauSensitivity,
      fixedTauSensitivityExcludingDisputed,
      estimatedCostUsd,
    })
  }

  const casesExclTop = excludeDisputedCases(gold.cases)
  const vectorFixedExclTop = excludeDisputed(vectorFixedAuto)

  const outPath = resolve(process.cwd(), "scripts/eval-ingredient-match/runs", `${timestampForFilename(startedAt)}-llm.md`)
  await writeLlmReport(outPath, {
    gate,
    totalGoldCases: gold.cases.length,
    poolSize: split.poolResults.length,
    vectorFixedAutoCount: vectorFixedAuto.length,
    vectorFixedCorrect: split.vectorAutoCorrect.length,
    vectorFixedWrong: split.vectorAutoWrong.length,
    vectorFixedWrongCases: split.vectorAutoWrong,
    totalGoldCasesExcludingDisputed: casesExclTop.length,
    vectorFixedAutoCountExcludingDisputed: vectorFixedExclTop.length,
    armRuns,
    caseIndex,
    startedAt,
  })

  console.log(`\nDone. Total spend: $${cumulativeSpend.toFixed(4)}`)
  console.log(`Report: ${outPath}`)
}

function parseModelsArg(argv: string[]): string[] {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--models") {
      const val = argv[i + 1]
      if (!val) return []
      return val.split(",").map((s) => s.trim()).filter(Boolean)
    }
  }
  return []
}

main().catch((err) => {
  console.error("LLM bake-off crashed:", err)
  process.exit(1)
})
