import { describe, expect, it } from "vitest"
import { readdirSync } from "node:fs"
import path from "node:path"
import { sourceOf, USAGE_SOURCES } from "@/lib/usage/source"

const CASES: [string, string | null, string][] = [
  ["/api/tv/checkin", null, "tv"],
  ["/tv/abc", null, "tv"],
  ["/tv", null, "tv"],
  ["/checks/XY12", null, "crew"],
  ["/api/checks/submit", null, "crew"],
  ["/m/overview", null, "phone"],
  ["/api/chat/stream", "https://x/m/ask", "ask"],
  ["/dashboard/ask", null, "ask"],
  ["/m/ask", null, "ask"],
  ["/api/cron/retention", null, "sync"],
  ["/dashboard/pnl", null, "dashboard"],
  ["/dashboard/pnl/?range=7d", null, "dashboard"],
  ["/api/stores", "https://x/m/overview", "phone"],
  ["/api/stores", "https://x/dashboard/pnl", "dashboard"],
  ["/api/stores", "not a url", "dashboard"],
  ["/api/stores", "https://x/login", "dashboard"],
  ["/login", null, "other"],
  ["/api/auth/session", "https://x/m/overview", "other"],
  ["/", null, "other"],
  ["/dashboard/checks", null, "dashboard"],
  ["/m/checks/today", null, "phone"],
  ["/television", null, "other"],
]

describe("sourceOf", () => {
  it.each(CASES)("%s (referer %s) is %s", (pathname, referer, expected) => {
    expect(sourceOf(pathname, referer)).toBe(expected)
  })

  it("lists the seven sources", () => {
    expect([...USAGE_SOURCES].sort()).toEqual(
      ["ask", "crew", "dashboard", "other", "phone", "sync", "tv"],
    )
  })
})

/** Routes that are meant to land in "other". A new route outside this list
 * that maps to "other" fails the test below: give it a rule or add it here. */
const EXPECTED_OTHER = [
  /^\/$/,
  /^\/login$/,
  /^\/signup\//,
  /^\/shutdown/,
  /^\/api\/auth\//,
  /^\/offline$/,
]

function routes(dir: string, url = ""): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const group = /^\(.*\)$/.test(entry.name) || entry.name.startsWith("@")
      out.push(...routes(path.join(dir, entry.name), group ? url : `${url}/${entry.name}`))
    } else if (entry.name === "page.tsx" || entry.name === "route.ts") {
      out.push(url || "/")
    }
  }
  return out
}

describe("every route in src/app has a source", () => {
  const all = [...new Set(routes(path.join(process.cwd(), "src/app")))]

  it("finds the routes", () => {
    expect(all.length).toBeGreaterThan(100)
  })

  it("maps none to other by accident", () => {
    const strays = all.filter(
      (r) => sourceOf(r) === "other" && !EXPECTED_OTHER.some((re) => re.test(r)),
    )
    expect(strays, `routes with no usage source: ${strays.join(", ")}`).toEqual([])
  })
})
