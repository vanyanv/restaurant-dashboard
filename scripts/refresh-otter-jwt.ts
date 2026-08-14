// scripts/refresh-otter-jwt.ts
// Refreshes the Otter JWT and pushes it to .env.local, Vercel, and GitHub.
// Run with: npx tsx scripts/refresh-otter-jwt.ts
//
// Reads OTTER_EMAIL and OTTER_PASSWORD from .env.local, calls the sign-in endpoint,
// saves the new OTTER_JWT to .env.local, then updates Vercel and GitHub secrets.
//
// Requirements for auto-push:
//   - Vercel: VERCEL_TOKEN and VERCEL_PROJECT_ID in .env.local
//   - GitHub: GH_TOKEN in .env.local (personal access token with repo scope)
//
// Every leg reports ok/skipped/failed and is read back before being believed,
// and the script exits non-zero if a required leg didn't land. That is not
// defensive programming for its own sake — it is the fix for a live incident:
//
//   On 2026-08-13, `OTTER_JWT` in GitHub Actions was found frozen at
//   2026-05-27 — 78 days stale — while this workflow reported success every
//   single morning. `updateGitHub()` was 401ing on a dead `GH_PAT`, logging the
//   error, and returning normally; `main()` then printed "Done!" and exited 0.
//   Nothing surfaced it because the Otter syncs self-heal: getOtterJwt() falls
//   back to a live email/password sign-in when the env JWT is expired, so the
//   data kept flowing while the rotation quietly did nothing.
//
// This is the same bug fixed for the Harri rotation a day earlier (PR #55); the
// shared rules now live in src/lib/rotation-health.ts.

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { chromium } from "playwright"
import sodium from "libsodium-wrappers"

import {
  describeRotationFailure,
  summarizeLegs,
  type LegSpec,
  type LegStatus,
} from "../src/lib/rotation-health"

const ENV_PATH = path.resolve(process.cwd(), ".env.local")

/**
 * How recently a store's own timestamp must have moved for us to believe our
 * write landed. Generous enough to absorb clock skew and a slow rotation, tight
 * enough that a *stale* row (the frozen-secret case) can't sneak through.
 */
const RECENT_WINDOW_MS = 15 * 60 * 1000

function isRecent(epochMs: number): boolean {
  return Date.now() - epochMs < RECENT_WINDOW_MS
}

const SIGN_IN_URL = "https://manager.tryotter.com/api/users/sign_in"
const METRICS_URL = "https://api.tryotter.com/analytics/table/metrics_explorer"
const OTTER_HEADERS = {
  "Content-Type": "application/json",
  "application-name": "op-app-analytics",
  "application-version": "fddebf256f27323d4bb2dfe5e021eba83cdb8a41",
}

const STORE_IDS = [
  "10b8d83b-db0e-4637-8ce6-ef3b60081f11",
  "2fb629b7-2a22-429c-80cf-de2ae6d4a662",
]

function loadEnvLocal(): Record<string, string> {
  if (!fs.existsSync(ENV_PATH)) return {}
  const content = fs.readFileSync(ENV_PATH, "utf-8")
  const result: Record<string, string> = {}
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
    result[key] = val
  }
  return result
}

/**
 * Write the JWT to `.env.local`, then read the file back and confirm the value
 * actually landed. This is the one leg whose value we can verify directly —
 * Vercel and GitHub secrets are write-only, so those fall back to timestamps.
 */
function updateEnvLocal(jwt: string): LegStatus {
  try {
    let content = ""
    if (fs.existsSync(ENV_PATH)) {
      content = fs.readFileSync(ENV_PATH, "utf-8")
    }

    const lines = content.split("\n")
    const filtered = lines.filter((line) => {
      const trimmed = line.trim()
      if (trimmed.startsWith("OTTER_JWT=")) return false
      if (trimmed.startsWith("Bearer=")) return false
      return true
    })

    filtered.push(`OTTER_JWT=${jwt}`)

    while (filtered.length > 0 && filtered[filtered.length - 1].trim() === "") {
      filtered.pop()
    }
    filtered.push("")

    fs.writeFileSync(ENV_PATH, filtered.join("\n"), "utf-8")

    if (loadEnvLocal()["OTTER_JWT"] !== jwt) {
      console.error("  Read-back mismatch: .env.local does not contain the JWT we just wrote")
      return "failed"
    }
    return "ok"
  } catch (err) {
    console.error(`  .env.local write failed: ${err instanceof Error ? err.message : String(err)}`)
    return "failed"
  }
}

