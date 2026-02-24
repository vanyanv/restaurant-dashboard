// scripts/refresh-otter-jwt.ts
// Refreshes the Otter JWT by calling the login API directly (no browser needed).
// Run with: npx tsx scripts/refresh-otter-jwt.ts
//
// Reads OTTER_EMAIL and OTTER_PASSWORD from .env.local, calls the sign-in endpoint,
// saves the new OTTER_JWT back to .env.local, and verifies it with a test query.

import fs from "fs"
import path from "path"

const ENV_PATH = path.resolve(process.cwd(), ".env.local")

const SIGN_IN_URL = "https://api.tryotter.com/users/sign_in"
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
      console.log(`Verification passed: got ${data.rows.length} row(s)`)
      return true
    }
    console.error("Verification failed: unexpected response shape")
    return false
  } catch (err) {
    console.error("Verification failed:", err)
    return false
  }
}

async function main() {
  const env = loadEnvLocal()
  const email = process.env.OTTER_EMAIL ?? env["OTTER_EMAIL"]
  const password = process.env.OTTER_PASSWORD ?? env["OTTER_PASSWORD"]

  if (!email || !password) {
    console.error("OTTER_EMAIL and OTTER_PASSWORD must be set in .env.local")
    process.exit(1)
  }

  console.log(`Signing in as ${email}...`)

  const res = await fetch(SIGN_IN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`Sign-in failed (${res.status}): ${text}`)
    process.exit(1)
  }

  const data = await res.json()
  const jwt = data.accessToken as string | undefined

  if (!jwt) {
    console.error("Sign-in response missing accessToken")
    process.exit(1)
  }

  console.log(`Got JWT (${jwt.length} chars)`)

  console.log("Verifying token...")
  const valid = await verifyToken(jwt)

  if (!valid) {
    console.error("Token verification failed. Not saving.")
    process.exit(1)
  }

  updateEnvLocal(jwt)
  console.log(`Saved OTTER_JWT to ${ENV_PATH}`)
  console.log("Done!")
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
