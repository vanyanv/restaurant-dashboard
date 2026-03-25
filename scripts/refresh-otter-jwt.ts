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

import fs from "fs"
import path from "path"
import { chromium } from "playwright"
import sodium from "libsodium-wrappers"

const ENV_PATH = path.resolve(process.cwd(), ".env.local")

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

function updateEnvLocal(jwt: string): void {
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

async function updateVercel(jwt: string, env: Record<string, string>): Promise<void> {
  const token = process.env.VERCEL_TOKEN ?? env["VERCEL_TOKEN"]
  const projectId = process.env.VERCEL_PROJECT_ID ?? env["VERCEL_PROJECT_ID"]

  if (!token || !projectId) {
    console.log("  Skipped (VERCEL_TOKEN or VERCEL_PROJECT_ID not set)")
    return
  }

  // Find existing OTTER_JWT env var ID
  const listRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!listRes.ok) {
    console.error(`  Failed to list env vars: ${listRes.status}`)
    return
  }

  const listData = await listRes.json()
  const existing = listData.envs?.find((e: { key: string }) => e.key === "OTTER_JWT")

  if (existing) {
    // Update existing
    const res = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${existing.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ value: jwt }),
    })
    if (res.ok) {
      console.log("  Updated OTTER_JWT in Vercel")
    } else {
      console.error(`  Failed to update: ${res.status} ${await res.text()}`)
    }
  } else {
    // Create new
    const res = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "OTTER_JWT",
        value: jwt,
        type: "encrypted",
        target: ["production", "preview"],
      }),
    })
    if (res.ok) {
      console.log("  Created OTTER_JWT in Vercel")
    } else {
      console.error(`  Failed to create: ${res.status} ${await res.text()}`)
    }
  }
}

const GH_REPO = "vanyanv/restaurant-dashboard"

async function updateGitHub(jwt: string, env: Record<string, string>): Promise<void> {
  const token = process.env.GH_TOKEN ?? env["GH_TOKEN"]

  if (!token) {
    console.log("  Skipped (GH_TOKEN not set)")
    return
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }

  // 1. Get repo public key
  const keyRes = await fetch(
    `https://api.github.com/repos/${GH_REPO}/actions/secrets/public-key`,
    { headers },
  )
  if (!keyRes.ok) {
    console.error(`  Failed to get public key: ${keyRes.status} ${await keyRes.text()}`)
    return
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

  if (putRes.ok || putRes.status === 204) {
    console.log("  Updated OTTER_JWT in GitHub Actions")
  } else {
    console.error(`  Failed to update: ${putRes.status} ${await putRes.text()}`)
  }
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
  await page.waitForResponse(
    (response) => response.url() === SIGN_IN_URL && response.status() === 200,
    { timeout: 15000 },
  )

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

  // 3. Save locally (skip in CI — no .env.local)
  if (!isCI) {
    updateEnvLocal(jwt)
    console.log(`Saved to ${ENV_PATH}`)
  }

  // 4. Push to Vercel
  console.log("Updating Vercel...")
  await updateVercel(jwt, env)

  // 5. Push to GitHub Actions
  console.log("Updating GitHub...")
  await updateGitHub(jwt, env)

  console.log("\nDone!")
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
