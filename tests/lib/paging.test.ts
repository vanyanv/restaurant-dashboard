// Bounds for caller-supplied paging. See `src/lib/paging.ts` for why these
// clamp rather than throw.

import { describe, it, expect } from "vitest"
import { pageSize, pageNumber, MAX_PAGE_SIZE } from "@/lib/paging"

describe("pageSize", () => {
  it("passes a sensible value through", () => {
    expect(pageSize(50, 25)).toBe(50)
  })

  it("caps a page size that is really a table scan", () => {
    // The case this exists for: `take: 1_000_000` reached Prisma unbounded.
    expect(pageSize(1_000_000, 25)).toBe(MAX_PAGE_SIZE)
  })

  it("honours a per-site cap below the global one", () => {
    expect(pageSize(500, 15, 100)).toBe(100)
  })

  it("floors at 1 rather than returning an empty page", () => {
    expect(pageSize(0, 25)).toBe(1)
    expect(pageSize(-10, 25)).toBe(1)
  })

  it("falls back for anything that is not an integer", () => {
    // Coercing 2.5 to 2 would hide a caller bug, and Prisma's `take` needs an
    // integer anyway. TypeScript's `limit?: number` is erased at runtime, so
    // all of these genuinely arrive.
    for (const bad of [undefined, null, NaN, Infinity, 2.5, "50", {}, []]) {
      expect(pageSize(bad, 25)).toBe(25)
    }
  })
})

describe("pageNumber", () => {
  it("passes a real page through", () => {
    expect(pageNumber(3)).toBe(3)
  })

  it("floors at 1, because (page - 1) * limit goes negative below it", () => {
    // A negative `skip` is not an empty result — Prisma rejects it, so the
    // caller sees an error page rather than page one.
    expect(pageNumber(0)).toBe(1)
    expect(pageNumber(-5)).toBe(1)
  })

  it("does NOT cap the upper end", () => {
    // A page past the end is a legitimate request that returns nothing.
    // Capping it would silently show a different page than the one asked for.
    expect(pageNumber(10_000)).toBe(10_000)
  })

  it("falls back for anything that is not an integer", () => {
    for (const bad of [undefined, null, NaN, Infinity, 1.5, "2"]) {
      expect(pageNumber(bad)).toBe(1)
    }
  })
})
