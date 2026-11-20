// /api/monitoring/summary (2026-11-20): today's AI cost is the caller's
// account's, and a named store must belong to the caller.
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/monitoring/db-stats", () => ({ getDbSize: vi.fn(async () => ({})), getConnections: vi.fn(async () => ({})) }))
vi.mock("@/lib/monitoring/redis-stats", () => ({ getRedisLive: vi.fn(async () => ({})) }))
vi.mock("@/lib/monitoring/queries", () => ({ getSyncs: vi.fn(async () => []), getErrorCount24h: vi.fn(async () => 0) }))
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: vi.fn(), store: { findFirst: vi.fn() } } }))

import { NextRequest } from "next/server"
import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getSyncs } from "@/lib/monitoring/queries"
import { GET } from "@/app/api/monitoring/summary/route"

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>
const get = (q = "") => GET(new NextRequest(`https://x.test/api/monitoring/summary${q}`))

beforeEach(() => {
  vi.clearAllMocks()
  m(getServerSession).mockResolvedValue({ user: { id: "u1", role: "DEVELOPER", accountId: "acc1" } })
  m(prisma.$queryRaw).mockResolvedValue([{ s: 1.5 }])
})

describe("GET /api/monitoring/summary", () => {
  it("is not found for anyone but a developer", async () => {
    m(getServerSession).mockResolvedValue({ user: { id: "u1", role: "OWNER", accountId: "acc1" } })
    expect((await get()).status).toBe(404)
  })

  it("sums AI cost for the caller's account only", async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect((await res.json()).todayCostUsd).toBe(1.5)
    const [strings, ...values] = m(prisma.$queryRaw).mock.calls[0]
    expect((strings as string[]).join("?")).toMatch(/"accountId" = \?/)
    expect(values).toContain("acc1")
  })

  it("refuses another account's store without reading its syncs", async () => {
    m(prisma.store.findFirst).mockResolvedValue(null)
    expect((await get("?store=s-other")).status).toBe(404)
    expect(m(prisma.store.findFirst).mock.calls[0][0].where).toEqual({ id: "s-other", accountId: "acc1" })
    expect(getSyncs).not.toHaveBeenCalled()
  })

  it("reads an owned store's syncs", async () => {
    m(prisma.store.findFirst).mockResolvedValue({ id: "s1" })
    expect((await get("?store=s1")).status).toBe(200)
    expect(getSyncs).toHaveBeenCalledWith("s1")
  })
})
