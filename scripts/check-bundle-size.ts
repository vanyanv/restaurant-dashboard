#!/usr/bin/env tsx
/**
 * Per-route bundle budget gate.
 *
 * Reads `.next/diagnostics/route-bundle-stats.json` (Turbopack-emitted),
 * sums uncompressed and gzipped JS for each route's first load, prints
 * a sorted table, and exits non-zero if any route exceeds its budget.
 *
 * Run after `next build`. Wired into CI via .github/workflows/bundle-budget.yml.
 *
 * Budget tuning lives in BUDGETS below. Defaults were set after PR 1–3
 * landed; raise them only if you've genuinely earned headroom (a new
 * feature pulls a needed lib), not to silence the gate.
 */

import { readFileSync, statSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { resolve } from "node:path"

interface RouteEntry {
  route: string
  firstLoadUncompressedJsBytes: number
  firstLoadChunkPaths: string[]
}

interface RouteResult {
  route: string
  uncompressed: number
  gzipped: number
  overBudget: boolean
  budget: number
}

interface BudgetRule {
  match: (route: string) => boolean
  /** First-load JS budget in uncompressed bytes. */
  uncompressedBytes: number
  label: string
}

/** Order matters — first match wins. Keep tightest budgets at the top.
 *
 * Numbers reflect post-PR3 baseline + ~5% headroom. Auth/marketing is
 * inflated by framer-motion in the login/signup forms (deferred to a
 * follow-up PR); when that lands, drop the auth budget to ~600 KB. */
const BUDGETS: BudgetRule[] = [
  {
    label: "auth + marketing",
    match: (r) => r === "/login" || r === "/" || r === "/signup/[token]",
    uncompressedBytes: 800_000,
  },
  {
    label: "mobile shell",
    match: (r) => r.startsWith("/m"),
    uncompressedBytes: 700_000,
  },
  {
    label: "dashboard chat (AI SDK)",
    match: (r) => r === "/dashboard/chat",
    uncompressedBytes: 1_750_000,
  },
  {
    label: "dashboard route",
    match: (r) => r.startsWith("/dashboard"),
    uncompressedBytes: 1_600_000,
  },
  {
    label: "default",
    match: () => true,
    uncompressedBytes: 1_500_000,
  },
]

function pickBudget(route: string): BudgetRule {
  return BUDGETS.find((b) => b.match(route))!
}

function fmtKb(bytes: number): string {
  return (bytes / 1024).toFixed(1) + " KB"
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length)
}

function main(): number {
  const statsPath = resolve(".next/diagnostics/route-bundle-stats.json")
  let stats: RouteEntry[]
  try {
    stats = JSON.parse(readFileSync(statsPath, "utf8")) as RouteEntry[]
  } catch (err) {
    console.error(
      `bundle-budget: could not read ${statsPath}. Did you run \`next build\` first?`
    )
    console.error(err)
    return 2
  }

  const gzipCache = new Map<string, number>()
  const gzipBytes = (chunkPath: string): number => {
    const cached = gzipCache.get(chunkPath)
    if (cached !== undefined) return cached
    try {
      const buf = readFileSync(chunkPath)
      const out = gzipSync(buf).length
      gzipCache.set(chunkPath, out)
      return out
    } catch {
      // Some manifest entries reference non-existent paths in edge cases;
      // fall back to file size if available, otherwise zero.
      try {
        return statSync(chunkPath).size
      } catch {
        return 0
      }
    }
  }

  const results: RouteResult[] = stats.map((entry) => {
    const budget = pickBudget(entry.route)
    const gzipped = entry.firstLoadChunkPaths.reduce(
      (sum, p) => sum + gzipBytes(p),
      0
    )
    return {
      route: entry.route,
      uncompressed: entry.firstLoadUncompressedJsBytes,
      gzipped,
      overBudget: entry.firstLoadUncompressedJsBytes > budget.uncompressedBytes,
      budget: budget.uncompressedBytes,
    }
  })

  // Sort heaviest-first so review eyes hit the biggest costs immediately.
  results.sort((a, b) => b.uncompressed - a.uncompressed)

  const routeWidth = Math.max(
    20,
    ...results.map((r) => r.route.length)
  )

  console.log(
    pad("route", routeWidth) +
      "  " +
      pad("uncompressed", 14) +
      pad("gzipped", 12) +
      pad("budget", 14) +
      "status"
  )
  console.log("─".repeat(routeWidth + 56))

  for (const r of results) {
    const status = r.overBudget ? "❌ OVER" : "✓"
    console.log(
      pad(r.route, routeWidth) +
        "  " +
        pad(fmtKb(r.uncompressed), 14) +
        pad(fmtKb(r.gzipped), 12) +
        pad(fmtKb(r.budget), 14) +
        status
    )
  }

  const overCount = results.filter((r) => r.overBudget).length
  console.log("")
  if (overCount === 0) {
    console.log(`✓ all ${results.length} routes under budget`)
    return 0
  }
  console.log(
    `❌ ${overCount} of ${results.length} route(s) exceed their budget`
  )
  console.log("")
  console.log("Either:")
  console.log("  • profile the regression (npm run analyze) and trim it, or")
  console.log("  • raise the matching budget in scripts/check-bundle-size.ts")
  console.log("    if the increase is genuinely earned.")
  return 1
}

process.exit(main())
