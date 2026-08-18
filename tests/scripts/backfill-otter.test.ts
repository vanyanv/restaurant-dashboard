import { afterEach, describe, expect, it } from "vitest"

import { parseArgs, summarizeBackfill } from "../../scripts/backfill-otter"

const REAL_ARGV = process.argv

afterEach(() => {
  process.argv = REAL_ARGV
})

function withArgv<T>(args: string[], fn: () => T): T {
  process.argv = ["node", "scripts/backfill-otter.ts", ...args]
  return fn()
}

/**
 * parseArgs computed `includeRatings` but never returned it (f7034e7), so
 * main()'s reference to it was a free variable. tsx doesn't typecheck and
 * tsconfig excluded scripts/, so the ReferenceError only surfaced in prod:
 * every scheduled run died mid-chunk from 2026-08-17T20:16Z onward while the
 * workflow still reported success.
 */
describe("parseArgs", () => {
  it("returns includeRatings so main() has it in scope", () => {
    expect(withArgv(["3"], parseArgs)).toMatchObject({
      days: 3,
      dailyOnly: false,
      storeIdFilter: null,
      includeRatings: true,
    })
  })

  it("drops ratings when --no-ratings is passed", () => {
    expect(withArgv(["3", "--no-ratings"], parseArgs).includeRatings).toBe(false)
  })

  it("drops ratings when --daily-only is passed", () => {
    expect(withArgv(["3", "--daily-only"], parseArgs).includeRatings).toBe(false)
  })

  it("reads --store-id", () => {
    expect(withArgv(["3", "--store-id=abc"], parseArgs).storeIdFilter).toBe("abc")
  })
})

/**
 * The second half of the same bug: every chunk threw, the per-chunk catch
 * logged and continued, and the script still exited 0 — so `if: failure()`
 * never fired and no incident issue opened for 24h. Same shape as the frozen
 * -secret bug pinned in refresh-otter-jwt.test.ts.
 */
describe("summarizeBackfill", () => {
  it("is ok when every store synced cleanly", () => {
    expect(
      summarizeBackfill([{ name: "Hollywood", daily: 441, chunkFailures: 0 }]).ok,
    ).toBe(true)
  })

  it("fails when a chunk threw, even though other stores succeeded", () => {
    const verdict = summarizeBackfill([
      { name: "Hollywood", daily: 0, chunkFailures: 1 },
      { name: "Glendale", daily: 12, chunkFailures: 0 },
    ])
    expect(verdict.ok).toBe(false)
    expect(verdict.problems.join(" ")).toContain("Hollywood")
  })

  it("fails when a store was processed but wrote nothing", () => {
    expect(
      summarizeBackfill([{ name: "Hollywood", daily: 0, chunkFailures: 0 }]).ok,
    ).toBe(false)
  })

  it("is ok with no stores at all — nothing was asked of it", () => {
    expect(summarizeBackfill([]).ok).toBe(true)
  })
})
