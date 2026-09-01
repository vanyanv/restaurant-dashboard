/**
 * How long every screen takes, measured against a production build.
 *
 * ## Why this exists next to `scripts/perf-audit.ts`
 *
 * `perf-audit.ts` walks a HAND-WRITTEN route list, at two viewports, and its
 * list has been stale since the Counter rebuild started — it names
 * `/dashboard/recipes` and `/dashboard/operations/recipes` and knows nothing
 * about `/dashboard/decisions`, `/dashboard/usage` or the phone's `(counter)`
 * tree. This one takes its routes from `e2e/fidelity/routes.ts`, the same
 * list every sweep walks, so a page cannot be rebuilt into existence without
 * also being timed.
 *
 * ## The four numbers, and why these four
 *
 * - **ttfb** — `responseStart - startTime`. On a streamed RSC page this is the
 *   shell: the layout rendered, the `loading.tsx` fallback flushed. It is the
 *   number a reader experiences as "did anything happen".
 * - **stream** — `responseEnd - responseStart`. The rest of the document: every
 *   Suspense boundary resolving as its `get*SectionPromises` settle. This is
 *   where a slow Prisma query lives, and it is invisible to any metric that
 *   stops at first byte. A page whose ttfb is 40ms and whose stream is 4s is
 *   a fast shell over a slow database, and the fix is in the loader.
 * - **lcp** — what the reader sees painted, via PerformanceObserver.
 * - **bytes / requests** — transfer size over the whole load, JS split out,
 *   because a page can be slow for having shipped a chart library it renders
 *   once.
 *
 * ## Warm first, then take the minimum of two
 *
 * The first hit on a route in a fresh `next start` pays for module loading and
 * an unprimed query plan, and that cost is real but it is paid once per
 * deploy, not once per reader. Timing it would rank pages by which one the
 * sweep happened to open first. So: one discarded warm-up, then two measured
 * loads, keep the faster. A page that is genuinely slow is slow on both.
 *
 * Usage:
 *   npx tsx scripts/perf-sweep.ts                     # both surfaces
 *   npx tsx scripts/perf-sweep.ts --desk              # one surface
 *   PERF_BASE_URL=http://localhost:3100 npx tsx scripts/perf-sweep.ts
 */
import { chromium, devices, type Browser, type Page } from "@playwright/test"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { deskRoutes, phoneRoutes } from "../e2e/fidelity/routes"

const BASE_URL = process.env.PERF_BASE_URL ?? "http://localhost:3100"
const STATE = resolve(process.cwd(), "e2e/.auth/user.json")
const OUT = resolve(process.cwd(), process.env.PERF_OUT ?? "tmp-perf/sweep.json")

interface Sample {
  route: string
  surface: "desk" | "phone"
  ttfb: number
  stream: number
  dcl: number
  lcp: number
  bytes: number
  jsBytes: number
  requests: number
  status: number
}

/** Everything the page can tell us about its own load, read after `load`. */
async function measure(page: Page, route: string): Promise<Omit<Sample, "route" | "surface">> {
  // The observer has to be armed before the navigation, so it is installed as
  // an init script on the context, not here. See `openContext`.
  const res = await page.goto(route, { waitUntil: "load", timeout: 60_000 })
  // A streamed document reaches `load` when the last boundary has flushed, but
  // client-side fetches (TanStack Query hydrating a card) keep going. A short
  // settle catches the LCP those cause without waiting for polling to idle.
  await page.waitForTimeout(600)

  // A STRING, not a function literal.
  //
  // This file runs under tsx, and esbuild's `keepNames` rewrites every named
  // arrow inside a transformed function to call a `__name` helper that exists
  // in the Node module scope and nowhere else. Playwright serialises the
  // function and evaluates it in the PAGE, where the helper is absent, so the
  // first route came back `ReferenceError: __name is not defined` rather than
  // a timing. Source text has nothing to rewrite.
  const m = (await page.evaluate(MEASURE_SOURCE)) as Omit<Sample, "route" | "surface">
  return { ...m, status: res?.status() ?? 0 }
}

