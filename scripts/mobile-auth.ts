import { chromium } from "@playwright/test"
import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"

const BASE_URL = process.env.SHOTS_BASE_URL ?? "http://localhost:3000"
const EMAIL = process.env.SHOTS_EMAIL ?? "demo@restaurantos.com"
const PASSWORD = process.env.SHOTS_PASSWORD ?? "demo123"
const STATE_PATH = resolve(process.cwd(), "tmp-screenshots/_auth/state.json")

async function main() {
  await mkdir(dirname(STATE_PATH), { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" })
  const email = page.locator('input[type="email"]')
  const password = page.locator('input[type="password"]')
  await email.waitFor({ state: "visible", timeout: 10_000 })
  await email.fill(EMAIL)
  await password.fill(PASSWORD)
  await password.press("Enter")
  try {
    await page.waitForURL(/\/dashboard(\/|$|\?)/, { timeout: 30_000 })
  } catch (err) {
    const bodyText = (await page.locator("body").innerText().catch(() => ""))
      .slice(0, 400)
    console.error("login did not redirect. body (truncated):\n" + bodyText)
    throw err
  }

  await context.storageState({ path: STATE_PATH })
  await browser.close()
  console.log(`auth state saved → ${STATE_PATH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
