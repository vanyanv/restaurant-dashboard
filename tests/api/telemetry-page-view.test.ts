// The sink must be silent in both directions: it never rejects a caller with an
// error status, and it never writes a row it should not have. Every no-op case
// therefore asserts `create` was NOT called — a 204 alone proves nothing here.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: { pageView: { create: vi.fn() } },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { POST } from "@/app/api/telemetry/page-view/route"
import { MAX_DWELL_MS } from "@/lib/monitoring/page-view"

const mockedSession = vi.mocked(getServerSession)
const create = vi.mocked(prisma.pageView.create)

const session = (role: "OWNER" | "DEVELOPER" = "OWNER") => ({
  user: { id: "u1", accountId: "acct-A", role },
})

function req(body: unknown): Request {
  return new Request("http://test.local/api/telemetry/page-view", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const validBody = {
  path: "/dashboard/pnl",
  enteredAt: Date.now() - 5000,
  dwellMs: 5000,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  delete process.env.TRACK_DEVELOPER_PAGE_VIEWS
  create.mockResolvedValue({} as never)
})

describe("POST /api/telemetry/page-view — no-op cases", () => {
  it("writes nothing when there is no session", async () => {
    mockedSession.mockResolvedValue(null as never)
    const res = await POST(req(validBody))
    expect(res.status).toBe(204)
    expect(create).not.toHaveBeenCalled()
  })

  it("writes nothing for a DEVELOPER session", async () => {
    mockedSession.mockResolvedValue(session("DEVELOPER") as never)
    const res = await POST(req(validBody))
    expect(res.status).toBe(204)
    expect(create).not.toHaveBeenCalled()
  })

  it("writes nothing for a path outside the app surfaces", async () => {
    mockedSession.mockResolvedValue(session() as never)
    const res = await POST(req({ ...validBody, path: "/login" }))
    expect(res.status).toBe(204)
    expect(create).not.toHaveBeenCalled()
  })

  it("writes nothing for a malformed body", async () => {
    mockedSession.mockResolvedValue(session() as never)
    const res = await POST(req({ path: 42 }))
    expect(res.status).toBe(204)
    expect(create).not.toHaveBeenCalled()
  })

  it("writes nothing for an unparseable body", async () => {
    mockedSession.mockResolvedValue(session() as never)
    const bad = new Request("http://test.local/api/telemetry/page-view", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    })
    const res = await POST(bad)
    expect(res.status).toBe(204)
    expect(create).not.toHaveBeenCalled()
  })

  it("still returns 204 when the database write throws", async () => {
    mockedSession.mockResolvedValue(session() as never)
    create.mockRejectedValue(new Error("connection lost"))
    const res = await POST(req(validBody))
    expect(res.status).toBe(204)
  })
})

describe("POST /api/telemetry/page-view — cross-site origin", () => {
  beforeEach(() => {
    mockedSession.mockResolvedValue(session() as never)
  })

  it("writes nothing when Sec-Fetch-Site says cross-site", async () => {
    const r = new Request("http://test.local/api/telemetry/page-view", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
      body: JSON.stringify(validBody),
    })
    const res = await POST(r)
    expect(res.status).toBe(204)
    expect(create).not.toHaveBeenCalled()
  })

  it("writes when Sec-Fetch-Site says same-origin", async () => {
    const r = new Request("http://test.local/api/telemetry/page-view", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify(validBody),
    })
    await POST(r)
    expect(create).toHaveBeenCalledTimes(1)
  })

  // Fail-open: a missing header must NOT block the write, or any client that
  // omits it loses every page view silently.
  it("writes when the header is absent entirely", async () => {
    await POST(req(validBody))
    expect(create).toHaveBeenCalledTimes(1)
  })
})

describe("POST /api/telemetry/page-view — accepted writes", () => {
  beforeEach(() => {
    mockedSession.mockResolvedValue(session() as never)
  })

  it("persists the row with a server-computed route", async () => {
    const enteredAt = Date.now() - 5000
    await POST(req({ path: "/dashboard/orders/clx8f2abcdefghijklmnopq", enteredAt, dwellMs: 5000 }))
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toMatchObject({
      data: {
        userId: "u1",
        path: "/dashboard/orders/clx8f2abcdefghijklmnopq",
        route: "/dashboard/orders/[id]",
        dwellMs: 5000,
      },
    })
    const written = create.mock.calls[0]![0].data as unknown as { enteredAt: Date }
    expect(written.enteredAt.getTime()).toBe(enteredAt)
  })

  it("clamps an implausibly long dwell", async () => {
    await POST(req({ ...validBody, dwellMs: 72 * 60 * 60 * 1000 }))
    expect(create.mock.calls[0]![0].data).toMatchObject({ dwellMs: MAX_DWELL_MS })
  })

  it("accepts a null dwell", async () => {
    await POST(req({ ...validBody, dwellMs: null }))
    expect(create.mock.calls[0]![0].data).toMatchObject({ dwellMs: null })
  })

  it("substitutes server time for a future client clock", async () => {
    const before = Date.now()
    await POST(req({ ...validBody, enteredAt: Date.now() + 10 * 60_000 }))
    const written = create.mock.calls[0]![0].data as unknown as { enteredAt: Date }
    expect(written.enteredAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(written.enteredAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it("truncates an over-long path", async () => {
    const long = "/dashboard/" + "a".repeat(500)
    await POST(req({ ...validBody, path: long }))
    const written = create.mock.calls[0]![0].data as unknown as { path: string }
    expect(written.path.length).toBeLessThanOrEqual(200)
  })

  it("writes for a DEVELOPER when the local escape hatch is set", async () => {
    process.env.TRACK_DEVELOPER_PAGE_VIEWS = "1"
    mockedSession.mockResolvedValue(session("DEVELOPER") as never)
    const res = await POST(req(validBody))
    expect(res.status).toBe(204)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it("ignores the escape hatch in production", async () => {
    // One stray Vercel env var must not start recording developer browsing
    // into the owner's engagement data.
    vi.stubEnv("NODE_ENV", "production")
    process.env.TRACK_DEVELOPER_PAGE_VIEWS = "1"
    mockedSession.mockResolvedValue(session("DEVELOPER") as never)
    const res = await POST(req(validBody))
    expect(res.status).toBe(204)
    expect(create).not.toHaveBeenCalled()
  })
})
