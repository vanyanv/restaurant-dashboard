import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const spawnSync = vi.hoisted(() => vi.fn(() => ({ status: 0 })))
vi.mock("node:child_process", () => ({ spawnSync, default: { spawnSync } }))

import { count, currentSource, resetMeterForTest, takePending } from "@/lib/usage/meter"
import { flushAtExitSync, installScriptMeter } from "@/lib/usage/script-meter"

const taken = () =>
  Object.fromEntries(
    (takePending()?.rows ?? []).filter((r) => r[2] !== "cpuMs").map((r) => [`${r[1]}/${r[2]}`, r[3]]),
  )

describe("script meter", () => {
  const realFetch = globalThis.fetch
  let uninstall: () => void
  let inner: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetMeterForTest()
    spawnSync.mockClear()
    vi.unstubAllEnvs()
    inner = vi.fn(async () => new Response("ok", { status: 200 }))
    globalThis.fetch = inner as never
    uninstall = installScriptMeter()
  })
  afterEach(() => {
    uninstall()
    globalThis.fetch = realFetch
  })

  it("makes the process a sync source", () => {
    expect(currentSource()).toBe("sync")
  })

  it("counts outside calls by service, whatever form the URL takes", async () => {
    await fetch("https://api.tryotter.com/x")
    await fetch(new URL("https://api.github.com/y"))
    await fetch(new Request("https://api.resend.com/z"))
    await fetch("https://thing.upstash.io/get/a")
    expect(taken()).toEqual({ "sync/out:otter": 1, "sync/out:github": 1, "sync/out:resend": 1 })
  })

  it("counts a refused call", async () => {
    inner.mockResolvedValueOnce(new Response("", { status: 429 }))
    const res = await fetch("https://api.tryotter.com/x")
    expect(res.status).toBe(429)
    expect(taken()).toEqual({ "sync/out:otter": 1, "sync/out:otter:refused": 1 })
  })

  it("lets a failing fetch fail with its own error", async () => {
    const down = new TypeError("fetch failed")
    inner.mockRejectedValueOnce(down)
    await expect(fetch("https://api.tryotter.com/x")).rejects.toBe(down)
    expect(taken()).toEqual({ "sync/out:otter": 1, "sync/out:otter:refused": 1 })
  })

  it("sends the counts with one blocking command as the process exits", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://thing.upstash.io")
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", 'tok"en')
    expect(process.listeners("exit")).toContain(flushAtExitSync)
    count("sync", "dbQueries", 4)
    flushAtExitSync()
    flushAtExitSync()
    expect(spawnSync).toHaveBeenCalledTimes(1)
    const [cmd, args, opts] = spawnSync.mock.calls[0] as unknown as [string, string[], { input: string }]
    expect(cmd).toBe("curl")
    expect(args.join(" ")).not.toContain("tok")
    expect(opts.input).toContain('url = "https://thing.upstash.io"')
    expect(opts.input).toContain('header = "Authorization: Bearer tok\\"en"')
    const data = /data-raw = "(.*)"$/m.exec(opts.input)![1].replace(/\\(["\\])/g, "$1")
    const [verb, key, value] = JSON.parse(data)
    expect([verb, key]).toEqual(["RPUSH", "usage:pending"])
    expect(JSON.parse(value).rows[0].slice(1)).toEqual(["sync", "dbQueries", 4])
  })

  it("sends nothing without Redis, and never throws", () => {
    count("sync", "dbQueries")
    flushAtExitSync()
    expect(spawnSync).not.toHaveBeenCalled()
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://thing.upstash.io")
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t")
    spawnSync.mockImplementationOnce(() => { throw new Error("no curl") })
    count("sync", "dbQueries")
    expect(() => flushAtExitSync()).not.toThrow()
  })

  it("installs once", () => {
    const again = installScriptMeter()
    expect(globalThis.fetch).not.toBe(inner)
    again()
  })
})
