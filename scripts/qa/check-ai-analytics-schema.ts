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

  const enumRows = await prisma.$queryRawUnsafe<{ enumlabel: string }[]>(
    `SELECT enumlabel FROM pg_enum e
     JOIN pg_type t ON e.enumtypid = t.oid
     WHERE t.typname = 'AiAnalyticsRunStatus'
     ORDER BY e.enumsortorder`,
  )
  console.log("AiAnalyticsRunStatus enum values:")
  for (const r of enumRows) console.log(`  - ${r.enumlabel}`)

  const required = ["QUEUED", "PROMPT_READY", "GENERATED"]
  const missing = required.filter((v) => !enumRows.some((r) => r.enumlabel === v))
  if (missing.length) console.log(`\n[!] MISSING enum values: ${missing.join(", ")}`)
  else console.log("\n[ok] All new enum values present.")

  const cols = await prisma.$queryRawUnsafe<{ column_name: string; data_type: string; is_nullable: string }[]>(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_name = 'AiAnalyticsRun' ORDER BY ordinal_position`,
  )
  console.log("\nAiAnalyticsRun columns:")
  for (const c of cols) console.log(`  ${c.column_name}: ${c.data_type} (nullable=${c.is_nullable})`)

  const requiredCols = ["systemPrompt", "userPrompt", "sourceSnapshot", "generatorPayload"]
  const missingCols = requiredCols.filter((c) => !cols.some((col) => col.column_name === c))
  if (missingCols.length) console.log(`\n[!] MISSING columns: ${missingCols.join(", ")}`)
  else console.log("\n[ok] All new columns present.")

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
