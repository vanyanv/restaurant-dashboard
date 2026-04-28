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
 * Pass run IDs as CLI args. With no args, deletes FAILED runs with zero
 * insights from the last hour (likely test artifacts from a recent QA pass).
 */
async function main() {
  const { prisma } = await import("../../src/lib/prisma")
  const ids = process.argv.slice(2)

  const where = ids.length > 0
    ? { id: { in: ids } }
    : {
        status: "FAILED" as const,
        insightCount: 0,
        startedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      }

  const found = await prisma.aiAnalyticsRun.findMany({
    where,
    select: { id: true, status: true, route: true, scope: true, insightCount: true, startedAt: true },
  })
  console.log(`Found ${found.length} runs:`)
  for (const r of found) console.log(`  ${r.id} ${r.route} ${r.scope} ${r.status} insights=${r.insightCount} startedAt=${r.startedAt.toISOString()}`)

  if (found.length === 0) { await prisma.$disconnect(); return }

  const r = await prisma.aiAnalyticsRun.deleteMany({ where })
  console.log(`Deleted ${r.count} runs.`)
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
