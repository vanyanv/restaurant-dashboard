import { describe, it, expect, vi, afterEach } from "vitest"
import { createDedupe } from "@/lib/monitoring/error-dedupe"
import { installServerErrorRecorder, reportServerError } from "@/lib/monitoring/server-error-hook"
import { guardSection } from "@/lib/counter/adapters/types"

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__counterServerErrorRecorder__
})

describe("createDedupe", () => {
  it("lets a key through once per window, then again after it", () => {
    const ok = createDedupe(1000)
    expect(ok("a", 0)).toBe(true)
    expect(ok("a", 500)).toBe(false)
    expect(ok("b", 500)).toBe(true)
    expect(ok("a", 1000)).toBe(true)
  })

  it("never grows past its key limit", () => {
    const ok = createDedupe(60_000, 3)
    for (const k of ["a", "b", "c", "d", "e"]) expect(ok(k, 1)).toBe(true)
  })
})

describe("reportServerError", () => {
  it("is a no-op until the server installs a recorder", () => {
    expect(() => reportServerError({ source: "render", message: "x" })).not.toThrow()
  })

  it("never throws even if the recorder does", () => {
    installServerErrorRecorder(() => {
      throw new Error("db down")
    })
    expect(() => reportServerError({ source: "render", message: "x" })).not.toThrow()
  })
})

describe("guardSection", () => {
  it("still returns a failed section, and now reports the failure with the section's name", async () => {
    const recorder = vi.fn()
    installServerErrorRecorder(recorder)
    const out = await guardSection(Promise.reject(new Error("query timed out")), "retryLabor")
    expect(out.status).toBe("failed")
    expect(recorder).toHaveBeenCalledWith(
      expect.objectContaining({ source: "section", message: "query timed out", metadata: { section: "retryLabor" } }),
    )
  })

  it("does not report Next's redirect or not-found signals as faults", async () => {
    const recorder = vi.fn()
    installServerErrorRecorder(recorder)
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" })
    const notFound = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" })
    await guardSection(Promise.reject(redirect), "retryA")
    await guardSection(Promise.reject(notFound), "retryB")
    expect(recorder).not.toHaveBeenCalled()
  })

  it("reports nothing when the section loads", async () => {
    const recorder = vi.fn()
    installServerErrorRecorder(recorder)
    await guardSection(Promise.resolve({ status: "ready", data: 1 } as never), "retryLabor")
    expect(recorder).not.toHaveBeenCalled()
  })
})