async function verifyToken(jwt: string): Promise<boolean> {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const dd = String(now.getDate()).padStart(2, "0")
  const minDate = `${yyyy}-${mm}-${dd}T00:00:00.000Z`
  const maxDate = `${yyyy}-${mm}-${dd}T23:59:59.999Z`

  const body = {
    columns: [{ type: "metric", key: "fp_sales_financials_gross_sales" }],
    groupBy: [{ key: "store" }],
    sortBy: [{ type: "metric", key: "fp_sales_financials_gross_sales", sortOrder: "DESC" }],
    filterSet: [{ filterType: "dateRangeFilter", minDate, maxDate }],
    scopeSet: [{ key: "store", values: STORE_IDS }],
    includeMetricsFilters: true,
    localTime: true,
    includeTotalRowCount: false,
    limit: 10,
    includeRawQueries: false,
  }

  try {
    const res = await fetch(METRICS_URL, {
      method: "POST",
      headers: { ...OTTER_HEADERS, Authorization: `Bearer ${jwt}` },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      console.error(`Verification failed: ${res.status} ${res.statusText}`)
      return false
    }

    const data = await res.json()
    if (data.rows && Array.isArray(data.rows)) {
      console.log(`  Verification passed: got ${data.rows.length} row(s)`)
      return true
    }
    console.error("  Verification failed: unexpected response shape")
    return false
  } catch (err) {
    console.error("  Verification failed:", err)
    return false
  }
}

async function upsertVercelEnv(
  projectId: string,
  token: string,
  existing: Array<{ id: string; key: string }>,
  key: string,
  value: string | undefined,
): Promise<boolean> {
  if (!value) return true

  const current = existing.find((e) => e.key === key)
  if (current) {
    const res = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${current.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    })
    if (res.ok) {
      console.log(`  Updated ${key} in Vercel`)
      return true
    }
    console.error(`  Failed to update ${key}: ${res.status} ${await res.text()}`)
    return false
  }

  const res = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      key,
      value,
      type: "encrypted",
      target: ["production", "preview"],
    }),
  })
  if (res.ok) {
    console.log(`  Created ${key} in Vercel`)
    return true
  }
  console.error(`  Failed to create ${key}: ${res.status} ${await res.text()}`)
  return false
}

async function updateVercel(
  jwt: string,
  env: Record<string, string>,
  credentials: { email?: string; password?: string },
): Promise<LegStatus> {
  const token = process.env.VERCEL_TOKEN ?? env["VERCEL_TOKEN"]
  const projectId = process.env.VERCEL_PROJECT_ID ?? env["VERCEL_PROJECT_ID"]

  if (!token || !projectId) {
    console.error("  Skipped (VERCEL_TOKEN or VERCEL_PROJECT_ID not set)")
    return "skipped"
  }

  try {
    // Find existing OTTER_JWT env var ID
    const listRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!listRes.ok) {
      console.error(`  Failed to list env vars: ${listRes.status} ${await listRes.text()}`)
      return "failed"
    }

    const listData = await listRes.json()
    const existing = (listData.envs ?? []) as Array<{ id: string; key: string }>

    const results = [
      await upsertVercelEnv(projectId, token, existing, "OTTER_JWT", jwt),
      await upsertVercelEnv(projectId, token, existing, "OTTER_EMAIL", credentials.email),
      await upsertVercelEnv(projectId, token, existing, "OTTER_PASSWORD", credentials.password),
    ]
    if (results.some((ok) => !ok)) return "failed"

    // Read back: the value is write-only, so confirm the row's updatedAt moved
    // into the last few minutes rather than trusting the write's 200.
    const verifyRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (verifyRes.ok) {
      const rows = (((await verifyRes.json()) as { envs?: unknown }).envs ?? []) as Array<{
        key: string
        updatedAt?: number
      }>
      const row = rows.find((r) => r.key === "OTTER_JWT")
      if (!row) {
        console.error("  Read-back failed: OTTER_JWT missing from Vercel project env")
        return "failed"
      }
      if (typeof row.updatedAt === "number" && !isRecent(row.updatedAt)) {
        console.error(
          `  Read-back stale: Vercel OTTER_JWT updatedAt=${new Date(row.updatedAt).toISOString()}`,
        )
        return "failed"
      }
    }
    return "ok"
  } catch (err) {
    console.error(`  Vercel update failed: ${err instanceof Error ? err.message : String(err)}`)
    return "failed"
  }
}

const GH_REPO = "vanyanv/restaurant-dashboard"

