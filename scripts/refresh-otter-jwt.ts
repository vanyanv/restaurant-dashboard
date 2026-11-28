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

import "../src/lib/usage/script-meter-register" // usage counts; keep first
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { chromium, type Page } from "playwright"
import sodium from "libsodium-wrappers"

import { PAT_REMEDIATION, resolveGitHubCredential } from "../src/lib/github-credential"
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

/**
 * Otter UUIDs used only to prove a freshly-minted token can actually read data.
 *
 * These are Hollywood's, deliberately. They used to be one Van Nuys UUID and
 * one Glendale UUID — both stores are pre-open and have never served a
 * customer, so the verification query could only ever come back empty and
 * "Verification passed: got 0 row(s)" meant nothing beyond "Otter returned
 * 200". Hollywood trades every day, so a zero here is a real signal.
 *
 * Hardcoded because this script runs in CI without DATABASE_URL and must not
 * grow a Prisma dependency just to look up two constants.
 */
const STORE_IDS = [
  "f8f941a6-9c18-49ed-896a-5b2213ba09a4",
  "8c836303-8d5d-4c32-b9d1-a1ca5325b191",
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

function isoDay(d: Date, endOfDay: boolean): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
}

async function verifyToken(
  jwt: string,
  { requireRows = false }: { requireRows?: boolean } = {},
): Promise<boolean> {
  // Seven days, not just today: the rotation runs at 00:00 UTC, which is
  // mid-afternoon in Los Angeles on the *previous* business day, and a
  // single-day window that happens to be empty tells us nothing.
  const now = new Date()
  const minDate = isoDay(new Date(now.getTime() - 7 * 86_400_000), false)
  const maxDate = isoDay(now, true)

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
      if (data.rows.length === 0 && requireRows) {
        // A token picked up in the browser could belong to anything on the
        // sign-in pages. Hollywood trades daily, so one that reads no week of
        // its sales has not proved it is the dashboard's token: refuse it.
        console.error("  Verification failed: seven days of Hollywood returned no rows.")
        return false
      }
      if (data.rows.length === 0) {
        // Not fatal — refusing to save a good token because Otter had a data
        // blip is worse than saving it. But Hollywood trades daily, so an
        // empty week means either the token can read nothing or Otter is
        // returning nothing, and both are worth seeing in the cron log.
        console.warn(
          "  WARNING: seven days of Hollywood returned no rows. The token was accepted" +
            " but proved no data access.",
        )
      }
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
  const credential = resolveGitHubCredential(process.env, env)
  if (!credential) {
    console.error("  Skipped (neither GH_PAT nor GH_TOKEN set)")
    console.error(`  ${PAT_REMEDIATION}`)
    return "skipped"
  }
  // A rotating credential still works today, so this is a warning rather than a
  // failed leg — but it is the shape that has twice frozen a secret months later.
  if (!credential.durable) console.error(`  WARNING: ${credential.warning}`)
  const token = credential.token

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
            `    ${PAT_REMEDIATION}`,
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

/**
 * How many times the browser sign-in is tried before the run gives up.
 *
 * Since 2026-11-06 the nightly run has failed about every other night with
 * "Login timed out" while sitting on iam.cloudkitchens.com/login: some page
 * loads now go through Otter's new single sign-on page, which never calls
 * the old /api/users/sign_in endpoint the script waited for, and some still
 * get the old form. A fresh browser usually lands on whichever works.
 */
const BROWSER_ATTEMPTS = 3

/**
 * True when `value` is shaped like a JWT whose `exp` is still ahead. Shape
 * only — the real test is verifyToken() reading data with it.
 */
export function looksLikeLiveJwt(value: unknown, nowMs = Date.now()): value is string {
  if (typeof value !== "string") return false
  const parts = value.split(".")
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return false
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString())
    return typeof payload.exp === "number" && payload.exp * 1000 > nowMs
  } catch {
    return false
  }
}

/** Seconds until the token's `exp`, or null if it has none. */
export function secondsLeft(token: string, nowMs = Date.now()): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())
    return typeof payload.exp === "number" ? Math.floor(payload.exp - nowMs / 1000) : null
  } catch {
    return null
  }
}

/**
 * The shortest life a token may have to be saved. The rotation runs once a
 * day; a token that dies within hours (an OAuth access token from the new
 * sign-on page, say) would leave Vercel and GitHub holding a dead secret
 * while the run reported success, which is the 2026-08-13 failure again.
 */
export const MIN_TOKEN_LIFETIME_S = 12 * 3600

/** Candidates worth verifying, longest-lived first; short-lived ones dropped. */
export function rankCandidates(tokens: string[], nowMs = Date.now()): string[] {
  return tokens
    .map((t) => ({ t, left: secondsLeft(t, nowMs) ?? -1 }))
    .filter(({ left }) => left >= MIN_TOKEN_LIFETIME_S)
    .sort((a, b) => b.left - a.left)
    .map(({ t }) => t)
}

