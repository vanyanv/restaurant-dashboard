/**
 * Sign in and screenshot a dashboard route.
 *
 *   npm run shot -- /dashboard/decisions out.png [width]
 *
 * This exists because browser verification kept failing on the login step and
 * getting written off as "the credentials in .env.test.local don't work". They
 * do. Every failure so far has been in the throwaway script doing the signing
 * in: an `#email` selector the login form does not have, or a base URL of
 * 127.0.0.1 when the rest of the repo uses localhost. The fix is to stop
 * writing that script each time.
 *
 * Credentials come from `.env.test.local` — the same file Playwright reads, so
 * there is one place to change them and no second copy to drift. Nothing here
 * hardcodes a password.
 */

import { chromium, type Page } from "@playwright/test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ENV_FILE = ".env.test.local"
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000"

function readEnvValue(file: string, key: string): string {
  let raw: string
  try {
    raw = readFileSync(resolve(process.cwd(), file), "utf8")
  } catch {
    throw new Error(
      `${file} not found. It holds E2E_USER_EMAIL and E2E_USER_PASSWORD; the seed default is demo@restaurantos.com (see prisma/seed.ts).`,
    )
  }
  const match = raw.match(new RegExp(`^${key}=(.*)$`, "m"))
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "")
  if (!value) throw new Error(`${key} is missing or empty in ${file}`)
  return value
}

/**
 * The login form's fields carry no ids, so select on type. Submitting with
 * Enter rather than clicking a button matches `scripts/mobile-auth.ts` and
 * survives the button's label changing.
 */
async function signIn(page: Page): Promise<void> {
  const email = readEnvValue(ENV_FILE, "E2E_USER_EMAIL")
  const password = readEnvValue(ENV_FILE, "E2E_USER_PASSWORD")

  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" })
  const emailField = page.locator('input[type="email"]')
  await emailField.waitFor({ state: "visible", timeout: 15_000 })
  await emailField.fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('input[type="password"]').press("Enter")

  try {
    // 90s: on a cold `.next` the first hit to the sign-in path pays for a
    // full Turbopack compile, which outruns 45 seconds. Same root cause as
    // e2e/auth.setup.ts's raised ceiling — and the same misreading it caused
    // there ("the credentials don't work") is exactly what this file's module
    // comment exists to prevent. A warm server signs in in under a second.
    await page.waitForURL(/\/dashboard(\/|$|\?)/, { timeout: 90_000 })
  } catch (err) {
    // Say which of the three usual suspects it is, rather than "login failed".
    const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 300)
    throw new Error(
      `Sign-in did not reach /dashboard (still at ${page.url()}).\n` +
        `Check: the dev server is up at ${BASE_URL}; SERVICE_SHUTDOWN_AT is unset ` +
        `(a live gate blanks the app for everyone but the owner); ${ENV_FILE} matches a real user.\n` +
        `Page said: ${body}\n${String(err)}`,
    )
  }
}

async function main() {
  const [route, out, width, theme] = process.argv.slice(2)
  if (!route || !out) {
    console.error("usage: npm run shot -- <route> <out.png> [width] [light|dark]")
    process.exit(1)
  }
  if (theme && theme !== "light" && theme !== "dark") {
    console.error(`unknown theme "${theme}" — expected light or dark`)
    process.exit(1)
  }

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: Number(width) || 1440, height: 1000 },
  })
  // Counter's dark theme is NOT the OS preference. `counter.css` pins
  // `:root { color-scheme: light }` deliberately (the ~95% of the app that is
  // still the pre-Counter editorial design is frozen at light values, and a
  // followed OS preference half-inverted it), so Playwright's `colorScheme`
  // context option does nothing here — verified: it produced a byte-identical
  // screenshot. The only lever is an EXPLICIT choice, which
  // CounterThemeProvider reads from localStorage and applies as an inline
  // `style.color-scheme` on <html>. Seeding that key is the same thing the
  // theme toggle does, without needing to find and click it.
  if (theme) {
    await context.addInitScript((t) => {
      try {
        localStorage.setItem("counter-theme", t as string)
      } catch {
        /* a context with site data blocked just renders the default */
      }
    }, theme)
  }
  const page = await context.newPage()

  // A page that throws on the client can still screenshot as a plausible
  // layout, so surface the console rather than trusting the picture.
  const errors: string[] = []
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 200))
  })
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)))

  try {
    await signIn(page)
    /*
     * `domcontentloaded`, not `networkidle`.
     *
     * A Counter route never reaches network idle — something (a poll, a
     * stream, an open connection) keeps a request in flight indefinitely, so
     * `networkidle` sat until the 120s timeout and every screenshot of
     * `/dashboard` failed. That is not a page problem; it is the wrong
     * readiness signal for this app. Task 7 hit it on all four of its shots
     * and had to write throwaway drivers to get a picture at all.
     *
     * The real signal is the Counter shell being painted: `#ct-main` exists
     * once the page has rendered, and the settle below covers fonts and the
     * entry animation (`cnter`, 0.34s plus a per-child delay). A route that
     * genuinely fails to render still fails, and fast — it just fails on a
     * missing selector rather than on a timeout that says nothing.
     */
    await page.goto(`${BASE_URL}${route}`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    })
    await page
      .locator("#ct-main, main")
      .first()
      .waitFor({ state: "visible", timeout: 60_000 })
    await page.waitForTimeout(2_000)
    await page.screenshot({ path: out, fullPage: true })
    console.log(`${page.url()} → ${out}`)
    if (errors.length > 0) {
      console.log("console errors:", errors.slice(0, 8))
    }
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