async function redeployVercel(env: Record<string, string>): Promise<LegStatus> {
  const token = process.env.VERCEL_TOKEN ?? env["VERCEL_TOKEN"]
  const projectId = process.env.VERCEL_PROJECT_ID ?? env["VERCEL_PROJECT_ID"]

  if (!token || !projectId) {
    console.error("  Skipped (VERCEL_TOKEN or VERCEL_PROJECT_ID not set)")
    return "skipped"
  }

  try {
    // Get the latest production deployment to find the target
    const listRes = await fetch(
      `https://api.vercel.com/v6/deployments?projectId=${projectId}&target=production&limit=1`,
      { headers: { Authorization: `Bearer ${token}` } },
    )

    if (!listRes.ok) {
      console.error(`  Failed to list deployments: ${listRes.status}`)
      return "failed"
    }

    const listData = await listRes.json()
    const latest = listData.deployments?.[0]

    if (!latest) {
      console.error("  No production deployment found to redeploy")
      return "failed"
    }

    const res = await fetch("https://api.vercel.com/v13/deployments", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: latest.name,
        target: "production",
        deploymentId: latest.uid,
      }),
    })

    if (!res.ok) {
      console.error(`  Failed to redeploy: ${res.status} ${await res.text()}`)
      return "failed"
    }
    const data = await res.json()
    console.log(`  Triggered production redeploy: ${data.url}`)
    return "ok"
  } catch (err) {
    console.error(`  Redeploy failed: ${err instanceof Error ? err.message : String(err)}`)
    return "failed"
  }
}

async function updateGitHub(jwt: string, env: Record<string, string>): Promise<LegStatus> {
  // Accept GH_PAT too — that's the name the CI workflows already use. `||` not
  // `??` on purpose: `GH_TOKEN=` (set but empty) is a real shape and must fall
  // through to the next candidate rather than counting as configured.
  const token = process.env.GH_PAT || process.env.GH_TOKEN || env["GH_PAT"] || env["GH_TOKEN"]

  if (!token) {
    console.error("  Skipped (neither GH_PAT nor GH_TOKEN set)")
    return "skipped"
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }

  try {
    // 1. Get repo public key
    const keyRes = await fetch(
      `https://api.github.com/repos/${GH_REPO}/actions/secrets/public-key`,
      { headers },
    )
    if (!keyRes.ok) {
      console.error(`  Failed to get public key: ${keyRes.status} ${await keyRes.text()}`)
      if (keyRes.status === 401 || keyRes.status === 403) {
        console.error(
          "  → The GitHub credential is expired or lacks `repo` scope. This is the exact\n" +
            "    failure that left OTTER_JWT frozen for 78 days while this script exited 0.\n" +
            "    Fix: set a fresh PAT as the GH_PAT repo secret (and GH_TOKEN in .env.local).",
        )
      }
      return "failed"
    }
    const { key, key_id } = await keyRes.json()

    // 2. Encrypt the secret with libsodium sealed box
    await sodium.ready
    const binKey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL)
    const binSecret = sodium.from_string(jwt)
    const encrypted = sodium.crypto_box_seal(binSecret, binKey)
    const encryptedB64 = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL)

    // 3. Create or update the secret
    const putRes = await fetch(
      `https://api.github.com/repos/${GH_REPO}/actions/secrets/OTTER_JWT`,
      {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ encrypted_value: encryptedB64, key_id }),
      },
    )

    if (!putRes.ok && putRes.status !== 204) {
      console.error(`  Failed to update: ${putRes.status} ${await putRes.text()}`)
      return "failed"
    }
    console.log("  Updated OTTER_JWT in GitHub Actions")

    // 4. Read back: secret values are write-only, so a 204 on the PUT is not
    //    proof the value landed. Confirm updated_at actually moved — this is
    //    the check that would have caught the 78-day freeze on day one.
    const checkRes = await fetch(
      `https://api.github.com/repos/${GH_REPO}/actions/secrets/OTTER_JWT`,
      { headers },
    )
    if (checkRes.ok) {
      const { updated_at: updatedAt } = (await checkRes.json()) as { updated_at?: string }
      const stamp = updatedAt ? Date.parse(updatedAt) : Number.NaN
      if (Number.isNaN(stamp) || !isRecent(stamp)) {
        console.error(`  Read-back stale: GitHub secret updated_at=${updatedAt ?? "unknown"}`)
        return "failed"
      }
      console.log(`  Verified GitHub secret updated_at=${updatedAt}`)
    }
    return "ok"
  } catch (err) {
    console.error(`  GitHub update failed: ${err instanceof Error ? err.message : String(err)}`)
    return "failed"
  }
}

export type OtterLegName = "envLocal" | "vercel" | "github" | "redeploy"
export type OtterLegs = Record<OtterLegName, LegStatus>

const OTTER_LEG_LABELS: Record<OtterLegName, string> = {
  envLocal: ".env.local",
  vercel: "Vercel",
  github: "GitHub Actions",
  redeploy: "Vercel redeploy",
}

