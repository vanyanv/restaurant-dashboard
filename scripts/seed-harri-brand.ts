// One-off: seed a HarriBrand mapping (Store.id -> Harri operations brandId).
// Idempotent — safe to re-run; uses upsert on brandId.
//
// Usage:
//   pnpm tsx scripts/seed-harri-brand.ts --store=<storeId> --brand=<brandId> [--name="Display name"]

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

function parseArg(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find((a) => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : null
}

async function main() {
  const storeId = parseArg("store")
  const brandStr = parseArg("brand")
  const brandName = parseArg("name")
  if (!storeId || !brandStr) {
    console.error('Usage: pnpm tsx scripts/seed-harri-brand.ts --store=<storeId> --brand=<brandId> [--name="..."]')
    process.exit(1)
  }
  const brandId = Number(brandStr)
  if (!Number.isFinite(brandId) || brandId <= 0) {
    console.error("--brand must be a positive integer")
    process.exit(1)
  }

  const { prisma } = await import("../src/lib/prisma")
  try {
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, name: true },
    })
    if (!store) {
      console.error(`Store not found: ${storeId}`)
      process.exit(1)
    }

    const result = await prisma.harriBrand.upsert({
      where: { brandId },
      create: { storeId: store.id, brandId, brandName: brandName ?? store.name, active: true },
      update: { storeId: store.id, brandName: brandName ?? store.name, active: true },
    })
    console.log(`Mapped: ${store.name} (${store.id}) -> Harri brand ${brandId}`)
    console.log(`HarriBrand row id: ${result.id}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
