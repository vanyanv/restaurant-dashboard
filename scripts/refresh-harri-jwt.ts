// scripts/refresh-harri-jwt.ts
// MANUAL rotation tool for HARRI_REFRESH_TOKEN. Run on your laptop when the
// daily heartbeat (scripts/heartbeat-harri-jwt.ts) opens an incident issue.
//
// Why not CI? Harri's Cognito pool has a Lambda pre-authentication trigger
// requiring a valid Google reCAPTCHA token — direct USER_PASSWORD_AUTH
// returns `VALIDATION_EXCEPTION:GOOGLE_RECAPTCHA_TOKEN_REQUIRED`, and the
// invisible reCAPTCHA v3 on the web form scores headless Chromium too low
// to pass. A real (headed) browser session passes reCAPTCHA because it's
// a real human-driven Chromium with mouse/keyboard activity.
//
// What this script does:
//   1. Opens HEADED Chromium against https://harri.com/user/login
//   2. Auto-fills HARRI_EMAIL / HARRI_PASSWORD; you click "Log in" yourself
//      (so reCAPTCHA sees real interaction)
//   3. Scrapes the rotated Cognito refresh token from localStorage
//   4. Pushes it to .env.local + Vercel + GitHub Actions secrets
//
// Run with: pnpm tsx scripts/refresh-harri-jwt.ts
// Add --headless to attempt headless mode (will likely fail reCAPTCHA).
//
// Required env (.env.local):
//   HARRI_EMAIL, HARRI_PASSWORD       — login credentials
//   HARRI_COGNITO_CLIENT_ID           — defaults to the value in src/lib/harri.ts
//   HARRI_COGNITO_USER_POOL_REGION    — defaults to us-east-1
// Optional (for auto-push):
//   VERCEL_TOKEN, VERCEL_PROJECT_ID   — push to Vercel project env
//   GH_TOKEN                          — push to GitHub Actions secrets (repo scope)

import fs from "fs"
import path from "path"
import { chromium } from "playwright"
import sodium from "libsodium-wrappers"

const ENV_PATH = path.resolve(process.cwd(), ".env.local")
const LOGIN_URL = "https://harri.com/user/login"
const GH_REPO = "vanyanv/restaurant-dashboard"

const COGNITO_CLIENT_ID =
  process.env.HARRI_COGNITO_CLIENT_ID || "7rbq1fkugjphupo0ujb1qetuar"
const COGNITO_REGION = process.env.HARRI_COGNITO_USER_POOL_REGION || "us-east-1"
const COGNITO_ENDPOINT = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`

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

function updateEnvLocal(refreshToken: string): void {
  let content = ""
  if (fs.existsSync(ENV_PATH)) {
    content = fs.readFileSync(ENV_PATH, "utf-8")
  }
  const lines = content.split("\n")
  const filtered = lines.filter((line) => !line.trim().startsWith("HARRI_REFRESH_TOKEN="))
  filtered.push(`HARRI_REFRESH_TOKEN=${refreshToken}`)
  while (filtered.length > 0 && filtered[filtered.length - 1].trim() === "") filtered.pop()
  filtered.push("")
  fs.writeFileSync(ENV_PATH, filtered.join("\n"), "utf-8")
}

/**
 * Verify a candidate refresh token by exchanging it for an access token via
 * Cognito's REFRESH_TOKEN_AUTH flow. Mirrors the runtime path in
 * src/lib/harri.ts:refreshAccessToken so we know the rotated token is the
 * same shape the labor sync expects.
 */
async function verifyRefreshToken(refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch(COGNITO_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
        Origin: "https://harri.com",
      },
      body: JSON.stringify({
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: COGNITO_CLIENT_ID,
        AuthParameters: { REFRESH_TOKEN: refreshToken },
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      console.error(`  Verification failed: ${res.status} ${text.slice(0, 300)}`)
      return false
    }
    const data = (await res.json()) as { AuthenticationResult?: { AccessToken?: string } }
    const access = data.AuthenticationResult?.AccessToken
    if (!access) {
      console.error("  Verification failed: response missing AccessToken")
      return false
    }
    const exp = decodeJwtExp(access)
    const now = Math.floor(Date.now() / 1000)
    console.log(`  Verification passed · access token expires in ${exp - now}s`)
    return true
  } catch (err) {
    console.error("  Verification failed:", err)
    return false
  }
}

function decodeJwtExp(jwt: string): number {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString())
    return payload.exp ?? 0
  } catch {
    return 0
  }
}

async function upsertVercelEnv(
  projectId: string,
  token: string,
  existing: Array<{ id: string; key: string }>,
  key: string,
  value: string | undefined
): Promise<void> {
  if (!value) return
  const current = existing.find((e) => e.key === key)
  if (current) {
    const res = await fetch(
      `https://api.vercel.com/v9/projects/${projectId}/env/${current.id}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      }
    )
    if (res.ok) console.log(`  Updated ${key} in Vercel`)
    else console.error(`  Failed to update ${key}: ${res.status} ${await res.text()}`)
    return
  }
  const res = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      key,
      value,
      type: "encrypted",
      target: ["production", "preview", "development"],
    }),
  })
  if (res.ok) console.log(`  Created ${key} in Vercel`)
  else console.error(`  Failed to create ${key}: ${res.status} ${await res.text()}`)
}

