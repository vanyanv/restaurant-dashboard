// The browser error sink: it records what a phone or desk caught, accepts the
// signed-out crew page, and stays silent (204) in every case.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => null) }))
vi.mock("@/lib/monitoring/errors", () => ({ recordError: vi.fn(async () => {}) }))

import { getServerSession } from "next-auth"
import { rateLimit } from "@/lib/rate-limit"
import { recordError } from "@/lib/monitoring/errors"
import { POST } from "@/app/api/telemetry/client-error/route"

const session = vi.mocked(getServerSession)
const record = vi.mocked(recordError)

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://test.local/api/telemetry/client-error", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://test.local", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

const valid = { kind: "route", path: "/m/pnl?range=7d", message: "This page: boom", stack: "at x", digest: "123" }

beforeEach(() => {
  vi.clearAllMocks()
  session.mockResolvedValue(null as never)
})

describe("POST /api/telemetry/client-error", () => {
  it("records a signed-in error with the user, the path without its query, and the digest", async () => {
    session.mockResolvedValue({ user: { id: "u1" } } as never)
    const res = await POST(req(valid, { "sec-fetch-site": "same-origin" }))
    expect(res.status).toBe(204)
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "client",
        route: "/m/pnl",
        message: "This page: boom",
        userId: "u1",
        metadata: expect.objectContaining({ kind: "route", digest: "123" }),
      }),
    )
  })

  it("records a signed-out error, because crew use the checks page without an account", async () => {
    await POST(req({ ...valid, path: "/checks/abc", message: "crew page broke" }))
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ route: "/checks/abc", userId: null }))
  })

  it("records the same error once, however many phones send it", async () => {
    await POST(req({ ...valid, message: "same fault" }))
    await POST(req({ ...valid, message: "same fault" }))
    expect(record).toHaveBeenCalledTimes(1)
  })

  it("drops a post with neither Sec-Fetch-Site nor a matching Origin", async () => {
    await POST(req({ ...valid, message: "scripted" }, { origin: "" }))
    await POST(req({ ...valid, message: "scripted 2" }, { origin: "https://evil.example" }))
    expect(record).not.toHaveBeenCalled()
  })

  it("drops a body over the size cap before parsing it", async () => {
    await POST(req({ ...valid, message: "big", stack: "x".repeat(13_000) }))
    expect(record).not.toHaveBeenCalled()
  })

  it("drops a cross-site post", async () => {
    const res = await POST(req(valid, { "sec-fetch-site": "cross-site" }))
    expect(res.status).toBe(204)
    expect(record).not.toHaveBeenCalled()
  })

  it("drops malformed, oversized and non-path bodies", async () => {
    await POST(req("not json"))
    await POST(req({ ...valid, message: "x".repeat(2001) }))
    await POST(req({ ...valid, path: "https://evil.example/" }))
    await POST(req({ kind: "route" }))
    expect(record).not.toHaveBeenCalled()
  })

  it("stays silent when rate limited", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce(new Response(null, { status: 429 }) as never)
    const res = await POST(req(valid))
    expect(res.status).toBe(204)
    expect(record).not.toHaveBeenCalled()
  })
})
