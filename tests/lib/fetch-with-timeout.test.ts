// fetchWithTimeout wraps fetch with an AbortController-based timeout (lifted
// from the otter.ts pattern) so a hung upstream can't block a cron forever.

import { describe, it, expect, vi, afterEach } from "vitest"
import { fetchWithTimeout } from "@/lib/fetch-with-timeout"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** A fetch that never resolves on its own — only rejects when its signal aborts,
 * the way the real fetch behaves under AbortController. */
function hangingFetch() {
  return (_url: string, init?: { signal?: AbortSignal }) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"))
      })
    })
}

describe("fetchWithTimeout", () => {
  it("returns the response when fetch resolves before the timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })))
    const res = await fetchWithTimeout("https://api.example.com", {}, 1000)
    expect(res.status).toBe(200)
  })

  it("throws a timeout error when fetch outlasts the timeout", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("fetch", vi.fn(hangingFetch()))
    const p = fetchWithTimeout("https://api.example.com", {}, 1000)
    // Surface the rejection to the handler before advancing, so the unhandled
    // rejection isn't flagged, then drive the clock past the timeout.
    const assertion = expect(p).rejects.toThrow(/timed out/i)
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })

  it("passes through a non-abort fetch rejection unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down")
      }),
    )
    await expect(fetchWithTimeout("https://api.example.com")).rejects.toThrow("network down")
  })

  it("forwards init (method, headers) to the underlying fetch", async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(null, { status: 204 }),
    )
    vi.stubGlobal("fetch", spy)
    await fetchWithTimeout("https://api.example.com", {
      method: "POST",
      headers: { "x-test": "1" },
    })
    const init = spy.mock.calls[0]?.[1]
    expect(init).toBeDefined()
    expect(init!.method).toBe("POST")
    expect((init!.headers as Record<string, string>)["x-test"]).toBe("1")
    expect(init!.signal).toBeInstanceOf(AbortSignal)
  })
})
