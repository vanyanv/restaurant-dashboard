import { describe, it, expect } from "vitest"
import { classify } from "@/lib/counter/adapters/types"
import { empty, notComputed } from "@/lib/counter/section-data"

describe("classify", () => {
  it("wraps a resolved value as ready", async () => {
    const sd = await classify(() => Promise.resolve({ n: 1 }), { retryAction: "sync" })
    expect(sd).toEqual({ status: "ready", data: { n: 1 } })
  })

  it("turns a thrown error into a named failure, not a crashed page", async () => {
    // One section failing must not take the page with it. That is how this app
    // already behaves, and the reader keeps every figure that did load.
    const sd = await classify(
      () => Promise.reject(new Error("Otter sync timed out")),
      { retryAction: "retrySync" },
    )
    expect(sd).toEqual({
      status: "failed", error: "Otter sync timed out", retryAction: "retrySync",
    })
  })

  it("uses a generic message when the thrown thing is not an Error", async () => {
    const sd = await classify(() => Promise.reject("boom"), { retryAction: "x" })
    expect(sd.status).toBe("failed")
    if (sd.status === "failed") expect(sd.error).toBe("Something went wrong loading this section")
  })

  it("reports empty when the caller says the result is empty", async () => {
    const sd = await classify(() => Promise.resolve([]), {
      retryAction: "x",
      isEmpty: (v) => v.length === 0,
      emptyReason: "no_match",
    })
    expect(sd).toEqual(empty("no_match"))
  })

  it("prefers a caller's pre_open reason, because a store with no customers is not a filter miss", async () => {
    const sd = await classify(() => Promise.resolve([]), {
      retryAction: "x",
      isEmpty: (v) => v.length === 0,
      emptyReason: "pre_open",
    })
    expect(sd).toEqual(empty("pre_open"))
  })

  it("marks a section stale when the caller supplies a last-good time", async () => {
    const at = new Date(2026, 7, 24, 9, 0)
    const sd = await classify(() => Promise.resolve({ n: 1 }), { retryAction: "x", staleSince: at })
    expect(sd).toEqual({ status: "stale", data: { n: 1 }, lastGoodAt: at })
  })

  it("never throws, whatever the loader does — a page must always render", async () => {
    await expect(
      classify(() => { throw new Error("sync throw") }, { retryAction: "x" }),
    ).resolves.toMatchObject({ status: "failed" })
  })

  it("owed() short-circuits without calling the loader at all", async () => {
    let called = false
    const sd = await classify(() => { called = true; return Promise.resolve(1) }, {
      retryAction: "x",
      owed: "clock-in/out leak ledger",
    })
    expect(sd).toEqual(notComputed("clock-in/out leak ledger"))
    // A section nobody has built must not pay for a query.
    expect(called).toBe(false)
  })
})
