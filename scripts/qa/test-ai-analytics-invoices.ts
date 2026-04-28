import fs from "fs"
import path from "path"
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue
    const i = t.indexOf("="); if (i === -1) continue
    const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvLocal()

/**
 * End-to-end exercise of the 3-phase AI analytics pipeline for the INVOICES
 * route, calling the orchestrator functions directly (no HTTP, no cron auth).
 *
 *   Usage: npx tsx scripts/test-ai-analytics-invoices.ts            # rollup
 *          npx tsx scripts/test-ai-analytics-invoices.ts <storeId>  # one store
 */
async function main() {
  const { prisma } = await import("../../src/lib/prisma")
  const { runPhasePrompt, runPhaseGenerate, runPhaseCritique } = await import(
    "../../src/lib/ai-analytics/orchestrator"
  )
  const {
    loadInvoiceSourceData,
    buildInvoiceSystemPrompt,
    buildInvoiceUserPrompt,
    buildInvoiceSourceSummary,
    collectInvoiceEntities,
  } = await import("../../src/lib/ai-analytics/routes/invoices")

  const arg = process.argv[2]
  const isRollup = !arg || arg === "all"
  const storeId = isRollup ? null : arg

  let ownerId: string
  let storeName: string | null = null
  if (storeId) {
    const s = await prisma.store.findUnique({ where: { id: storeId }, select: { ownerId: true, name: true } })
    if (!s) throw new Error(`Store ${storeId} not found`)
    ownerId = s.ownerId
    storeName = s.name
  } else {
    const any = await prisma.store.findFirst({ where: { isActive: true }, select: { ownerId: true } })
    if (!any) throw new Error("No active stores")
    ownerId = any.ownerId
  }

  console.log("============================================================")
  console.log(`Scope: ${isRollup ? "ALL stores" : `STORE ${storeName} (${storeId})`}`)
  console.log(`Owner: ${ownerId}`)
  console.log("============================================================\n")

  // Phase 1
  console.log(">>> Phase 1: PROMPT")
  const t1 = Date.now()
  const phase1 = await runPhasePrompt({
    route: "INVOICES",
    scope: isRollup ? "ALL" : "STORE",
    storeId,
    fetchSourceData: () => loadInvoiceSourceData(storeId, ownerId),
    buildSystemPrompt: buildInvoiceSystemPrompt,
    buildUserPrompt: buildInvoiceUserPrompt,
    buildSourceSummary: buildInvoiceSourceSummary,
    collectAllowedEntities: collectInvoiceEntities,
    materialityThresholdDollars: 250,
    validateEntities: true,
  })
  console.log(`Phase 1 result (${Date.now() - t1}ms):`, phase1)
  if (phase1.status === "FAILED") return

  const run1 = await prisma.aiAnalyticsRun.findUnique({ where: { id: phase1.runId } })
  if (!run1) throw new Error("run not found after phase 1")
  console.log("\n--- systemPrompt (first 200 chars):")
  console.log((run1.systemPrompt ?? "").slice(0, 200) + "…")
  console.log("\n--- userPrompt (full):")
  console.log(run1.userPrompt)
  const snap = run1.sourceSnapshot as { allowedNumbers: { dollars: number[]; percents: number[] }; allowedEntities: string[]; materialityThresholdDollars: number } | null
  console.log("\n--- sourceSnapshot summary:")
  console.log(`  allowedNumbers.dollars: ${snap?.allowedNumbers.dollars.length} values`)
  console.log(`  allowedNumbers.percents: ${snap?.allowedNumbers.percents.length} values`)
  console.log(`  allowedEntities: ${snap?.allowedEntities.length} entities`)
  console.log(`  materialityThresholdDollars: ${snap?.materialityThresholdDollars}`)

  // Phase 2
  console.log("\n>>> Phase 2: GENERATE")
  const t2 = Date.now()
  const phase2 = await runPhaseGenerate(phase1.runId)
  console.log(`Phase 2 result (${Date.now() - t2}ms):`, phase2)

  if (phase2.status === "FAILED") {
    console.log("\n--- Phase 2 failed; calling generator directly to inspect raw LLM output ---")
    const { generateInsights } = await import("../../src/lib/groq")
    const raw = await generateInsights<{ insights: { headline: string; body: string; impactDollars: number | null; severityHint?: string }[] }>({
      systemPrompt: run1.systemPrompt!,
      userPrompt: run1.userPrompt!,
    })
    console.log(`Raw generator returned ${raw.data.insights?.length ?? 0} insights:`)
    for (const ins of raw.data.insights ?? []) {
      console.log(`\n  [${ins.severityHint ?? "?"}] ${ins.headline}`)
      console.log(`    impactDollars=${ins.impactDollars ?? "—"}`)
      console.log(`    body: ${ins.body}`)
    }
    return
  }

  if (phase2.nextStep === "done") {
    if (phase2.status === "OK" && (phase2.candidateCount ?? 0) === 0) {
      console.log("(generator returned 0 candidates — nothing to critique)")
    }
    return
  }

  const run2 = await prisma.aiAnalyticsRun.findUnique({ where: { id: phase1.runId } })
  const generator = run2?.generatorPayload as { candidates: { headline: string; body: string; impactDollars: number | null; severityHint?: string }[]; retryCount: number } | null
  console.log(`\n--- generator candidates (${generator?.candidates.length ?? 0}, retries=${generator?.retryCount ?? 0}):`)
  for (const c of generator?.candidates ?? []) {
    console.log(`  [${c.severityHint ?? "?"}] ${c.headline} | impact=$${c.impactDollars ?? "—"}`)
    console.log(`    ${c.body}`)
  }

  // Phase 3
  console.log("\n>>> Phase 3: CRITIQUE")
  const t3 = Date.now()
  const phase3 = await runPhaseCritique(phase1.runId)
  console.log(`Phase 3 result (${Date.now() - t3}ms):`, phase3)

  const finalRun = await prisma.aiAnalyticsRun.findUnique({
    where: { id: phase1.runId },
    include: { insights: { orderBy: { generatedAt: "asc" } } },
  })
  console.log("\n============================================================")
  console.log(`FINAL RUN ${finalRun?.id}`)
  console.log(`  status: ${finalRun?.status}`)
  console.log(`  insightCount: ${finalRun?.insightCount}`)
  console.log(`  droppedByCritic: ${finalRun?.droppedByCritic}`)
  console.log(`  promptTokens: ${finalRun?.promptTokens}, completionTokens: ${finalRun?.completionTokens}`)
  console.log(`  generatorModel: ${finalRun?.generatorModel}, criticModel: ${finalRun?.criticModel}`)
  console.log(`  errorDetails: ${finalRun?.errorDetails ?? "—"}`)
  console.log("\nPersisted insights:")
  for (const ins of finalRun?.insights ?? []) {
    console.log(`  [${ins.severity}] ${ins.headline} | impact=$${ins.impactDollars ?? "—"}`)
    console.log(`    ${ins.body}`)
  }
  console.log("============================================================")

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