const MEASURE_SOURCE = `(() => {
  var nav = performance.getEntriesByType("navigation")[0]
  var resources = performance.getEntriesByType("resource")
  // encodedBodySize, NOT transferSize.
  //
  // Each route is loaded three times in a row, so every load after the first
  // is served from the memory cache and reports transferSize 0 — the whole
  // js column came back "0kB" on the first full sweep, for every page, which
  // is a measurement artefact and not a page that ships no JavaScript.
  // encodedBodySize is the compressed payload the response carried whether or
  // not the network was involved.
  var sum = function (rs) { return rs.reduce(function (n, r) { return n + (r.encodedBodySize || 0) }, 0) }
  var js = resources.filter(function (r) { return r.name.indexOf(".js") !== -1 })
  return {
    ttfb: Math.round(nav ? nav.responseStart : 0),
    stream: Math.round(nav ? nav.responseEnd - nav.responseStart : 0),
    dcl: Math.round(nav ? nav.domContentLoadedEventEnd : 0),
    lcp: Math.round(window.__lcp || 0),
    bytes: (nav ? nav.encodedBodySize : 0) + sum(resources),
    jsBytes: sum(js),
    requests: resources.length + 1,
    status: 200,
  }
})()`

async function openContext(browser: Browser, surface: "desk" | "phone") {
  const context = await browser.newContext({
    ...(surface === "phone" ? devices["Pixel 7"] : { viewport: { width: 1440, height: 900 } }),
    storageState: STATE,
    baseURL: BASE_URL,
  })
  // Largest Contentful Paint is only observable from inside the page, and only
  // if the observer exists before the paint. `buffered: true` catches entries
  // emitted before this script ran; the assignment keeps the LAST one, which is
  // what LCP means.
  // Source text for the same reason `MEASURE_SOURCE` is: under tsx this would
  // otherwise carry esbuild's `__name` helper into a page that has no such
  // binding. Firefox and WebKit do not implement the entry type; Chromium is
  // what we run, and the try/catch keeps a missing implementation quiet.
  await context.addInitScript({
    content: `
      window.__lcp = 0
      try {
        new PerformanceObserver(function (list) {
          var entries = list.getEntries()
          for (var i = 0; i < entries.length; i++) window.__lcp = Math.round(entries[i].startTime)
        }).observe({ type: "largest-contentful-paint", buffered: true })
      } catch (e) {}
    `,
  })
  return context
}

async function sweep(browser: Browser, surface: "desk" | "phone", routes: string[]) {
  const context = await openContext(browser, surface)
  const page = await context.newPage()
  const samples: Sample[] = []

  for (const route of routes) {
    try {
      await measure(page, route) // discarded: module load, cold query plan
      const a = await measure(page, route)
      const b = await measure(page, route)
      const best = a.ttfb + a.stream <= b.ttfb + b.stream ? a : b
      samples.push({ route, surface, ...best })
      const total = best.ttfb + best.stream
      process.stdout.write(
        `${surface === "desk" ? "🖥 " : "📱"} ${String(total).padStart(6)}ms  ` +
          `ttfb ${String(best.ttfb).padStart(5)}  stream ${String(best.stream).padStart(6)}  ` +
          `lcp ${String(best.lcp).padStart(5)}  ${route}\n`,
      )
    } catch (error) {
      process.stdout.write(`${surface} FAILED ${route}: ${(error as Error).message}\n`)
    }
  }

  await context.close()
  return samples
}

async function main() {
  const only = process.argv.includes("--desk")
    ? "desk"
    : process.argv.includes("--phone")
      ? "phone"
      : "both"

  const browser = await chromium.launch()
  const samples: Sample[] = []
  if (only !== "phone") samples.push(...(await sweep(browser, "desk", deskRoutes())))
  if (only !== "desk") samples.push(...(await sweep(browser, "phone", phoneRoutes())))
  await browser.close()

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(samples, null, 2))

  const ranked = [...samples].sort((a, b) => b.ttfb + b.stream - (a.ttfb + a.stream))
  process.stdout.write(`\n\nSLOWEST 25 (server time = ttfb + stream)\n`)
  for (const s of ranked.slice(0, 25)) {
    process.stdout.write(
      `${String(s.ttfb + s.stream).padStart(6)}ms  ttfb ${String(s.ttfb).padStart(5)}  ` +
        `stream ${String(s.stream).padStart(6)}  lcp ${String(s.lcp).padStart(5)}  ` +
        `js ${String(Math.round(s.jsBytes / 1024)).padStart(4)}kB  ${s.surface} ${s.route}\n`,
    )
  }
  const totals = samples.map((s) => s.ttfb + s.stream).sort((a, b) => a - b)
  const at = (q: number) => totals[Math.min(totals.length - 1, Math.floor(totals.length * q))]
  process.stdout.write(
    `\nn=${totals.length}  p50 ${at(0.5)}ms  p75 ${at(0.75)}ms  p95 ${at(0.95)}ms  max ${totals.at(-1)}ms\n` +
      `written to ${OUT}\n`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
