import fs from "fs"
import path from "path"

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[key]) {
      process.env[key] = val
    }
  }
}
loadEnvLocal()

const useChat = process.argv.includes("--chat")
if (useChat) {
  process.env.DATABASE_URL = process.env.DATABASE_URL2
}

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  const jobRunIdx = await prisma.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
    "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'JobRun' ORDER BY indexname"
  )
  const otterOrderIdx = await prisma.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
    "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'OtterOrder' ORDER BY indexname"
  )
  console.log(`=== ${useChat ? "DATABASE_URL2 (chat)" : "DATABASE_URL (primary)"} ===`)
  console.log("\nJobRun indexes:")
  for (const r of jobRunIdx) console.log(`  ${r.indexname}\n    ${r.indexdef}`)
  console.log("\nOtterOrder indexes:")
  for (const r of otterOrderIdx) console.log(`  ${r.indexname}\n    ${r.indexdef}`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
