// scripts/refresh-otter-jwt.ts
// Automates Otter JWT capture via browser automation.
// Run with: npx tsx scripts/refresh-otter-jwt.ts
//
// Optional env vars in .env.local:
//   OTTER_EMAIL    — auto-fills email on login page
//   OTTER_PASSWORD — auto-fills password on login page
// If not set, the browser opens and you log in manually.

import fs from "fs"
import path from "path"
import puppeteer from "puppeteer-core"

const ENV_PATH = path.resolve(process.cwd(), ".env.local")

const OTTER_API_HOST = "api.tryotter.com"
const OTTER_APP_URL = "https://manager.tryotter.com"

const METRICS_URL = "https://api.tryotter.com/analytics/table/metrics_explorer"
const OTTER_HEADERS = {
  "Content-Type": "application/json",
  "application-name": "op-app-analytics",
  "application-version": "fddebf256f27323d4bb2dfe5e021eba83cdb8a41",
}

// Store IDs for verification query
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

  // Remove existing OTTER_JWT or Bearer lines
  const lines = content.split("\n")
  const filtered = lines.filter((line) => {
    const trimmed = line.trim()
    if (trimmed.startsWith("OTTER_JWT=")) return false
    if (trimmed.startsWith("Bearer=")) return false
    return true
  })

  // Add the new OTTER_JWT line
  filtered.push(`OTTER_JWT=${jwt}`)

  // Remove trailing empty lines, then add one final newline
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
      headers: {
        ...OTTER_HEADERS,
        Authorization: `Bearer ${jwt}`,
      },
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

  console.log("Launching browser...")
  const browser = await puppeteer.launch({
    executablePath: "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
    headless: false,
    defaultViewport: { width: 1280, height: 800 },
    args: ["--no-first-run", "--no-default-browser-check"],
  })

  const page = await browser.newPage()

  let capturedJwt: string | null = null

  // Intercept requests to capture the JWT from Authorization header
  await page.setRequestInterception(true)
  page.on("request", (request) => {
    const url = request.url()
    const headers = request.headers()

    if (!capturedJwt && url.includes(OTTER_API_HOST)) {
      const auth = headers["authorization"] || headers["Authorization"]
      if (auth && auth.startsWith("Bearer ")) {
        capturedJwt = auth.replace("Bearer ", "")
        console.log("\nJWT captured from request to:", url)
      }
    }

    request.continue()
  })

  console.log(`Navigating to ${OTTER_APP_URL}...`)
  await page.goto(OTTER_APP_URL, { waitUntil: "networkidle2" })

  // Attempt auto-login if credentials are available
  if (email && password) {
    console.log("Credentials found, attempting auto-login...")
    try {
      // Wait for the email input to appear
      await page.waitForSelector('input[type="email"], input[name="email"], input[autocomplete="email"]', {
        timeout: 10000,
      })

      // Type email
      const emailInput = await page.$('input[type="email"], input[name="email"], input[autocomplete="email"]')
      if (emailInput) {
        await emailInput.click({ clickCount: 3 })
        await emailInput.type(email, { delay: 50 })
      }

      // Type password
      const passwordInput = await page.$('input[type="password"], input[name="password"]')
      if (passwordInput) {
        await passwordInput.click({ clickCount: 3 })
        await passwordInput.type(password, { delay: 50 })
      }

      // Click submit button
      const submitBtn = await page.$('button[type="submit"]')
      if (submitBtn) {
        await submitBtn.click()
        console.log("Login form submitted. Waiting for dashboard to load...")
      }
    } catch {
      console.log("Could not auto-fill login form. Please log in manually.")
    }
  } else {
    console.log("\nNo OTTER_EMAIL/OTTER_PASSWORD found in .env.local.")
    console.log("Please log in manually in the browser window.")
  }

  // Wait for JWT to be captured (poll every second, timeout after 5 minutes)
  console.log("\nWaiting for JWT to be captured from network traffic...")
  const maxWait = 5 * 60 * 1000
  const start = Date.now()

  while (!capturedJwt && Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, 1000))
  }

  if (!capturedJwt) {
    console.error("\nTimeout: no JWT captured after 5 minutes.")
    await browser.close()
    throw new Error("No JWT captured")
  }

  const jwt: string = capturedJwt

  console.log(`\nJWT length: ${jwt.length} characters`)

  // Verify the token works
  console.log("\nVerifying token...")
  const valid = await verifyToken(jwt)

  if (!valid) {
    console.error("Token verification failed. Not saving.")
    await browser.close()
    process.exit(1)
  }

  // Save to .env.local
  updateEnvLocal(jwt)
  console.log(`\nSaved OTTER_JWT to ${ENV_PATH}`)
  console.log("Done! You can close the browser.")

  await browser.close()
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