async function updateVercel(
  refreshToken: string,
  env: Record<string, string>,
  credentials: { email?: string; password?: string }
): Promise<void> {
  const token = process.env.VERCEL_TOKEN ?? env["VERCEL_TOKEN"]
  const projectId = process.env.VERCEL_PROJECT_ID ?? env["VERCEL_PROJECT_ID"]
  if (!token || !projectId) {
    console.log("  Skipped (VERCEL_TOKEN or VERCEL_PROJECT_ID not set)")
    return
  }
  const listRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!listRes.ok) {
    console.error(`  Failed to list env vars: ${listRes.status}`)
    return
  }
  const listData = await listRes.json()
  const existing = (listData.envs ?? []) as Array<{ id: string; key: string }>
  await upsertVercelEnv(projectId, token, existing, "HARRI_REFRESH_TOKEN", refreshToken)
  await upsertVercelEnv(projectId, token, existing, "HARRI_EMAIL", credentials.email)
  await upsertVercelEnv(projectId, token, existing, "HARRI_PASSWORD", credentials.password)
}

async function pushGhSecret(
  token: string,
  publicKey: { key: string; key_id: string },
  name: string,
  value: string
): Promise<void> {
  await sodium.ready
  const binKey = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL)
  const binSecret = sodium.from_string(value)
  const encrypted = sodium.crypto_box_seal(binSecret, binKey)
  const encryptedB64 = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL)
  const putRes = await fetch(
    `https://api.github.com/repos/${GH_REPO}/actions/secrets/${name}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ encrypted_value: encryptedB64, key_id: publicKey.key_id }),
    }
  )
  if (putRes.ok || putRes.status === 204) {
    console.log(`  Updated ${name} in GitHub Actions`)
  } else {
    console.error(`  Failed to update ${name}: ${putRes.status} ${await putRes.text()}`)
  }
}

async function updateGitHub(
  refreshToken: string,
  env: Record<string, string>,
  credentials: { email?: string; password?: string }
): Promise<void> {
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
  const keyRes = await fetch(
    `https://api.github.com/repos/${GH_REPO}/actions/secrets/public-key`,
    { headers }
  )
  if (!keyRes.ok) {
    console.error(`  Failed to get public key: ${keyRes.status} ${await keyRes.text()}`)
    return
  }
  const publicKey = (await keyRes.json()) as { key: string; key_id: string }
  await pushGhSecret(token, publicKey, "HARRI_REFRESH_TOKEN", refreshToken)
  if (credentials.email) await pushGhSecret(token, publicKey, "HARRI_EMAIL", credentials.email)
  if (credentials.password)
    await pushGhSecret(token, publicKey, "HARRI_PASSWORD", credentials.password)
}

type CognitoStorage = {
  refreshToken: string | null
  accessToken: string | null
  idToken: string | null
  clientId: string | null
  userId: string | null
  allKeys: string[]
}

/**
 * Walks localStorage for the Cognito refresh-token key. The key shape is
 * `CognitoIdentityServiceProvider.<clientId>.<userId>.refreshToken` (per
 * src/lib/harri.ts:50–53). We also collect access/id tokens for diagnostics
 * and emit `allKeys` so a failed run is self-debugging.
 */
async function readCognitoFromStorage(page: import("playwright").Page): Promise<CognitoStorage> {
  return page.evaluate(() => {
    const allKeys: string[] = []
    let refreshToken: string | null = null
    let accessToken: string | null = null
    let idToken: string | null = null
    let clientId: string | null = null
    let userId: string | null = null
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      allKeys.push(k)
      if (!k.startsWith("CognitoIdentityServiceProvider.")) continue
      const parts = k.split(".")
      // CognitoIdentityServiceProvider.<clientId>.<userId>.<field>
      if (parts.length < 4) continue
      const field = parts[parts.length - 1]
      const cid = parts[1]
      const uid = parts.slice(2, -1).join(".")
      const v = localStorage.getItem(k)
      if (field === "refreshToken") {
        refreshToken = v
        clientId = cid
        userId = uid
      } else if (field === "accessToken") {
        accessToken = v
      } else if (field === "idToken") {
        idToken = v
      }
    }
    return { refreshToken, accessToken, idToken, clientId, userId, allKeys }
  })
}

