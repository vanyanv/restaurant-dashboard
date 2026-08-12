// scripts/heartbeat-harri-jwt.ts
// Daily heartbeat. Answers two independent questions:
//
//   1. Is the token alive *today*? Forces a Cognito refresh against the current
//      HARRI_REFRESH_TOKEN and pings one cheap Harri endpoint to prove the
//      access token works against the gateway.
//   2. Can we still *renew* it? Checks how long ago a token last landed in the
//      GitHub Actions secret, and whether our credential can still write
//      secrets at all.
//
// Question 2 was added after the 2026-08-12 incident, where the answer to (1)
// was "yes" every single day while the rotation chain had been broken for three
// weeks — the GitHub leg was 401ing silently, so the Actions secret was frozen
// at a token quietly counting down to its 30-day expiry. A green heartbeat was
// actively misleading. Alive and renewable are different properties; we now
// check both, and alert with days of runway rather than after the outage.
//
// Exits 0 on success, non-zero on any failure. The wrapping GitHub workflow
// `harri-jwt-heartbeat.yml` opens an incident issue on non-zero exit. Rotation
// itself stays manual via scripts/refresh-harri-jwt.ts because Harri's Cognito
// pool requires a Google reCAPTCHA token on every login.

import fs from "fs"
import path from "path"

import { classifyTokenAge } from "../src/lib/harri-rotation-health"

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

const GH_REPO = process.env.HARRI_GH_REPO || "vanyanv/restaurant-dashboard"

/**
 * Ask GitHub two questions the old heartbeat never asked:
 *
 *   1. How long ago did a token last land in the Actions secret? That is our
 *      only readable proxy for issuance date (the refresh token is opaque), and
 *      it measures the thing that actually breaks — the rotation chain, not the
 *      token.
 *   2. Can our credential still *write* secrets? If not, the next rotation
 *      cannot reach CI, and we are on a countdown whether the token looks
 *      healthy today or not.
 *
 * Returns true if healthy. Never throws — a GitHub hiccup should not by itself
 * fail the liveness heartbeat.
 */
async function checkRotationChain(): Promise<boolean> {
  const token = process.env.GH_PAT || process.env.GH_TOKEN
  if (!token) {
    console.error(
      "[harri.heartbeat] FAIL · no GH_PAT/GH_TOKEN — cannot tell whether rotation can still land in CI"
    )
    return false
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }

  let healthy = true

  // 1. Age of the last landed token.
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GH_REPO}/actions/secrets/HARRI_REFRESH_TOKEN`,
      { headers }
    )
    if (!res.ok) {
      console.error(
        `[harri.heartbeat] FAIL · cannot read HARRI_REFRESH_TOKEN metadata: ${res.status} ${await res.text()}`
      )
      healthy = false
    } else {
      const { updated_at: updatedAt } = (await res.json()) as { updated_at?: string }
      const verdict = classifyTokenAge(updatedAt ?? "")
      const tag = verdict.level === "ok" ? "ok" : verdict.level.toUpperCase()
      const log = verdict.level === "ok" ? console.log : console.error
      log(`[harri.heartbeat] token-age ${tag} · ${verdict.message}`)
      if (verdict.level === "critical") healthy = false
    }
  } catch (err) {
    console.error(`[harri.heartbeat] FAIL · token-age check errored: ${err}`)
    healthy = false
  }

  // 2. Can we still write secrets? This is the leg that died silently in the
  //    2026-08-12 incident — a 401 here for three weeks with nothing noticing.
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GH_REPO}/actions/secrets/public-key`,
      { headers }
    )
    if (res.ok) {
      console.log("[harri.heartbeat] rotation-capability ok · GitHub credential can write secrets")
    } else {
      console.error(
        `[harri.heartbeat] FAIL · GitHub credential cannot write secrets: ${res.status} ${await res.text()}\n` +
          "  → The next rotation will not reach CI. Replace the PAT (GH_PAT secret / GH_TOKEN in\n" +
          "    .env.local) before the current token hits its 30-day expiry."
      )
      healthy = false
    }
  } catch (err) {
    console.error(`[harri.heartbeat] FAIL · rotation-capability check errored: ${err}`)
    healthy = false
  }

  return healthy
}

async function main() {
  if (!process.env.HARRI_REFRESH_TOKEN) {
    console.error("[harri.heartbeat] HARRI_REFRESH_TOKEN not set")
    process.exit(1)
  }

  // Run this even if the liveness probe below would pass — "alive today" and
  // "renewable tomorrow" are independent failure modes, and we were bitten by
  // the second while the first stayed green.
  const chainHealthy = await checkRotationChain()

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

  // The token works right now — but if the rotation chain is broken we are on a
  // countdown, so fail the heartbeat and open the incident while there is still
  // runway to fix it.
  if (!chainHealthy) {
    console.error(
      "[harri.heartbeat] FAIL · token is alive but the rotation chain is unhealthy (see above)"
    )
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("[harri.heartbeat] fatal:", err)
  process.exit(1)
})
