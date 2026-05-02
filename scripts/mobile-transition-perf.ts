import { chromium, type Page } from "@playwright/test"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const BASE_URL =
  process.env.PERF_BASE_URL ?? process.env.SHOTS_BASE_URL ?? "http://localhost:3000"
const STATE_PATH = resolve(process.cwd(), "tmp-screenshots/_auth/state.json")

const ROUTES = ["/m", "/m/invoices", "/m/chat", "/m/pnl", "/m/more"] as const

type Mode = "before" | "after" | "snapshot"

type TransitionRecord = {
  route: string
  from: string
  shellMs: number | null
  readyMs: number | null
  longTaskCount: number
  longTaskMs: number
  maxLongTaskMs: number
  domNodes: number
  cls: number
  screenshot: string
}

function parseArgs() {
  const args = process.argv.slice(2)
  let mode: Mode = "snapshot"
  let slug = new Date().toISOString().replace(/[:.]/g, "-")
  let routes = [...ROUTES] as string[]

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--mode") mode = (args[++i] as Mode | undefined) ?? mode
    else if (arg === "--slug") slug = args[++i] ?? slug
    else if (arg === "--routes") {
      const requested = (args[++i] ?? "").split(",").filter(Boolean)
      if (requested.length) routes = requested
    }
  }

  return { mode, slug, routes }
}

async function instrument(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __transitionLongTasks: number[]
      __transitionReset: () => void
    }
    w.__transitionLongTasks = []
    w.__transitionReset = () => {
      w.__transitionLongTasks = []
    }
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          w.__transitionLongTasks.push(entry.duration)
        }
      })
      observer.observe({ type: "longtask", buffered: true })
    } catch {
      // Long Task API is unavailable in some browser contexts.
    }
  })
}

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {})
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {})
  await page.evaluate(() => document.fonts.ready).catch(() => {})
}

async function waitReady(page: Page, route: string) {
  await page.waitForSelector(`[data-perf-ready="${route}"]`, {
    timeout: 20_000,
  })
}

async function measureRoute(
  page: Page,
  route: string,
  outDir: string,
): Promise<TransitionRecord> {
  const from = route === "/m/more" ? "/m" : "/m/more"
  await page.goto(`${BASE_URL}${from}`, { waitUntil: "domcontentloaded" })
  await settle(page)
  await waitReady(page, from)

  // Give the mobile tab bar's idle prefetch a chance to warm likely routes.
  await page.waitForTimeout(1200)
  await page.evaluate(() => {
    ;(window as unknown as { __transitionReset?: () => void }).__transitionReset?.()
  })

  const started = await page.evaluate(() => performance.now())
  await page.locator(`.m-tabbar a[href="${route}"]`).click()

  let shellMs: number | null = null
  try {
    await page.waitForSelector(
      `[data-perf-shell="${route}"], [data-perf-ready="${route}"]`,
      { timeout: 20_000 },
    )
    shellMs = Math.round((await page.evaluate(() => performance.now())) - started)
  } catch {
    shellMs = null
  }

  let readyMs: number | null = null
  try {
    await waitReady(page, route)
    readyMs = Math.round((await page.evaluate(() => performance.now())) - started)
  } catch {
    readyMs = null
  }

  await settle(page)
  await page.waitForTimeout(200)

  const [longTasks, domNodes, cls] = await Promise.all([
    page.evaluate(
      () =>
        (window as unknown as { __transitionLongTasks?: number[] })
          .__transitionLongTasks ?? [],
    ),
    page.evaluate(() => document.querySelectorAll("*").length),
    page.evaluate(() =>
      Number(
        performance
          .getEntriesByType("layout-shift")
          .reduce((sum, entry) => {
            const shift = entry as PerformanceEntry & {
              value?: number
              hadRecentInput?: boolean
            }
            return shift.hadRecentInput ? sum : sum + (shift.value ?? 0)
          }, 0)
          .toFixed(4),
      ),
    ),
  ])

  const safeRoute = route.replace(/^\//, "").replace(/[/?&=]/g, "_") || "home"
  const screenshot = resolve(outDir, `transition-${safeRoute}.png`)
  await page.screenshot({ path: screenshot, fullPage: true })

  return {
    route,
    from,
    shellMs,
    readyMs,
    longTaskCount: longTasks.length,
    longTaskMs: Math.round(longTasks.reduce((sum, ms) => sum + ms, 0)),
    maxLongTaskMs: Math.round(Math.max(0, ...longTasks)),
    domNodes,
    cls,
    screenshot,
  }
}

function markdown(records: TransitionRecord[]) {
  const rows = records
    .map((r) =>
      [
        r.route,
        r.from,
        r.shellMs ?? "",
        r.readyMs ?? "",
        r.longTaskCount,
        r.longTaskMs,
        r.maxLongTaskMs,
        r.domNodes,
        r.cls,
      ].join(" | "),
    )
    .join("\n")

  return [
    "# Mobile Transition Perf",
    "",
    `Base URL: ${BASE_URL}`,
    "",
    "route | from | shell ms | ready ms | long tasks | long task ms | max long task ms | DOM nodes | CLS",
    "--- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---:",
    rows,
    "",
  ].join("\n")
}

async function main() {
  const { mode, slug, routes } = parseArgs()
  const outDir = resolve(process.cwd(), "tmp", "perf-audit", slug, mode)
  await mkdir(outDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({
      storageState: STATE_PATH,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      hasTouch: true,
    })
    const page = await context.newPage()
    await instrument(page)
    const records: TransitionRecord[] = []
    for (const route of routes) {
      const record = await measureRoute(page, route, outDir)
      records.push(record)
      console.log(
        `${route} shell=${record.shellMs ?? "n/a"}ms ready=${record.readyMs ?? "n/a"}ms long=${record.maxLongTaskMs}ms`,
      )
    }
    await writeFile(
      resolve(outDir, "mobile-transition-perf.json"),
      JSON.stringify(records, null, 2),
    )
    await writeFile(
      resolve(outDir, "mobile-transition-perf.md"),
      markdown(records),
    )
    await context.close()
    console.log(`mobile transition perf saved to ${outDir}`)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