async function main() {
  const env = loadEnvLocal()
  const email = process.env.HARRI_EMAIL ?? env["HARRI_EMAIL"]
  const password = process.env.HARRI_PASSWORD ?? env["HARRI_PASSWORD"]
  const isCI = !!process.env.CI

  if (!email || !password) {
    console.error("HARRI_EMAIL and HARRI_PASSWORD must be set in .env.local (or env in CI)")
    process.exit(1)
  }

  // Default: headed (real browser, passes reCAPTCHA). --headless flag for
  // diagnostics only; will trip the Lambda reCAPTCHA gate.
  const headless = process.argv.includes("--headless")
  console.log(
    `Signing in to Harri as ${email} (${headless ? "HEADLESS — likely to fail reCAPTCHA" : "headed — click Log in yourself"})...`
  )
  const browser = await chromium.launch({
    headless,
    args: ["--disable-blink-features=AutomationControlled"],
  })
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  })
  const page = await context.newPage()
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false })
  })

  let refreshToken: string | null = null
  let cognito: CognitoStorage | null = null

  try {
    await page.goto(LOGIN_URL, { waitUntil: "networkidle", timeout: 45_000 })

    // Harri's email field accepts email OR phone — `type="text"` not `email`,
    // and the input has no `name` attribute. Anchor on the visible placeholder
    // ("Email address or phone number") instead. Same for the password field.
    const emailLoc = page.locator('input[placeholder*="Email" i], input[placeholder*="phone" i]').first()
    const passwordLoc = page.locator('input[type="password"], input[placeholder*="Password" i]').first()
    await emailLoc.waitFor({ state: "visible", timeout: 25_000 })
    await emailLoc.fill(email)
    await passwordLoc.fill(password)

    if (headless) {
      // CI / diagnostic path. Will almost certainly fail at reCAPTCHA — kept
      // so the daily heartbeat can use the same login attempt to surface a
      // clear signal when the token is dead AND the headed path stops working.
      const submit = page
        .locator('button:has-text("Log in"), button:has-text("Sign in"), button[type="submit"]')
        .first()
      if (await submit.count()) await submit.click()
      else await passwordLoc.press("Enter")
    } else {
      // Headed manual path: prompt the operator to click "Log in" themselves
      // so reCAPTCHA v3 scores a real human interaction. Don't auto-click.
      console.log(
        "\n  >>> The Chromium window has email/password pre-filled.\n" +
          "  >>> Click the green 'Log in' button yourself, then watch the redirect.\n" +
          "  >>> The script will continue automatically once Harri sets a refresh token.\n"
      )
    }

    // After login Harri redirects off /user/login. Poll localStorage until
    // a Cognito refreshToken appears — generous 3-min budget so the operator
    // has time to click. Manual loop because Playwright's waitForFunction
    // overload can swallow the timeout option when the page function takes
    // no args.
    const deadline = Date.now() + 180_000
    let found = false
    while (Date.now() < deadline) {
      const ok = await page
        .evaluate(() => {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i)
            if (
              k &&
              k.startsWith("CognitoIdentityServiceProvider.") &&
              k.endsWith(".refreshToken")
            )
              return true
          }
          return false
        })
        .catch(() => false)
      if (ok) {
        found = true
        break
      }
      await page.waitForTimeout(1_500)
    }
    if (!found) throw new Error("timed out waiting 3 min for Cognito refreshToken in localStorage")

    cognito = await readCognitoFromStorage(page)
    refreshToken = cognito.refreshToken
  } catch (err) {
    const screenshotPath = path.resolve(process.cwd(), "debug-harri-login.png")
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {})
    console.error(`  Login failed: ${err instanceof Error ? err.message : String(err)}`)
    console.error(`  Current URL: ${page.url()}`)
    console.error(`  Screenshot: ${screenshotPath}`)
    if (cognito) {
      console.error(`  localStorage keys seen: ${JSON.stringify(cognito.allKeys)}`)
    }
    await browser.close()
    process.exit(1)
  }

  await browser.close()

  if (!refreshToken) {
    console.error(
      "Login completed but no Cognito refreshToken found in localStorage. Keys observed:",
      cognito?.allKeys ?? []
    )
    process.exit(1)
  }

  console.log(
    `Got refresh token (${refreshToken.length} chars) · clientId=${cognito?.clientId} userId=${cognito?.userId?.slice(0, 8)}…`
  )

  console.log("Verifying via Cognito InitiateAuth...")
  const valid = await verifyRefreshToken(refreshToken)
  if (!valid) {
    console.error("Refresh token verification failed. Not saving.")
    process.exit(1)
  }

  if (!isCI) {
    updateEnvLocal(refreshToken)
    console.log(`Saved to ${ENV_PATH}`)
  }

  console.log("Updating Vercel...")
  await updateVercel(refreshToken, env, { email, password })

  console.log("Updating GitHub...")
  await updateGitHub(refreshToken, env, { email, password })

  console.log("\nDone!")
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
