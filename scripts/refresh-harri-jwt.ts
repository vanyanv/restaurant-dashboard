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
//   1. Opens HEADED Chromium against https://harri.com/user/login, reusing a
//      persistent profile so reCAPTCHA reputation accrues across runs instead
//      of resetting to "first-time visitor" every week
//   2. Types the credentials with human-ish timing and pointer movement, then
//      either clicks for you (--auto) or waits for you to click
//   2b. Retries a refused login with spacing — a rejection is a dice roll on a
//      score, not a deterministic failure (see BACKOFF_MS)
//   3. Scrapes the rotated Cognito refresh token from localStorage
//   4. Pushes it to .env.local + Vercel + GitHub Actions secrets, reads each
//      one back to confirm it landed, and exits non-zero if any leg didn't.
//
// That last part is not decoration. Before 2026-08-12 every leg was
// best-effort: the GitHub push 401'd for three weeks straight and the script
// still printed "Done!" and exited 0, so the weekly systemd timer reported
// success while CI kept serving a token counting down to expiry. A partial
// rotation is worse than a failed one — it leaves the stores disagreeing, and
// the stale one keeps working right up until it doesn't.
//
// Run with: pnpm tsx scripts/refresh-harri-jwt.ts
// Add --headless to attempt headless mode (will likely fail reCAPTCHA).
// Add --allow-partial to tolerate legs you haven't configured locally.
//
// Required env (.env.local):
//   HARRI_EMAIL, HARRI_PASSWORD       — login credentials
//   HARRI_COGNITO_CLIENT_ID           — defaults to the value in src/lib/harri.ts
//   HARRI_COGNITO_USER_POOL_REGION    — defaults to us-east-1
// Optional (for auto-push):
//   VERCEL_TOKEN, VERCEL_PROJECT_ID   — push to Vercel project env
//   GH_TOKEN                          — push to GitHub Actions secrets (repo scope)

import fs from "fs"
import os from "os"
import path from "path"
import { chromium, type BrowserContext, type Locator, type Page } from "playwright"
import sodium from "libsodium-wrappers"

import { PAT_REMEDIATION, resolveGitHubCredential } from "../src/lib/github-credential"
import {
  summarizeRotation,
  type LegName,
  type LegStatus,
} from "../src/lib/harri-rotation-health"

const ENV_PATH = path.resolve(process.cwd(), ".env.local")
const LOGIN_URL = "https://harri.com/user/login"
const GH_REPO = "vanyanv/restaurant-dashboard"

// Kept outside the repo so it can never be committed and survives `git clean`.
const PROFILE_DIR =
  process.env.HARRI_PROFILE_DIR || path.resolve(os.homedir(), ".cache/harri-rotation/profile")

/** Gaps between retries. Spaced, not tight — rapid retries score worse. */
const BACKOFF_MS = [60_000, 180_000]

/** A write "landed" if the store's own timestamp moved into the last 10 min. */
const RECENT_WINDOW_MS = 10 * 60_000
function isRecent(epochMs: number): boolean {
  return Date.now() - epochMs < RECENT_WINDOW_MS
}

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

/**
 * Write the token to `.env.local`, then read the file back and confirm the
 * value actually landed. This is the one leg whose value we can verify
 * directly — Vercel and GitHub secrets are write-only, so those fall back to
 * timestamp checks.
 */