/** The token in an `Authorization: Bearer …` header value, if there is one. */
export function jwtFromAuthHeader(value: string | undefined, nowMs = Date.now()): string | null {
  if (!value) return null
  const token = value.replace(/^Bearer\s+/i, "").trim()
  return looksLikeLiveJwt(token, nowMs) ? token : null
}

/** The token in a sign-in or OAuth token response body, if there is one. */
export function jwtFromBody(body: unknown, nowMs = Date.now()): string | null {
  if (!body || typeof body !== "object") return null
  const record = body as Record<string, unknown>
  for (const key of ["accessToken", "access_token", "token", "jwt"]) {
    if (looksLikeLiveJwt(record[key], nowMs)) return record[key] as string
  }
  return null
}

/**
 * Host and path only. Failure logs are posted to a GitHub issue, and OAuth
 * query strings carry one-time codes, so they never go in the log.
 */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname}`
  } catch {
    return "(unparseable url)"
  }
}

/** The same direct sign-in src/lib/otter.ts falls back to. */
type DirectResult = { token: string | null; credentialsRejected: boolean }

async function signInDirect(email: string, password: string): Promise<DirectResult> {
  try {
    const res = await fetch(SIGN_IN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "*/*",
        Origin: "https://manager.tryotter.com",
        Referer: "https://manager.tryotter.com/",
        "User-Agent": BROWSER_USER_AGENT,
      },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(30_000),
    })
    if (res.status === 401 || res.status === 422) {
      // Wrong or changed password. Trying it three more times in a browser
      // only risks locking the account, which would also break the app's
      // own fallback sign-in.
      console.error(`  Direct sign-in answered ${res.status}: Otter refused the email/password.`)
      return { token: null, credentialsRejected: true }
    }
    if (!res.ok) {
      console.log(`  Direct sign-in answered ${res.status}; trying the browser.`)
      return { token: null, credentialsRejected: false }
    }
    const fromHeader = jwtFromAuthHeader(res.headers.get("authorization") ?? undefined)
    if (fromHeader) return { token: fromHeader, credentialsRejected: false }
    const fromBody = jwtFromBody(await res.json().catch(() => null))
    if (!fromBody) console.log("  Direct sign-in answered 200 without a token; trying the browser.")
    return { token: fromBody, credentialsRejected: false }
  } catch (err) {
    console.log(`  Direct sign-in did not answer (${err instanceof Error ? err.message : String(err)}); trying the browser.`)
    return { token: null, credentialsRejected: false }
  }
}

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"

const EMAIL_FIELD = '[data-testid="op-auth_email-field"]'
const PASSWORD_FIELD = '[data-testid="op-auth_password-field"]'
const LOGIN_BUTTON = '[data-testid="op-auth_login-button"]'

/**
 * True when the page is on the Otter dashboard's host. The old sign-in form
 * is served from that host too, so the caller also checks the email field is
 * gone before treating the browser as signed in.
 */
function onDashboard(url: string): boolean {
  try {
    return new URL(url).hostname === "manager.tryotter.com"
  } catch {
    return false
  }
}

/**
 * What a failed attempt looked like, in words. No screenshot: this repository
 * is public, so workflow artifacts are too, and a login-page screenshot shows
 * the account email (and, past the login, the store's sales). The page title,
 * the pages visited (host and path only) and any on-page error message are
 * enough to tell "the sign-on page changed" from "Otter said no".
 */
async function describePage(page: Page, visited: string[]): Promise<void> {
  console.error(`  Pages visited: ${visited.join(" -> ") || "(none)"}`)
  console.error(`  Ended on: ${redactUrl(page.url())}`)
  const title = await page.title().catch(() => "")
  if (title) console.error(`  Page title: ${title.slice(0, 120)}`)
  const alerts = await page
    .locator('[role="alert"], [aria-live="assertive"]')
    .allInnerTexts()
    .catch(() => [] as string[])
  const message = alerts.map((t) => t.trim()).filter(Boolean).join(" | ")
  if (message) console.error(`  Message on the page: ${message.slice(0, 200)}`)
}

function isOtterOrIamHost(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return ["tryotter.com", "cloudkitchens.com"].some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    )
  } catch {
    return false
  }
}

/**
 * One headless-browser sign-in. Returns every token seen, newest last.
 *
 * Tokens are taken from wherever the sign-in puts one: the old sign-in
 * response's Authorization header, a token-shaped field in any Otter / IAM
 * JSON response (the new single sign-on finishes with a token exchange), or
 * the Authorization header the dashboard itself sends once it is signed in.
 * The caller verifies each one, so a wrong pick is refused, never saved.
 */
async function signInWithBrowser(
  email: string,
  password: string,
  attempt: number,
): Promise<string[]> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  })
  const found: string[] = []
  const note = (token: string | null) => {
    if (token && !found.includes(token)) found.push(token)
  }
  const visited: string[] = []
  let page: Page | undefined

  try {
    const context = await browser.newContext({ userAgent: BROWSER_USER_AGENT })
    const tab = await context.newPage()
    page = tab
    await tab.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false })
    })

    page.on("framenavigated", (frame) => {
      if (frame === tab.mainFrame()) visited.push(redactUrl(frame.url()))
    })
    page.on("request", (request) => {
      if (!isOtterOrIamHost(request.url())) return
      note(jwtFromAuthHeader(request.headers()["authorization"]))
    })
    page.on("response", async (response) => {
      if (!isOtterOrIamHost(response.url())) return
      note(jwtFromAuthHeader(response.headers()["authorization"]))
      const type = response.headers()["content-type"] ?? ""
      if (response.status() === 200 && type.includes("json")) {
        note(jwtFromBody(await response.json().catch(() => null)))
      }
    })

    // Do NOT wait for "networkidle" here. The login SPA holds a connection
    // open for the life of the page, so the 500ms of network silence
    // networkidle waits for never arrives and the goto burns its whole
    // timeout — that is the 2026-08-28 failure, where every daily run died on
    // `page.goto: Timeout 30000ms exceeded` while the form was interactive in
    // under three seconds. The email field is the real readiness signal.
    await page.goto("https://manager.tryotter.com", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    })
    await page.waitForSelector(EMAIL_FIELD, { timeout: 60_000 })
    await page.fill(EMAIL_FIELD, email)
    // Single sign-on pages can ask for the email first and the password on a
    // second step; press the button once more if the password isn't shown.
    if (!(await page.isVisible(PASSWORD_FIELD))) {
      await page.click(LOGIN_BUTTON)
      await page.waitForSelector(PASSWORD_FIELD, { state: "visible", timeout: 30_000 })
    }
    await page.fill(PASSWORD_FIELD, password)
    await page.click(LOGIN_BUTTON)

    // Signed in is "a token turned up", not one particular endpoint
    // answering. The first token can be an intermediate one (the sign-on
    // page's own, or a token exchange), so once one is seen keep listening
    // until the dashboard itself is loaded and has made its calls.
    const deadline = Date.now() + 60_000
    let settleUntil: number | null = null
    while (Date.now() < deadline) {
      if (
        found.length > 0 &&
        settleUntil === null &&
        onDashboard(page.url()) &&
        !(await page.isVisible(EMAIL_FIELD).catch(() => true))
      ) {
        settleUntil = Date.now() + 5_000
      }
      if (settleUntil !== null && Date.now() >= settleUntil) break
      await page.waitForTimeout(500)
    }

    if (found.length === 0) {
      console.error(`  Attempt ${attempt}: no token within 60 s.`)
      await describePage(page, visited)
    }
  } catch (err) {
    console.error(
      `  Attempt ${attempt}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
    )
    if (page) await describePage(page, visited)
  } finally {
    await browser.close()
  }
  return found
}

