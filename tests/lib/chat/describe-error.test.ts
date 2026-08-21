// Turning a raw transport error into something the owner can act on. The
// research finding this exists for: a generic "Something went wrong" toast is
// the single most-cited anti-pattern, because it tells the reader neither what
// happened nor what to do next. Every branch here must name a cause and offer
// exactly one recovery.

import { describe, it, expect } from "vitest"
import { describeChatError } from "@/lib/chat/describe-error"

describe("describeChatError", () => {
  it("names a dead thread and offers to start a new one", () => {
    const e = describeChatError("NOT_FOUND")
    expect(e.title).toMatch(/thread/i)
    expect(e.retryLabel).toMatch(/new thread/i)
  })

  it("names an ownership failure without offering a retry that cannot work", () => {
    const e = describeChatError("NOT_OWNED")
    expect(e.title).toMatch(/access/i)
    expect(e.retryLabel).toBeNull()
  })

  it("sends an expired session to sign in rather than to retry", () => {
    const e = describeChatError("401 Unauthorized")
    expect(e.detail).toMatch(/sign in/i)
    expect(e.retryLabel).toBeNull()
  })

  it("names a rate limit and offers a retry", () => {
    const e = describeChatError("429 Too Many Requests")
    expect(e.title).toMatch(/too many/i)
    expect(e.retryLabel).toMatch(/try again/i)
  })

  it("names a timeout separately from a generic failure", () => {
    const e = describeChatError("The operation timed out")
    expect(e.title).toMatch(/took too long/i)
    expect(e.retryLabel).toMatch(/try again/i)
  })

  it("names a network drop", () => {
    const e = describeChatError("TypeError: Failed to fetch")
    expect(e.title).toMatch(/connection/i)
    expect(e.retryLabel).toMatch(/try again/i)
  })

  it("falls back to a retryable failure for anything unrecognised", () => {
    const e = describeChatError("some upstream nonsense")
    expect(e.title).toBeTruthy()
    expect(e.retryLabel).toMatch(/try again/i)
  })

  it("never returns an empty title", () => {
    for (const raw of ["", undefined, "   "]) {
      expect(describeChatError(raw).title.length).toBeGreaterThan(0)
    }
  })

  it("does not leak a raw stack trace into the detail line", () => {
    const e = describeChatError("Error: boom\n    at Object.<anonymous> (/app/x.js:1:1)")
    expect(e.detail).not.toContain("    at ")
  })

  it("is case-insensitive about the codes it recognises", () => {
    expect(describeChatError("not_found").title).toBe(describeChatError("NOT_FOUND").title)
  })
})
