// The Vercel reader lists names, types and targets. Never a value, and it never throws.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { listVercelEnv } from "@/lib/developer/vercel-env"

const ENV = { VERCEL_TOKEN: "fake-token", VERCEL_PROJECT_ID: "prj_fake" }
const LEAK = "s3cr3t-value-that-must-not-leak"

const fetchMock = vi.fn()

function answer(body: unknown, status = 200) {
  fetchMock.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe("listVercelEnv", () => {
  it("returns names, types and targets", async () => {
    answer({
      envs: [
        { key: "B_PLAIN", type: "plain", target: ["production", "preview", "development"], value: LEAK },
        { key: "A_SENSITIVE", type: "sensitive", target: ["production"], value: LEAK },
        { key: "C_ENCRYPTED", type: "encrypted", target: "preview", value: LEAK },
        { key: "D_OLD_SECRET", type: "secret", target: ["development"], value: LEAK },
      ],
      pagination: { count: 4, next: null, prev: null },
    })
    const r = await listVercelEnv(ENV)
    expect(r).toEqual({
      ok: true,
      rows: [
        { name: "A_SENSITIVE", type: "sensitive", targets: ["production"] },
        { name: "B_PLAIN", type: "plain", targets: ["production", "preview", "development"] },
        { name: "C_ENCRYPTED", type: "encrypted", targets: ["preview"] },
        { name: "D_OLD_SECRET", type: "sensitive", targets: ["development"] },
      ],
    })
  })

  it("reads the older write-only kind, and Vercel's own secret mark, as sensitive", async () => {
    answer({
      envs: [
        // `visibility` is authoritative when present, whatever `type` says.
        { key: "A_MARKED", type: "encrypted", visibility: "secret", target: ["production"] },
        { key: "B_MARKED_PLAIN", type: "plain", visibility: "secret", target: ["production"] },
        // `config`, or no mark at all, falls back to the type.
        { key: "C_CONFIG", type: "encrypted", visibility: "config", target: ["production"] },
        { key: "D_CONFIG_PLAIN", type: "plain", visibility: "config", target: ["production"] },
        { key: "E_LEGACY", type: "secret", target: ["production"] },
      ],
    })
    const r = await listVercelEnv(ENV)
    expect(r.ok && r.rows.map((x) => [x.name, x.type])).toEqual([
      ["A_MARKED", "sensitive"],
      ["B_MARKED_PLAIN", "sensitive"],
      ["C_CONFIG", "encrypted"],
      ["D_CONFIG_PLAIN", "plain"],
      ["E_LEGACY", "sensitive"],
    ])
  })

  it("lets no value through, whatever field Vercel puts it in", async () => {
    answer({
      envs: [
        { key: "A", type: "plain", target: ["production"], value: LEAK, comment: LEAK, decrypted: true, id: LEAK, contentHint: { type: LEAK } },
      ],
    })
    const r = await listVercelEnv(ENV)
    expect(JSON.stringify(r)).not.toContain(LEAK)
    expect(r.ok && Object.keys(r.rows[0]).sort()).toEqual(["name", "targets", "type"])
  })

  it("asks the right endpoint, with no decrypt, no cache and a time limit", async () => {
    answer({ envs: [] })
    await listVercelEnv({ ...ENV, VERCEL_TEAM_ID: "team_fake" })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.vercel.com/v10/projects/prj_fake/env?teamId=team_fake")
    expect(url).not.toMatch(/decrypt/)
    expect(init.cache).toBe("no-store")
    expect(init.headers.Authorization).toBe("Bearer fake-token")
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it("leaves the team out when there is none", async () => {
    answer({ envs: [] })
    await listVercelEnv(ENV)
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.vercel.com/v10/projects/prj_fake/env")
  })

  it("folds one name held for several targets into one row", async () => {
    answer({
      envs: [
        { key: "A", type: "encrypted", target: ["development"] },
        { key: "A", type: "sensitive", target: ["production", "preview"] },
      ],
    })
    expect(await listVercelEnv(ENV)).toEqual({
      ok: true,
      rows: [{ name: "A", type: "sensitive", targets: ["production", "preview", "development"] }],
    })
  })

  it("says not set up, and asks nothing, without a token or a project", async () => {
    expect(await listVercelEnv({ VERCEL_PROJECT_ID: "prj_fake" })).toEqual({ ok: false, reason: "not set up" })
    expect(await listVercelEnv({ VERCEL_TOKEN: "fake-token" })).toEqual({ ok: false, reason: "not set up" })
    expect(await listVercelEnv({ VERCEL_TOKEN: "  ", VERCEL_PROJECT_ID: "prj_fake" })).toEqual({ ok: false, reason: "not set up" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("says it couldn't reach Vercel on a refusal", async () => {
    for (const status of [401, 403, 404, 500]) {
      answer({ error: { message: LEAK } }, status)
      expect(await listVercelEnv(ENV)).toEqual({ ok: false, reason: "couldn't reach Vercel" })
    }
  })

  it("says it couldn't reach Vercel when the answer runs out of time", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"))
    expect(await listVercelEnv(ENV)).toEqual({ ok: false, reason: "couldn't reach Vercel" })
  })

  it("gives up after three seconds on an answer that never comes", async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(init.signal.reason))
          }),
      )
      const pending = listVercelEnv(ENV)
      await vi.advanceTimersByTimeAsync(3_100)
      expect(await pending).toEqual({ ok: false, reason: "couldn't reach Vercel" })
    } finally {
      vi.useRealTimers()
    }
  })

  it("says it couldn't reach Vercel on a network failure or a shape it does not know", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"))
    expect(await listVercelEnv(ENV)).toEqual({ ok: false, reason: "couldn't reach Vercel" })
    answer({ key: "A", type: "plain", value: LEAK })
    expect(await listVercelEnv(ENV)).toEqual({ ok: false, reason: "couldn't reach Vercel" })
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json") } })
    expect(await listVercelEnv(ENV)).toEqual({ ok: false, reason: "couldn't reach Vercel" })
  })
})