/** First token that passes verifyToken(), or null. */
async function obtainVerifiedJwt(email: string, password: string): Promise<string | null> {
  console.log("Signing in to Otter (direct)...")
  const direct = await signInDirect(email, password)
  if (direct.credentialsRejected) return null
  if (direct.token) {
    const [token] = rankCandidates([direct.token])
    if (!token) {
      console.log(`  Direct token lives ${describeLifetime(direct.token)}; too short to save. Trying the browser.`)
    } else {
      console.log(`Got JWT (${token.length} chars, lives ${describeLifetime(token)}) from the direct sign-in. Verifying...`)
      if (await verifyToken(token)) return token
      console.log("  Direct token failed verification; trying the browser.")
    }
  }

  for (let attempt = 1; attempt <= BROWSER_ATTEMPTS; attempt++) {
    console.log(`Signing in to Otter (headless browser, attempt ${attempt}/${BROWSER_ATTEMPTS})...`)
    const seen = await signInWithBrowser(email, password, attempt)
    const candidates = rankCandidates(seen)
    if (seen.length > candidates.length) {
      console.log(
        `  ${seen.length - candidates.length} token(s) seen that live under ${MIN_TOKEN_LIFETIME_S / 3600} h; not saved.`,
      )
    }
    for (const token of candidates) {
      console.log(`Got JWT (${token.length} chars, lives ${describeLifetime(token)}). Verifying...`)
      if (await verifyToken(token, { requireRows: true })) return token
    }
    if (seen.length > 0) console.error(`  Attempt ${attempt}: no token passed verification.`)
  }
  return null
}

function describeLifetime(token: string): string {
  const left = secondsLeft(token)
  return left === null ? "an unknown time" : `${(left / 3600).toFixed(1)} h`
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

  // 1. Get a token. A direct API sign-in first (no browser, and it is what the
  //    app's own fallback does); then a headless browser, up to
  //    BROWSER_ATTEMPTS times. Every candidate has to read Hollywood's sales
  //    before it is believed.
  const jwt = await obtainVerifiedJwt(email, password)
  if (!jwt) {
    console.error("Could not get a working Otter token. Nothing was saved.")
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
