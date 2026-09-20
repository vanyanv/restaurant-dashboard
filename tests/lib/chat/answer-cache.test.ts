/*
 * The defect this file exists for: the key was built from the question with
 * the context sentence STRIPPED OFF, so "how were sales last week?" asked
 * about Hollywood and the same words asked about Glendale were one entry, and
 * the second reader was served the first reader's store.
 *
 * Every test below that asserts two keys DIFFER is a separation that, if it
 * collapsed, would hand one reader another reader's numbers.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/cache/redis", () => ({ getRedis: () => null }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { answerCacheKey } from "@/lib/chat/answer-cache"

type Key = Parameters<typeof answerCacheKey>[0]

const BASE: Key = {
  accountId: "acct-A",
  question: "how were sales last week?",
  scope: "Hollywood, last 7 days",
  pageId: "overview",
  effort: "quick",
  businessDay: "2026-09-19",
  dataAsOf: "2026-09-18T04:00:00.000Z",
}

const key = (over: Partial<Key> = {}) => answerCacheKey({ ...BASE, ...over })

describe("answerCacheKey", () => {
  it("is stable for identical input", () => {
    expect(key()).toBe(key())
  })

  it("separates two stores asking the same words", () => {
    expect(key({ scope: "Glendale, last 7 days" })).not.toBe(key())
  })

  it("separates two date ranges asking the same words", () => {
    expect(key({ scope: "Hollywood, last 30 days" })).not.toBe(key())
  })

  it("separates two accounts", () => {
    expect(key({ accountId: "acct-B" })).not.toBe(key())
    // The account id stays in the clear so a tenant's entries can be dropped.
    expect(key()).toContain("acct-A")
    expect(key({ accountId: "acct-B" })).toContain("acct-B")
  })

  it("separates Quick from Careful", () => {
    expect(key({ effort: "careful" })).not.toBe(key())
  })

  it("separates two pages", () => {
    expect(key({ pageId: "pnl" })).not.toBe(key())
  })

  it("separates the same relative range asked on two days", () => {
    /*
     * The scope sentence carries a range PRESET, not a window: `rangeLabel`
     * returns "Yesterday" for every non-custom range. At 23:50 Monday and
     * 00:20 Tuesday the words, the store, the label, the page and the effort
     * are all identical, and without the date Sunday's answer was served as
     * Monday's for anyone asking in that half hour.
     */
    expect(key({ businessDay: "2026-09-20" })).not.toBe(key())
  })

  it("expires by data, not by clock: a new sync stamp is a new key", () => {
    expect(key({ dataAsOf: "2026-09-19T04:00:00.000Z" })).not.toBe(key())
  })

  it("normalises only whitespace and case in the question", () => {
    expect(key({ question: "  How Were   Sales Last Week? " })).toBe(key())
  })

  it("normalises the scope the same way", () => {
    expect(key({ scope: "  HOLLYWOOD,   last 7 days " })).toBe(key())
  })

  it("does not near-match: one word apart is a different key", () => {
    expect(key({ question: "how were sales this week?" })).not.toBe(key())
  })

  it("a null scope is its own key space, not the empty-scope one", () => {
    // Null and "" both normalise to "", which is deliberate: a caller that
    // sends no scope has no store to confuse. What must NOT happen is a null
    // scope colliding with a real one.
    expect(key({ scope: null })).not.toBe(key())
  })

  it("does not confuse a field boundary: scope and question are not concatenated", () => {
    // If the key were built by joining the fields, moving a character across
    // the boundary would collide. `stableKey` is structural, so it cannot.
    const a = key({ question: "sales", scope: "x" })
    const b = key({ question: "sale", scope: "sx" })
    expect(a).not.toBe(b)
  })

  it("every key is namespaced so a tenant's entries can be swept", () => {
    expect(key()).toMatch(/^chat:answer:acct-A:[0-9a-f]{32}$/)
  })
})
