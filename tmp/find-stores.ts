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
  const stores = await prisma.store.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
  console.log("Active stores:")
  for (const s of stores) console.log(`  ${s.id}  ${s.name}`)

  console.log("\nPending OtterOrder.detailsFetchedAt = null per store:")
  const pending = await prisma.otterOrder.groupBy({
    by: ["storeId"],
    where: { detailsFetchedAt: null },
    _count: { _all: true },
  })
  for (const p of pending) {
    const name = stores.find((s) => s.id === p.storeId)?.name ?? "(unknown)"
    console.log(`  ${name}: ${p._count._all}`)
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
