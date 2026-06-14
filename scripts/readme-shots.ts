import { chromium, type Page } from "@playwright/test"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"

const BASE_URL = process.env.SHOTS_BASE_URL ?? "http://localhost:3000"
const STATE_PATH = resolve(process.cwd(), "tmp-screenshots/_auth/state.json")
const OUT_DIR = resolve(process.cwd(), "docs/screenshots")

const SHOTS = [
  { file: "dashboard.png", url: "/dashboard", viewport: { width: 1440, height: 900 } },
  { file: "decisions.png", url: "/dashboard/decisions", viewport: { width: 1440, height: 900 } },
  { file: "pnl.png", url: "/dashboard/pnl", viewport: { width: 1440, height: 900 } },
  { file: "labor.png", url: "/dashboard/labor", viewport: { width: 1440, height: 900 } },
  { file: "invoices.png", url: "/dashboard/invoices", viewport: { width: 1440, height: 900 } },
  { file: "mobile.png", url: "/m", viewport: { width: 390, height: 844 }, touch: true },
] as const

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})
  await page.evaluate(() => document.fonts.ready).catch(() => {})
  await page.waitForTimeout(1200)
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  try {
    for (const shot of SHOTS) {
      const context = await browser.newContext({
        storageState: STATE_PATH,
        viewport: shot.viewport,
        deviceScaleFactor: 2,
        hasTouch: "touch" in shot && shot.touch,
      })
      const page = await context.newPage()
      await page.goto(`${BASE_URL}${shot.url}`, { waitUntil: "domcontentloaded" })
      await settle(page)
      const file = resolve(OUT_DIR, shot.file)
      await page.screenshot({ path: file })
      console.log(`${shot.url} → ${file}`)
      await context.close()
    }
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
