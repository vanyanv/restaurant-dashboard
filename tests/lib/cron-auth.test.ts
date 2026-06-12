// withCronAuth characterizes the auth preamble shared by all 13
// /api/cron/** routes. Three flavors exist in production and each must be
// representable without behavior drift:
//   A. cron-bearer only -> 401 {error:"Unauthorized"} (default)
//   B. cron-bearer only -> 403 {error:"forbidden"} (monitoring routes)
//   C. cron-bearer OR owner session, custom 403 message, rate-limited
// The CRON_SECRET comparison itself lives in lib/rate-limit (isCronRequest,
// timing-safe) and is exercised here for real via the env var.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

process.env.CRON_SECRET = "test-secret"

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authOptions: {},
  hasOwnerAccess: (role: string | null | undefined) =>
    role === "OWNER" || role === "DEVELOPER",
}))

vi.mock("@/lib/cache/redis", () => ({
  getRedis: () => null,
}))

import { getServerSession } from "next-auth"
import { withCronAuth, parseJsonBody } from "@/lib/cron-auth"

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>

const cronReq = () =>
  new NextRequest("http://localhost/api/cron/x", {
    method: "POST",
    headers: { authorization: "Bearer test-secret" },
  })

const anonReq = () =>
  new NextRequest("http://localhost/api/cron/x", { method: "POST" })

beforeEach(() => {
  mockedSession.mockReset()
  mockedSession.mockResolvedValue(null)
})

describe("withCronAuth", () => {
  it("calls the handler with fromCron=true on a valid cron bearer", async () => {
    const handler = vi.fn(
      async (_req: NextRequest, _ctx: { fromCron: boolean }) =>
        Response.json({ ok: true })
    )
    const route = withCronAuth(handler)

    const res = await route(cronReq())

    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0][1]).toEqual({ fromCron: true })
  })

  it("rejects an unauthenticated request with 401 Unauthorized by default", async () => {
    const handler = vi.fn(
      async (_req: NextRequest, _ctx: { fromCron: boolean }) =>
        Response.json({ ok: true })
    )
    const route = withCronAuth(handler)

    const res = await route(anonReq())

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "Unauthorized" })
    expect(handler).not.toHaveBeenCalled()
  })

  it("supports the monitoring routes' 403 forbidden shape", async () => {
    const handler = vi.fn(async () => Response.json({ ok: true }))
    const route = withCronAuth(handler, {
      unauthorized: { status: 403, error: "forbidden" },
    })

    const res = await route(anonReq())

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "forbidden" })
  })

  it("ownerFallback: 401 when there is no session", async () => {
    const route = withCronAuth(async () => Response.json({ ok: true }), {
      ownerFallback: { forbiddenMessage: "Only owners can run the Harri sync" },
    })

    const res = await route(anonReq())

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "Unauthorized" })
  })

  it("ownerFallback: 403 with the route's message for a non-owner session", async () => {
    mockedSession.mockResolvedValue({ user: { id: "u1", role: "MANAGER" } })
    const route = withCronAuth(async () => Response.json({ ok: true }), {
      ownerFallback: { forbiddenMessage: "Only owners can run the Harri sync" },
    })

    const res = await route(anonReq())

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: "Only owners can run the Harri sync",
    })
  })

  it("ownerFallback: owner session passes through with fromCron=false", async () => {
    mockedSession.mockResolvedValue({ user: { id: "u1", role: "OWNER" } })
    const handler = vi.fn(
      async (_req: NextRequest, _ctx: { fromCron: boolean }) =>
        Response.json({ ok: true })
    )
    const route = withCronAuth(handler, {
      ownerFallback: { forbiddenMessage: "Only owners can run the Harri sync" },
    })

    const res = await route(anonReq())

    expect(res.status).toBe(200)
    expect(handler.mock.calls[0][1]).toEqual({ fromCron: false })
  })
})

describe("parseJsonBody", () => {
  it("returns the parsed object for valid JSON", async () => {
    const req = new NextRequest("http://localhost/api/cron/x", {
      method: "POST",
      body: JSON.stringify({ storeId: "s1" }),
      headers: { "content-type": "application/json" },
    })
    const out = await parseJsonBody<{ storeId?: string }>(req)
    expect(out).toEqual({ storeId: "s1" })
  })

  it("returns a 400 'Body must be JSON' response for an unparseable body", async () => {
    const req = new NextRequest("http://localhost/api/cron/x", {
      method: "POST",
      body: "not json",
    })
    const out = await parseJsonBody(req)
    expect(out).toBeInstanceOf(Response)
    const res = out as Response
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Body must be JSON" })
  })
})
