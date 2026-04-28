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

async function main() {
  const { prisma } = await import("../../src/lib/prisma")
  const { runPhasePrompt, runPhaseGenerate, runPhaseCritique } = await import(
    "../../src/lib/ai-analytics/orchestrator"
  )
  const m = await import("../../src/lib/ai-analytics/routes/menu")

  const arg = process.argv[2]
  const isRollup = !arg || arg === "all"
  const storeId = isRollup ? null : arg

  let ownerId: string
  if (storeId) {
    const s = await prisma.store.findUnique({ where: { id: storeId }, select: { ownerId: true } })
    if (!s) throw new Error(`Store ${storeId} not found`)
    ownerId = s.ownerId
  } else {
    const any = await prisma.store.findFirst({ where: { isActive: true }, select: { ownerId: true } })
    if (!any) throw new Error("No active stores")
    ownerId = any.ownerId
  }

  console.log(`MENU route, scope=${isRollup ? "ALL" : storeId}\n`)

  const t1 = Date.now()
  const phase1 = await runPhasePrompt({
    route: "MENU",
    scope: isRollup ? "ALL" : "STORE",
    storeId,
    fetchSourceData: () => m.loadMenuSourceData(storeId, ownerId),
    buildSystemPrompt: m.buildMenuSystemPrompt,
    buildUserPrompt: m.buildMenuUserPrompt,
    buildSourceSummary: m.buildMenuSourceSummary,
    collectAllowedEntities: m.collectMenuEntities,
    materialityThresholdDollars: 100,
    validateEntities: true,
  })
  console.log(`Phase 1 (${Date.now() - t1}ms):`, phase1)
  if (phase1.status === "FAILED") return

  const run = await prisma.aiAnalyticsRun.findUnique({ where: { id: phase1.runId } })
  console.log("\n--- userPrompt:")
  console.log(run?.userPrompt)

  const t2 = Date.now()
  const phase2 = await runPhaseGenerate(phase1.runId)
  console.log(`\nPhase 2 (${Date.now() - t2}ms):`, phase2)

  if (phase2.nextStep === "critique") {
    const t3 = Date.now()
    const phase3 = await runPhaseCritique(phase1.runId)
    console.log(`\nPhase 3 (${Date.now() - t3}ms):`, phase3)
    const final = await prisma.aiAnalyticsRun.findUnique({
      where: { id: phase1.runId },
      include: { insights: { orderBy: { generatedAt: "asc" } } },
    })
    console.log(`\nFinal status=${final?.status}, ${final?.insights.length} insights:`)
    for (const ins of final?.insights ?? []) {
      console.log(`  [${ins.severity}] ${ins.headline} | impact=$${ins.impactDollars ?? "—"}`)
      console.log(`    ${ins.body}`)
    }
  }

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
