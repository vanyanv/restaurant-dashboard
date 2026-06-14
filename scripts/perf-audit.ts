import { chromium, type BrowserContext, type Page } from "@playwright/test"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

const BASE_URL = process.env.PERF_BASE_URL ?? process.env.SHOTS_BASE_URL ?? "http://localhost:3000"
const STATE_PATH = resolve(process.cwd(), "tmp-screenshots/_auth/state.json")

const ROUTES = [
  "/",
  "/login",
  "/dashboard",
  "/dashboard/analytics",
  "/dashboard/chat",
  "/dashboard/cogs",
  "/dashboard/ingredients",
  "/dashboard/ingredients/prices",
  "/dashboard/invites",
  "/dashboard/invoices",
  "/dashboard/menu",
  "/dashboard/menu/catalog",
  "/dashboard/operations",
  "/dashboard/operations/costs",
  "/dashboard/operations/inventory",
  "/dashboard/operations/inventory/count/new",
  "/dashboard/operations/inventory/counts",
  "/dashboard/operations/packaging",
  "/dashboard/operations/product-usage",
  "/dashboard/operations/recipes",
  "/dashboard/operations/vendors",
  "/dashboard/orders",
  "/dashboard/pnl",
  "/dashboard/product-mix",
  "/dashboard/recipes",
  "/dashboard/settings",
  "/dashboard/settings/account",
  "/dashboard/settings/notifications",
  "/dashboard/settings/preferences",
  "/dashboard/stores",
  "/dashboard/stores/new",
  "/m",
  "/m/analytics",
  "/m/chat",
  "/m/cogs",
  "/m/count",
  "/m/ingredients",
  "/m/invoices",
  "/m/labor",
  "/m/menu",
  "/m/more",
  "/m/operations",
  "/m/orders",
  "/m/pnl",
  "/m/product-mix",
  "/m/recipes",
  "/m/settings",
  "/m/stores",
] as const

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, touch: true },
  { name: "desktop", width: 1280, height: 800, touch: false },
] as const

type Mode = "before" | "after" | "snapshot"

type AuditRecord = {
  route: string
  viewport: string
  status: number | null
  url: string
  navMs: number
  fcpMs: number | null
  lcpMs: number | null
  cls: number
  longTaskCount: number
  longTaskMs: number
  domNodes: number
  jsHeapMb: number | null
  scrollMs: number | null
  searchMs: number | null
  screenshot: string
}

function parseArgs() {
  const args = process.argv.slice(2)
  let mode: Mode = "snapshot"
  let slug = new Date().toISOString().replace(/[:.]/g, "-")
  let routeFilter: string[] | null = null
  let viewportFilter: string[] | null = null

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--mode") mode = (args[++i] as Mode | undefined) ?? mode
    else if (arg === "--slug") slug = args[++i] ?? slug
    else if (arg === "--routes") routeFilter = (args[++i] ?? "").split(",").filter(Boolean)
    else if (arg === "--viewports") viewportFilter = (args[++i] ?? "").split(",").filter(Boolean)
  }

  const routes = routeFilter?.length
    ? ROUTES.filter((route) =>
        routeFilter!.some((filter) =>
          filter.startsWith("/") ? route === filter : route.includes(filter),
        ),
      )
    : [...ROUTES]
  const viewports = viewportFilter?.length
    ? VIEWPORTS.filter((vp) => viewportFilter!.includes(vp.name))
    : [...VIEWPORTS]

  if (!routes.length) throw new Error("No routes matched --routes")
  if (!viewports.length) throw new Error("No viewports matched --viewports")

  return { mode, slug, routes, viewports }
}

async function instrument(page: Page) {
  await page.addInitScript(() => {
    ;(window as unknown as { __perfLongTasks: number[] }).__perfLongTasks = []
    try {
      const observer = new PerformanceObserver((list) => {
        const store = (window as unknown as { __perfLongTasks: number[] }).__perfLongTasks
        for (const entry of list.getEntries()) store.push(entry.duration)
      })
      observer.observe({ type: "longtask", buffered: true })
    } catch {
      // Long Task API is not available in every browser context.
    }
  })
}

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {})
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {})
  await page.evaluate(() => document.fonts.ready).catch(() => {})
  await page.waitForTimeout(350)
}

