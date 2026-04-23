import { chromium, type Page } from "@playwright/test"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"

const BASE_URL = process.env.SHOTS_BASE_URL ?? "http://localhost:3000"
const STATE_PATH = resolve(process.cwd(), "tmp-screenshots/_auth/state.json")

const VIEWPORTS = [
  { name: "390", width: 390, height: 844, touch: true },
  { name: "768", width: 768, height: 1024, touch: true },
  { name: "1280", width: 1280, height: 800, touch: false },
] as const

type Mode = "before" | "after"

function parseArgs() {
  const [slug, url, modeArg] = process.argv.slice(2)
  if (!slug || !url) {
    console.error("usage: tsx scripts/mobile-shots.ts <slug> <url-path> [before|after]")
    console.error("  e.g. tsx scripts/mobile-shots.ts 01-sales-summary /dashboard before")
    process.exit(2)
  }
  const mode: Mode = modeArg === "after" ? "after" : "before"
  return { slug, url, mode }
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {})
  await page.evaluate(() => document.fonts.ready).catch(() => {})
  await page.waitForTimeout(600)
}

async function main() {
  const { slug, url, mode } = parseArgs()
  const outDir = resolve(process.cwd(), "tmp-screenshots", slug, mode)
  await mkdir(outDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        storageState: STATE_PATH,
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2,
        hasTouch: vp.touch,
      })
      const page = await context.newPage()
      await page.goto(`${BASE_URL}${url}`, { waitUntil: "domcontentloaded" })
      await settle(page)
      const file = resolve(outDir, `${vp.name}.png`)
      await page.screenshot({ path: file, fullPage: true })
      console.log(`${slug} ${mode} ${vp.name} → ${file}`)
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