/**
 * Decide which legs a given run is allowed to fail.
 *
 * A rotation is only a success if the JWT landed everywhere that *reads* it.
 * Two deliberate exemptions:
 *
 *   - `.env.local` is not required in CI — there is no file there to write.
 *   - The redeploy is reported but never required. Unlike the three stores, a
 *     missed redeploy is not an outage: getOtterJwt() falls back to a live
 *     email/password sign-in when the deployed env var is stale. Failing the
 *     run on a transient deploy-API hiccup would buy a false incident and no
 *     safety.
 *
 * `--allow-partial` drops every requirement, for one-off local runs without
 * Vercel/GitHub credentials.
 */
export function buildLegSpecs(
  legs: OtterLegs,
  { isCI, allowPartial }: { isCI: boolean; allowPartial: boolean },
): LegSpec[] {
  const requiredStores: OtterLegName[] = isCI
    ? ["vercel", "github"]
    : ["envLocal", "vercel", "github"]
  const required = new Set(allowPartial ? [] : requiredStores)

  return (Object.keys(OTTER_LEG_LABELS) as OtterLegName[]).map((name) => ({
    name,
    label: OTTER_LEG_LABELS[name],
    status: legs[name],
    required: required.has(name),
  }))
}

async function main() {
  const env = loadEnvLocal()
  const email = process.env.OTTER_EMAIL ?? env["OTTER_EMAIL"]
  const password = process.env.OTTER_PASSWORD ?? env["OTTER_PASSWORD"]

  const isCI = !!process.env.CI

  if (!email || !password) {
    console.error("OTTER_EMAIL and OTTER_PASSWORD must be set in .env.local (or as env vars in CI)")
    process.exit(1)
  }

  // 1. Sign in via Playwright (bypasses Cloudflare bot detection)
  console.log(`Signing in as ${email} (via headless browser)...`)
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
    ],
  })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  })
  const page = await context.newPage()

  // Hide headless browser signals
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false })
  })

  // Intercept the sign-in API response to capture the JWT
  let jwt: string | undefined
  page.on("response", async (response) => {
    if (response.url() === SIGN_IN_URL && response.status() === 200) {
      const authHeader = response.headers()["authorization"]
      if (authHeader) {
        jwt = authHeader.replace("Bearer ", "")
      }
    }
  })

  // Navigate to the Otter login page and fill in the form
  await page.goto("https://manager.tryotter.com", { waitUntil: "networkidle" })

  // Fill email and password, click sign in
  await page.fill('[data-testid="op-auth_email-field"]', email)
  await page.fill('[data-testid="op-auth_password-field"]', password)
  await page.click('[data-testid="op-auth_login-button"]')

  // Wait for the sign-in API call to complete
  try {
    await page.waitForResponse(
      (response) => response.url() === SIGN_IN_URL && response.status() === 200,
      { timeout: 30000 },
    )
  } catch {
    // Capture screenshot for debugging
    const screenshotPath = path.resolve(process.cwd(), "debug-login.png")
    await page.screenshot({ path: screenshotPath, fullPage: true })
    console.error(`  Login timed out. Screenshot saved to ${screenshotPath}`)
    console.error(`  Current URL: ${page.url()}`)
    await browser.close()
    process.exit(1)
  }

  await browser.close()

  if (!jwt) {
    console.error("Sign-in response missing JWT in Authorization header")
    process.exit(1)
  }

  console.log(`Got JWT (${jwt.length} chars)`)

  // 2. Verify
  console.log("Verifying token...")
  const valid = await verifyToken(jwt)
  if (!valid) {
    console.error("Token verification failed. Not saving.")
    process.exit(1)
  }

  const legs: OtterLegs = {
    envLocal: "skipped",
    vercel: "skipped",
    github: "skipped",
    redeploy: "skipped",
  }

  // 3. Save locally (skip in CI — no .env.local)
  if (!isCI) {
    console.log(`Saving to ${ENV_PATH}...`)
    legs.envLocal = updateEnvLocal(jwt)
  }

  // 4. Push to Vercel
  console.log("Updating Vercel...")
  legs.vercel = await updateVercel(jwt, env, { email, password })

  // 5. Push to GitHub Actions
  console.log("Updating GitHub...")
  legs.github = await updateGitHub(jwt, env)

  // 6. Redeploy Vercel so the new JWT takes effect
  console.log("Redeploying Vercel...")
  legs.redeploy = await redeployVercel(env)

  const allowPartial = process.argv.includes("--allow-partial")
  const verdict = summarizeLegs(buildLegSpecs(legs, { isCI, allowPartial }))

  console.log("\nRotation summary:")
  for (const line of verdict.lines) console.log(line)

  if (!verdict.ok) {
    console.error(describeRotationFailure(verdict.problems))
    process.exit(1)
  }

  console.log("\nDone! JWT landed in every required store.")
}

// Only rotate when invoked as a script. Without this guard, importing the module
// to unit-test buildLegSpecs() would kick off a real Otter login.
const invokedDirectly =
  !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  main().catch((err) => {
    console.error("Error:", err)
    process.exit(1)
  })
}
