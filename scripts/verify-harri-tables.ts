// One-off: confirm Harri tables exist on the Neon DB after `prisma db push`.
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
    if (!process.env[key]) process.env[key] = val
  }
}
loadEnvLocal()

async function main() {
  const { prisma } = await import("../src/lib/prisma")
  try {
    const counts = {
      HarriBrand: await prisma.harriBrand.count(),
      HarriDailyLabor: await prisma.harriDailyLabor.count(),
      HarriPositionDaily: await prisma.harriPositionDaily.count(),
      HarriTimekeepingAlert: await prisma.harriTimekeepingAlert.count(),
    }
    console.log(JSON.stringify(counts, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error("verify-harri-tables failed:", e)
  process.exit(1)
})