async function measureScroll(page: Page): Promise<number | null> {
  return page
    .evaluate(async () => {
      const target =
        document.querySelector<HTMLElement>("[data-perf-scroll]") ??
        document.querySelector<HTMLElement>(".m-shell__main") ??
        document.scrollingElement
      if (!target) return null
      const start = performance.now()
      for (let i = 0; i < 6; i++) {
        target.scrollBy({ top: 420, behavior: "instant" })
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
      return Math.round(performance.now() - start)
    })
    .catch(() => null)
}

async function measureSearch(page: Page): Promise<number | null> {
  const search = page.locator('input[type="search"], input[aria-label*="Search"]').first()
  if (!(await search.count().catch(() => 0))) return null
  const started = Date.now()
  await search.fill("chicken").catch(() => {})
  await page.waitForTimeout(100)
  return Date.now() - started
}

async function collect(page: Page): Promise<Omit<AuditRecord, "route" | "viewport" | "status" | "url" | "screenshot">> {
  const [timings, longTasks, domNodes, jsHeapMb, scrollMs, searchMs] = await Promise.all([
    page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
      const paint = performance.getEntriesByType("paint")
      const fcp = paint.find((entry) => entry.name === "first-contentful-paint")
      const lcp = performance.getEntriesByType("largest-contentful-paint").at(-1)
      const cls = performance
        .getEntriesByType("layout-shift")
        .reduce((sum, entry) => {
          const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean }
          return shift.hadRecentInput ? sum : sum + (shift.value ?? 0)
        }, 0)
      return {
        navMs: nav ? Math.round(nav.loadEventEnd - nav.startTime) : 0,
        fcpMs: fcp ? Math.round(fcp.startTime) : null,
        lcpMs: lcp ? Math.round(lcp.startTime) : null,
        cls: Number(cls.toFixed(4)),
      }
    }),
    page.evaluate(() => (window as unknown as { __perfLongTasks?: number[] }).__perfLongTasks ?? []),
    page.evaluate(() => document.querySelectorAll("*").length),
    page
      .evaluate(() => {
        const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
        return memory ? Math.round((memory.usedJSHeapSize / 1024 / 1024) * 10) / 10 : null
      })
      .catch(() => null),
    measureScroll(page),
    measureSearch(page),
  ])

  return {
    ...timings,
    longTaskCount: longTasks.length,
    longTaskMs: Math.round(longTasks.reduce((sum, duration) => sum + duration, 0)),
    domNodes,
    jsHeapMb,
    scrollMs,
    searchMs,
  }
}

async function auditRoute(
  context: BrowserContext,
  route: string,
  viewport: (typeof VIEWPORTS)[number],
  outDir: string,
): Promise<AuditRecord> {
  const page = await context.newPage()
  await instrument(page)
  const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" })
  await settle(page)
  const metrics = await collect(page)
  const safeRoute = route.replace(/^\//, "").replace(/[/?&=]/g, "_") || "home"
  const screenshot = resolve(outDir, `${viewport.name}-${safeRoute}.png`)
  await page.screenshot({ path: screenshot, fullPage: true })
  const record: AuditRecord = {
    route,
    viewport: viewport.name,
    status: response?.status() ?? null,
    url: page.url(),
    screenshot,
    ...metrics,
  }
  await page.close()
  return record
}

function markdown(records: AuditRecord[]) {
  const rows = records
    .map((r) =>
      [
        r.viewport,
        r.route,
        r.status ?? "",
        r.fcpMs ?? "",
        r.lcpMs ?? "",
        r.cls,
        r.domNodes,
        r.longTaskCount,
        r.longTaskMs,
        r.scrollMs ?? "",
        r.searchMs ?? "",
      ].join(" | "),
    )
    .join("\n")
  return [
    "# Perf Audit",
    "",
    `Base URL: ${BASE_URL}`,
    "",
    "viewport | route | status | FCP ms | LCP ms | CLS | DOM nodes | long tasks | long task ms | scroll ms | search ms",
    "--- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---:",
    rows,
    "",
  ].join("\n")
}

async function main() {
  const { mode, slug, routes, viewports } = parseArgs()
  const outDir = resolve(process.cwd(), "tmp", "perf-audit", slug, mode)
  await mkdir(outDir, { recursive: true })
  await mkdir(dirname(STATE_PATH), { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const records: AuditRecord[] = []
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        storageState: STATE_PATH,
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 2,
        hasTouch: viewport.touch,
      })
      for (const route of routes) {
        const record = await auditRoute(context, route, viewport, outDir)
        records.push(record)
        console.log(
          `${viewport.name} ${route} FCP=${record.fcpMs ?? "n/a"} LCP=${record.lcpMs ?? "n/a"} DOM=${record.domNodes}`,
        )
      }
      await context.close()
    }
  } finally {
    await browser.close()
  }

  await writeFile(resolve(outDir, "perf-audit.json"), JSON.stringify(records, null, 2))
  await writeFile(resolve(outDir, "perf-audit.md"), markdown(records))
  console.log(`perf audit saved to ${outDir}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
