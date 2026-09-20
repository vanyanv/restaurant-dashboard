/*
 * When a tool fails mid-turn the answer used to say the source "did not come
 * back", which is true of a timeout, of a permission error and of a bad
 * argument alike, and tells the reader nothing about whether asking again
 * would help. `failureClause` is the sentence that replaced it.
 */
import { describe, it, expect } from "vitest"
import { failureClause, readFailedReasons } from "@/lib/counter/ask-meta"

describe("failureClause", () => {
  it("keeps the old wording when there is no message at all", () => {
    expect(failureClause(undefined)).toBe("did not come back")
    expect(failureClause("")).toBe("did not come back")
    expect(failureClause("   ")).toBe("did not come back")
  })

  it("names a timeout, which is the one worth retrying", () => {
    expect(failureClause("Error: ETIMEDOUT")).toBe("timed out")
    expect(failureClause("the request timed out after 30s")).toBe("timed out")
    expect(failureClause("AbortError: signal aborted")).toBe("timed out")
  })

  it("names a scope failure, which retrying will not fix", () => {
    expect(failureClause("store(s) not owned by this user: abc")).toBe(
      "not available on this account",
    )
    expect(failureClause("403 Forbidden")).toBe("not available on this account")
  })

  it("names a rate limit", () => {
    expect(failureClause("429 Too Many Requests")).toBe("rate limited")
    expect(failureClause("rate-limit exceeded")).toBe("rate limited")
  })

  it("names an argument rejection, which is ours to fix and not the reader's", () => {
    expect(failureClause("invalid date in dateRange")).toBe(
      "was called with arguments it rejected",
    )
    expect(failureClause("expected string, received number")).toBe(
      "was called with arguments it rejected",
    )
  })

  it("passes an unfamiliar error through rather than hiding it", () => {
    // An unfamiliar error the reader can quote to someone beats a familiar
    // sentence that says nothing.
    expect(failureClause("ECONNRESET reading from upstream")).toBe(
      "ECONNRESET reading from upstream",
    )
  })

  it("trims an unfamiliar error rather than letting it run the line", () => {
    const out = failureClause("z".repeat(300))
    expect(out.length).toBeLessThanOrEqual(90)
    expect(out.endsWith("…")).toBe(true)
  })
})

describe("readFailedReasons", () => {
  it("reads a plain map", () => {
    expect(readFailedReasons({ getDailySales: "boom" })).toEqual({ getDailySales: "boom" })
  })

  it("drops entries that carry no message", () => {
    expect(readFailedReasons({ a: "", b: "   ", c: 7, d: null, e: "real" })).toEqual({
      e: "real",
    })
  })

  it("returns an empty map for anything that is not one", () => {
    for (const v of [null, undefined, "x", 3, [], [1, 2]]) {
      expect(readFailedReasons(v)).toEqual({})
    }
  })
})
