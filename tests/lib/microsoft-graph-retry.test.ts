import { afterEach, describe, expect, it, vi } from "vitest"
import { graphGet } from "@/lib/microsoft-graph"

afterEach(() => vi.unstubAllGlobals())

function stub(...statuses: number[]) {
  const fn = vi.fn()
  for (const s of statuses) fn.mockResolvedValueOnce(new Response("{}", { status: s }))
  vi.stubGlobal("fetch", fn)
  return fn
}

describe("graphGet", () => {
  it("tries once more after a Graph 502 and returns the second answer", async () => {
    const fn = stub(502, 200)
    const res = await graphGet("https://graph.example/x", "t", 0)
    expect(res.status).toBe(200)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("retries only once", async () => {
    const fn = stub(503, 503)
    const res = await graphGet("https://graph.example/x", "t", 0)
    expect(res.status).toBe(503)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("does not retry other errors", async () => {
    const fn = stub(403)
    const res = await graphGet("https://graph.example/x", "t", 0)
    expect(res.status).toBe(403)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
