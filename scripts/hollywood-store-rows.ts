import fs from "node:fs"; import path from "node:path"
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local"); if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue
    const i = t.indexOf("="); if (i === -1) continue
    const k = t.slice(0, i).trim(); const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvLocal()
async function main() {
  const { prisma } = await import("../src/lib/prisma")
  try {
    const stores = await prisma.store.findMany({ where: { name: { contains: "Hollywood", mode: "insensitive" } } })
    console.log("Store rows matching Hollywood:")
    for (const s of stores) console.log(` ${s.id}  ${s.name}  active=${s.isActive}`)
    const otter = await prisma.otterStore.findMany({ where: { store: { name: { contains: "Hollywood", mode: "insensitive" } } } })
    console.log("\nOtterStore rows:")
    for (const o of otter) console.log(` ${o.otterStoreId} → storeId=${o.storeId}`)
  } finally {
    await prisma.$disconnect()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
