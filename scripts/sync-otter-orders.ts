// scripts/sync-otter-orders.ts
// Scheduled Otter order-header + order-detail sync used by GitHub Actions.

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
  const rawDays = parseArg("days") ?? process.argv[2] ?? "3"
  const days = Number(rawDays)
  if (!Number.isFinite(days) || days < 1 || days > 14) {
    console.error("Usage: npx tsx scripts/sync-otter-orders.ts --days=<1-14>")
    process.exit(1)
  }

  console.log(`[otter.orders.sync] starting ${days}-day window at ${new Date().toISOString()}`)
  console.log(
    `[otter.orders.sync] auth: ${process.env.OTTER_JWT ? "OTTER_JWT present" : "no OTTER_JWT"}; ` +
      `${process.env.OTTER_EMAIL && process.env.OTTER_PASSWORD ? "login fallback available" : "login fallback unavailable"}`,
  )

  const { runOrdersSync } = await import("../src/lib/otter-orders-sync")
  const { prisma } = await import("../src/lib/prisma")

  try {
    const started = Date.now()
    const result = await runOrdersSync(days, undefined, {
      triggeredBy: "github-actions",
      metadata: { source: "scripts/sync-otter-orders.ts" },
    })
    console.log(JSON.stringify(result, null, 2))
    console.log(`[otter.orders.sync] completed in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error("[otter.orders.sync] failed:", err)
  process.exit(1)
})