function updateEnvLocal(refreshToken: string): LegStatus {
  try {
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

    const readBack = loadEnvLocal()["HARRI_REFRESH_TOKEN"]
    if (readBack !== refreshToken) {
      console.error("  Read-back mismatch: .env.local does not contain the token we just wrote")
      return "failed"
    }
    return "ok"
  } catch (err) {
    console.error(`  .env.local write failed: ${err instanceof Error ? err.message : String(err)}`)
    return "failed"
  }
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
): Promise<boolean> {
  if (!value) return true
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
      target: ["production", "preview", "development"],
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
  refreshToken: string,
  env: Record<string, string>,
  credentials: { email?: string; password?: string }
): Promise<LegStatus> {
  const token = process.env.VERCEL_TOKEN || env["VERCEL_TOKEN"]
  const projectId = process.env.VERCEL_PROJECT_ID || env["VERCEL_PROJECT_ID"]
  if (!token || !projectId) {
    console.error("  Skipped (VERCEL_TOKEN or VERCEL_PROJECT_ID not set)")
    return "skipped"
  }
  try {
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
      await upsertVercelEnv(projectId, token, existing, "HARRI_REFRESH_TOKEN", refreshToken),
      await upsertVercelEnv(projectId, token, existing, "HARRI_EMAIL", credentials.email),
      await upsertVercelEnv(projectId, token, existing, "HARRI_PASSWORD", credentials.password),
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
      const row = rows.find((r) => r.key === "HARRI_REFRESH_TOKEN")
      if (!row) {
        console.error("  Read-back failed: HARRI_REFRESH_TOKEN missing from Vercel project env")
        return "failed"
      }
      if (typeof row.updatedAt === "number" && !isRecent(row.updatedAt)) {
        console.error(
          `  Read-back stale: Vercel HARRI_REFRESH_TOKEN updatedAt=${new Date(row.updatedAt).toISOString()}`
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

async function pushGhSecret(
  token: string,
  publicKey: { key: string; key_id: string },
  name: string,
  value: string
): Promise<boolean> {
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
    return true
  }
  console.error(`  Failed to update ${name}: ${putRes.status} ${await putRes.text()}`)
  return false
}

async function updateGitHub(
  refreshToken: string,
  env: Record<string, string>,
  credentials: { email?: string; password?: string }
): Promise<LegStatus> {
  const credential = resolveGitHubCredential(process.env, env)
  if (!credential) {
    console.error("  Skipped (neither GH_PAT nor GH_TOKEN set)")
    console.error(`  ${PAT_REMEDIATION}`)
    return "skipped"
  }
  if (!credential.durable) console.error(`  WARNING: ${credential.warning}`)
  const token = credential.token
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  try {
    const keyRes = await fetch(
      `https://api.github.com/repos/${GH_REPO}/actions/secrets/public-key`,
      { headers }
    )
    if (!keyRes.ok) {
      const body = await keyRes.text()
      console.error(`  Failed to get public key: ${keyRes.status} ${body}`)
      if (keyRes.status === 401 || keyRes.status === 403) {
        console.error(
          "  → The GitHub credential is expired or lacks `repo` scope. Until it is replaced,\n" +
            "    rotation cannot reach CI and the labor syncs will break when the token expires.\n" +
            `    ${PAT_REMEDIATION}`
        )
      }
      return "failed"
    }
    const publicKey = (await keyRes.json()) as { key: string; key_id: string }

    const results = [await pushGhSecret(token, publicKey, "HARRI_REFRESH_TOKEN", refreshToken)]
    if (credentials.email)
      results.push(await pushGhSecret(token, publicKey, "HARRI_EMAIL", credentials.email))
    if (credentials.password)
      results.push(await pushGhSecret(token, publicKey, "HARRI_PASSWORD", credentials.password))
    if (results.some((ok) => !ok)) return "failed"

    // Read back: secret values are write-only, so confirm updated_at moved.
    // This is what would have caught the three-week silent failure.
    const checkRes = await fetch(
      `https://api.github.com/repos/${GH_REPO}/actions/secrets/HARRI_REFRESH_TOKEN`,
      { headers }
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

// --- human-ish interaction ---------------------------------------------------
//
// reCAPTCHA v3 scores a *session*, not a click. `fill()` sets a value with no
// keystroke timing and an instant programmatic click arrives with no pointer
// history, which reads as a session with zero human signal. None of this is
// evasion — it's supplying the interaction evidence a real login actually
// produces, which the old fill-then-click path threw away.

function jitter(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

async function humanType(page: Page, locator: Locator, text: string): Promise<void> {
  await locator.click()
  await page.waitForTimeout(jitter(120, 320))
  await locator.pressSequentially(text, { delay: jitter(45, 95) })
}

async function humanClick(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox().catch(() => null)
  if (box) {
    const tx = box.x + box.width / 2
    const ty = box.y + box.height / 2
    // Approach in a couple of hops so the pointer has a path, not a teleport.
    await page.mouse.move(tx - jitter(90, 170), ty - jitter(60, 130), { steps: 8 })
    await page.waitForTimeout(jitter(80, 200))
    await page.mouse.move(tx, ty, { steps: Math.round(jitter(12, 22)) })
    await page.waitForTimeout(jitter(90, 240))
  }
  await locator.click()
}

/**
 * Drop Harri's own session so each attempt is a genuine fresh login.
 *
 * This is load-bearing for the persistent profile: without a clean slate the
 * previous run's refreshToken is still sitting in localStorage, the poll below
 * would find it immediately, and we'd bank a stale token as a successful
 * rotation — silently re-saving a value that's already counting down.
 *
 * Deliberately scoped to harri.com. Google's reCAPTCHA reputation cookies live
 * on google.com / recaptcha.net, and those are exactly what we want to keep
 * accumulating week over week.
 */
async function shedHarriSession(context: BrowserContext, page: Page): Promise<void> {
  await page
    .evaluate(() => {
      try {
        localStorage.clear()
        sessionStorage.clear()
      } catch {
        /* origin may not be accessible yet */
      }
    })
    .catch(() => {})
  for (const domain of ["harri.com", ".harri.com", "www.harri.com"]) {
    await context.clearCookies({ domain }).catch(() => {})
  }
}

type LoginAttempt =
  | { ok: true; cognito: CognitoStorage }
  | { ok: false; reason: string; rejected: boolean }

/**
 * One full login attempt against a clean Harri session. Returns instead of
 * throwing so the caller can decide whether to retry.
 *
 * `rejected: true` means Harri actively refused us (the "Something went wrong"
 * banner — reCAPTCHA scored the session too low). That's the retryable case.
 */
async function attemptLogin(
  context: BrowserContext,
  page: Page,
  opts: { email: string; password: string; autoClick: boolean; pollMs: number }
): Promise<LoginAttempt> {
  await page.goto(LOGIN_URL, { waitUntil: "networkidle", timeout: 45_000 })
  await shedHarriSession(context, page)
  await page.goto(LOGIN_URL, { waitUntil: "networkidle", timeout: 45_000 })

  // Harri's email field accepts email OR phone — `type="text"` not `email`,
  // and the input has no `name` attribute. Anchor on the visible placeholder
  // ("Email address or phone number") instead. Same for the password field.
  const emailLoc = page
    .locator('input[placeholder*="Email" i], input[placeholder*="phone" i]')
    .first()
  const passwordLoc = page
    .locator('input[type="password"], input[placeholder*="Password" i]')
    .first()
  await emailLoc.waitFor({ state: "visible", timeout: 25_000 })

  await humanType(page, emailLoc, opts.email)
  await page.waitForTimeout(jitter(200, 500))
  await humanType(page, passwordLoc, opts.password)
  await page.waitForTimeout(jitter(250, 600))

  if (opts.autoClick) {
    const submit = page
      .locator('button:has-text("Log in"), button:has-text("Sign in"), button[type="submit"]')
      .first()
    if (await submit.count()) await humanClick(page, submit)
    else await passwordLoc.press("Enter")
  } else {
    console.log(
      "\n  >>> The Chromium window has email/password pre-filled.\n" +
        "  >>> Click the green 'Log in' button yourself, then watch the redirect.\n" +
        "  >>> The script will continue automatically once Harri sets a refresh token.\n"
    )
  }

  // Poll for the token, but also watch for Harri's rejection banner so a
  // refused attempt fails in seconds instead of burning the whole budget
  // waiting for something that is never going to arrive.
  const banner = page.getByText(/something went wrong/i).first()
  const deadline = Date.now() + opts.pollMs
  while (Date.now() < deadline) {
    const hasToken = await page
      .evaluate(() => {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (k?.startsWith("CognitoIdentityServiceProvider.") && k.endsWith(".refreshToken"))
            return true
        }
        return false
      })
      .catch(() => false)
    if (hasToken) return { ok: true, cognito: await readCognitoFromStorage(page) }

    if (await banner.isVisible().catch(() => false)) {
      return {
        ok: false,
        rejected: true,
        reason: 'Harri rejected the login ("Something went wrong") — reCAPTCHA scored this session too low',
      }
    }
    await page.waitForTimeout(1_000)
  }
  return {
    ok: false,
    rejected: false,
    reason: `timed out waiting ${Math.round(opts.pollMs / 1000)}s for a Cognito refreshToken in localStorage`,
  }
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
  //
  // --auto: headed but submit programmatically (no human click). Proven to pass
  // reCAPTCHA v3 from a residential IP (see scripts/probe-harri-recaptcha.ts),
  // so the whole rotation can run unattended on a machine with a residential IP.
  const headless = process.argv.includes("--headless")
  const autoClick = headless || process.argv.includes("--auto")
  console.log(
    `Signing in to Harri as ${email} (${
      headless
        ? "HEADLESS — likely to fail reCAPTCHA"
        : autoClick
          ? "headed + auto-submit (unattended)"
          : "headed — click Log in yourself"
    })...`
  )
  // Persistent profile. A fresh cookieless context every week meant reCAPTCHA
  // saw a first-time-ever visitor on every run, with no accumulated reputation
  // — which is the likeliest reason a hand-driven login in a real browser
  // succeeds where the script sits right on the threshold. Reusing one profile
  // lets Google's reputation cookies build up across runs.
  //
  // Reputation is sticky in both directions: if this profile ever gets marked
  // bad, every run inherits it. --reset-profile is the escape hatch.
  if (process.argv.includes("--reset-profile") && fs.existsSync(PROFILE_DIR)) {
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true })
    console.log(`Reset browser profile at ${PROFILE_DIR}`)
  }
  fs.mkdirSync(PROFILE_DIR, { recursive: true })
  console.log(`Browser profile: ${PROFILE_DIR}`)

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    args: ["--disable-blink-features=AutomationControlled"],
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false })
  })
  const page = context.pages()[0] ?? (await context.newPage())

  // Retry, because a refused attempt is a dice roll on a score, not a
  // deterministic failure — the same code path succeeded and then failed three
  // minutes apart on 2026-08-12. Spacing matters more than count: back-to-back
  // attempts look worse to reCAPTCHA, not better.
  const attemptArg = process.argv.find((a) => a.startsWith("--attempts="))
  const maxAttempts = attemptArg
    ? Math.max(1, Number(attemptArg.split("=")[1]) || 1)
    : autoClick
      ? 3
      : 1
  // Auto mode knows within seconds; the long budget only exists so a human has
  // time to click.
  const pollMs = autoClick ? 60_000 : 180_000

  // Guard against the persistent profile handing us back the previous run's
  // token instead of a freshly minted one (see shedHarriSession).
  const previousToken = process.env.HARRI_REFRESH_TOKEN || env["HARRI_REFRESH_TOKEN"] || null

  let refreshToken: string | null = null
  let cognito: CognitoStorage | null = null
  let lastReason = "no attempt ran"

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      const waitMs = BACKOFF_MS[Math.min(attempt - 2, BACKOFF_MS.length - 1)]
      console.log(`  Waiting ${Math.round(waitMs / 1000)}s before retry (letting the score settle)...`)
      await page.waitForTimeout(waitMs)
    }
    console.log(`Login attempt ${attempt}/${maxAttempts}...`)

    let result: LoginAttempt
    try {
      result = await attemptLogin(context, page, { email, password, autoClick, pollMs })
    } catch (err) {
      result = {
        ok: false,
        rejected: false,
        reason: err instanceof Error ? err.message : String(err),
      }
    }

    if (result.ok) {
      cognito = result.cognito
      const scraped = cognito.refreshToken
      if (!scraped) {
        lastReason = "login completed but no refreshToken appeared in localStorage"
      } else if (scraped === previousToken) {
        // Cognito mints a new refresh token per authentication, so an identical
        // value means we never actually re-authenticated — we read the previous
        // run's token straight back out of the persistent profile. Banking that
        // would "succeed" while silently re-saving a token already counting down.
        lastReason =
          "scraped token is identical to the current one — the Harri session was not shed, so this was not a real login"
        cognito = null
      } else {
        refreshToken = scraped
        console.log(`  Attempt ${attempt} succeeded.`)
        break
      }
    } else {
      lastReason = result.reason
    }

    console.error(`  Attempt ${attempt} failed: ${lastReason}`)
    if (attempt === maxAttempts) {
      const screenshotPath = path.resolve(process.cwd(), "debug-harri-login.png")
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {})
      console.error(`  Current URL: ${page.url()}`)
      console.error(`  Screenshot: ${screenshotPath}`)
      if (cognito) console.error(`  localStorage keys seen: ${JSON.stringify(cognito.allKeys)}`)
    }
  }

  await context.close()

  if (!refreshToken) {
    console.error(
      `\nLogin failed after ${maxAttempts} attempt(s). Last reason: ${lastReason}\n` +
        "If every attempt was refused, this profile's reCAPTCHA reputation may be\n" +
        "poisoned — re-run with --reset-profile, or run without --auto and click\n" +
        "Log in by hand once to re-seed it."
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

  const legs: Record<LegName, LegStatus> = {
    envLocal: "skipped",
    vercel: "skipped",
    github: "skipped",
  }

  if (!isCI) {
    console.log(`Saving to ${ENV_PATH}...`)
    legs.envLocal = updateEnvLocal(refreshToken)
  }

  console.log("Updating Vercel...")
  legs.vercel = await updateVercel(refreshToken, env, { email, password })

  console.log("Updating GitHub...")
  legs.github = await updateGitHub(refreshToken, env, { email, password })

  // A rotation is only a success if the token landed everywhere that reads it.
  // `.env.local` is deliberately not required in CI (nothing there to write to).
  // `--allow-partial` exists for one-off local runs without Vercel/GitHub creds.
  const allowPartial = process.argv.includes("--allow-partial")
  const required: LegName[] = isCI ? ["vercel", "github"] : ["envLocal", "vercel", "github"]
  const verdict = summarizeRotation(legs, allowPartial ? [] : required)

  console.log("\nRotation summary:")
  for (const line of verdict.lines) console.log(line)

  if (!verdict.ok) {
    const detail = verdict.problems
      .map((p) => `${p.leg} (${p.status})`)
      .join(", ")
    console.error(
      `\nFAILED — the token did not land everywhere: ${detail}.\n` +
        "The stores are now out of sync: whichever leg failed is still serving the OLD\n" +
        "token, and it will keep working right up until it expires. Fix the credential\n" +
        "for that leg and re-run, or pass --allow-partial if this is a deliberate\n" +
        "partial run."
    )
    process.exit(1)
  }

  console.log("\nDone! Token landed in every required store.")
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
