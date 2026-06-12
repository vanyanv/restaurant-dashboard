// scripts/probe-harri-recaptcha.ts
//
// SPIKE (incident #42/#43): can we mint a fresh Harri refresh token without a
// human, using only a self-harvested reCAPTCHA v3 token (no paid solver)?
//
// reCAPTCHA v3 is an invisible *score*, not an image challenge — so "solving"
// it just means producing a token that Google scores high enough for Harri's
// Cognito pre-auth Lambda to accept. This probe drives the real login form,
// intercepts the Cognito InitiateAuth call to learn (a) the reCAPTCHA site key,
// (b) the grecaptcha action, and (c) exactly how the web app passes the token
// into Cognito (ClientMetadata vs ValidationData, field name) — then reports
// whether an automated submit actually obtains a refresh token.
//
// The verdict that matters is the GitHub-Actions one: v3 scores datacenter IPs
// low, so a local PASS does NOT imply a CI PASS. Run it both ways:
//   pnpm tsx scripts/probe-harri-recaptcha.ts            # headed, local
//   pnpm tsx scripts/probe-harri-recaptcha.ts --ci       # headless+autoclick (CI gate)
//
// Exit 0 = obtained a refresh token head-less (automatable). Exit 1 = blocked;
// the captured diagnostics explain why.

import fs from "fs"
import path from "path"
import { chromium, type Page, type Request } from "playwright"

const LOGIN_URL = "https://harri.com/user/login"
const COGNITO_HOST = "cognito-idp."

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i === -1) continue
    const k = t.slice(0, i).trim()
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "")
  }
}
loadEnvLocal()

type CognitoCapture = { action?: string; body?: unknown; status?: number; responseSnippet?: string }

function summarizeAuthRequest(req: Request): CognitoCapture {
  const target = req.headers()["x-amz-target"] || ""
  let body: unknown
  try {
    body = JSON.parse(req.postData() || "{}")
  } catch {
    body = req.postData()
  }
  return { action: target.split(".").pop(), body }
}

/** Pull the reCAPTCHA site key + any rendered actions out of the live page. */
async function harvestSiteKey(page: Page): Promise<{ siteKey?: string; sources: string[] }> {
  return page.evaluate(() => {
    const sources: string[] = []
    let siteKey: string | undefined
    for (const s of Array.from(document.querySelectorAll("script[src]"))) {
      const src = (s as HTMLScriptElement).src
      if (/recaptcha|gstatic/.test(src)) {
        sources.push(src)
        const m = src.match(/[?&]render=([^&]+)/)
        if (m && m[1] !== "explicit") siteKey = decodeURIComponent(m[1])
      }
    }
    const cfg = (window as unknown as { ___grecaptcha_cfg?: { clients?: unknown } }).___grecaptcha_cfg
    if (cfg) sources.push("window.___grecaptcha_cfg present")
    return { siteKey, sources }
  })
}

async function hasRefreshToken(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith("CognitoIdentityServiceProvider.") && k.endsWith(".refreshToken"))
          return true
      }
      return false
    })
    .catch(() => false)
}

async function main() {
  const email = process.env.HARRI_EMAIL
  const password = process.env.HARRI_PASSWORD
  if (!email || !password) {
    console.error("HARRI_EMAIL and HARRI_PASSWORD are required (.env.local or CI secrets)")
    process.exit(1)
  }
  const ci = process.argv.includes("--ci") || process.argv.includes("--headless") || !!process.env.CI

  console.log(`\n[probe] mode=${ci ? "headless/autoclick (CI gate)" : "headed/local"}`)
  const browser = await chromium.launch({
    headless: ci,
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

  const captures: CognitoCapture[] = []
  page.on("request", (req) => {
    if (req.url().includes(COGNITO_HOST) && req.method() === "POST") {
      captures.push(summarizeAuthRequest(req))
    }
  })
  page.on("response", async (res) => {
    if (res.url().includes(COGNITO_HOST) && res.request().method() === "POST") {
      const last = captures[captures.length - 1]
      if (last) {
        last.status = res.status()
        last.responseSnippet = (await res.text().catch(() => "")).slice(0, 300)
      }
    }
  })

  let obtained = false
  try {
    await page.goto(LOGIN_URL, { waitUntil: "networkidle", timeout: 45_000 })

    const recaptcha = await harvestSiteKey(page)
    console.log(`[probe] reCAPTCHA siteKey=${recaptcha.siteKey ?? "not-found"}`)
    console.log(`[probe] reCAPTCHA sources=${JSON.stringify(recaptcha.sources)}`)

    const emailLoc = page
      .locator('input[placeholder*="Email" i], input[placeholder*="phone" i]')
      .first()
    const passwordLoc = page
      .locator('input[type="password"], input[placeholder*="Password" i]')
      .first()
    await emailLoc.waitFor({ state: "visible", timeout: 25_000 })
    await emailLoc.fill(email)
    await passwordLoc.fill(password)

    if (ci) {
      const submit = page
        .locator('button:has-text("Log in"), button:has-text("Sign in"), button[type="submit"]')
        .first()
      if (await submit.count()) await submit.click()
      else await passwordLoc.press("Enter")
    } else {
      console.log(
        "\n  >>> Credentials pre-filled. Click 'Log in' yourself so reCAPTCHA v3 sees a real gesture.\n",
      )
    }

    const deadline = Date.now() + (ci ? 60_000 : 180_000)
    while (Date.now() < deadline) {
      if (await hasRefreshToken(page)) {
        obtained = true
        break
      }
      await page.waitForTimeout(1500)
    }
  } catch (err) {
    console.error(`[probe] error: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    await browser.close()
  }

  console.log("\n========== PROBE DIAGNOSTICS ==========")
  for (const c of captures) {
    const meta =
      c.body && typeof c.body === "object"
        ? (c.body as Record<string, unknown>)
        : ({} as Record<string, unknown>)
    console.log(
      `  ${c.action} → HTTP ${c.status ?? "?"} | AuthFlow=${meta.AuthFlow ?? "?"} | ` +
        `ClientMetadata=${JSON.stringify(meta.ClientMetadata ?? meta.ValidationData ?? null)} | ` +
        `resp=${c.responseSnippet ?? ""}`,
    )
  }
  console.log(`\n[probe] VERDICT: ${obtained ? "PASS — minted refresh token head-less" : "FAIL — no token (see diagnostics above)"}`)
  process.exit(obtained ? 0 : 1)
}

main().catch((err) => {
  console.error("[probe] fatal:", err)
  process.exit(1)
})
