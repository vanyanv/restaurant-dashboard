// scripts/heartbeat-harri-jwt.ts
// Daily heartbeat: forces a Cognito refresh against the current
// HARRI_REFRESH_TOKEN and, if it succeeds, pings one cheap Harri endpoint
// to prove the access token actually works against the gateway.
//
// Exits 0 on success, non-zero on any failure. The wrapping GitHub workflow
// `harri-jwt-heartbeat.yml` opens an incident issue on non-zero exit, giving
// us a clear early warning ~hours before the next 4-hour labor cron would
// fail. Rotation itself is manual via scripts/refresh-harri-jwt.ts because
// Harri's Cognito pool requires a Google reCAPTCHA token on every login.

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
  if (!process.env.HARRI_REFRESH_TOKEN) {
    console.error("[harri.heartbeat] HARRI_REFRESH_TOKEN not set")
    process.exit(1)
  }

  // 1. Force a fresh Cognito access token (proves the refresh token is alive).
  const { buildLaborForecastUrl, harriFetch } = await import("../src/lib/harri")
  const { prisma } = await import("../src/lib/prisma")

  let brandId: number | null = null
  try {
    const brand = await prisma.harriBrand.findFirst({
      where: { active: true },
      select: { brandId: true },
      orderBy: { createdAt: "asc" },
    })
    brandId = brand?.brandId ?? null
  } finally {
    await prisma.$disconnect()
  }

  if (!brandId) {
    console.error("[harri.heartbeat] no active HarriBrand to ping")
    process.exit(1)
  }

  // 2. Hit one cheap, idempotent endpoint. Use the labor forecast for
  //    yesterday — the lightest payload that exercises the same gateway path
  //    runHarriLaborSync uses, so a heartbeat success genuinely predicts
  //    cron success.
  const yesterday = new Date()
  yesterday.setUTCHours(0, 0, 0, 0)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const url = buildLaborForecastUrl(brandId, yesterday)

  const t0 = Date.now()
  try {
    const data = await harriFetch<unknown>(url)
    const ms = Date.now() - t0
    console.log(
      `[harri.heartbeat] ok · brandId=${brandId} forecast endpoint replied in ${ms}ms · payload type=${typeof data}`
    )
  } catch (err) {
    const ms = Date.now() - t0
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[harri.heartbeat] FAIL · brandId=${brandId} after ${ms}ms · ${msg}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("[harri.heartbeat] fatal:", err)
  process.exit(1)
})
