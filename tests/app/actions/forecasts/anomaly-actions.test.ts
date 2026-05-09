// getOpenAnomalies + acknowledgeAnomaly — read + mutation actions for
// the anomaly feed surfaced on /dashboard/forecasts.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findUnique: vi.fn() },
    anomalyEvent: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import {
  getOpenAnomalies,
  acknowledgeAnomaly,
} from "@/app/actions/forecasts/anomaly-actions"

const sessionWith = (overrides: Record<string, unknown> = {}) => ({
  user: { id: "u1", accountId: "acct-A", ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getOpenAnomalies", () => {
  it("returns null without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await getOpenAnomalies({ storeId: "s1" })).toBeNull()
  })

  it("rejects a cross-account store", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-OTHER",
    } as never)
    expect(await getOpenAnomalies({ storeId: "s1" })).toEqual({
      ok: false,
      error: "store_not_in_account",
    })
  })

  it("returns OPEN events sorted most-recent first", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      name: "S1",
      accountId: "acct-A",
    } as never)
    vi.mocked(prisma.anomalyEvent.findMany).mockResolvedValue([
      {
        id: "a1",
        target: "REVENUE",
        targetId: null,
        occurredOn: new Date("2026-05-08"),
        residual: -1500,
        zScore: -3.4,
        method: "ZSCORE",
        status: "OPEN",
        detectedAt: new Date("2026-05-09T06:00:00Z"),
      },
    ] as never)

    const result = await getOpenAnomalies({ storeId: "s1" })
    if (!result || !result.ok) throw new Error("expected ok")
    expect(result.data.events).toHaveLength(1)
    expect(result.data.events[0].zScore).toBe(-3.4)
    expect(prisma.anomalyEvent.findMany).toHaveBeenCalledWith({
      where: { storeId: "s1", status: "OPEN" },
      orderBy: [{ occurredOn: "desc" }, { detectedAt: "desc" }],
      take: 20,
      select: expect.any(Object),
    })
  })
})

describe("acknowledgeAnomaly", () => {
  it("returns null without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await acknowledgeAnomaly({ anomalyId: "a1" })).toBeNull()
  })

  it("returns not_found when the event is missing", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.anomalyEvent.findUnique).mockResolvedValue(null as never)
    expect(await acknowledgeAnomaly({ anomalyId: "a1" })).toEqual({
      ok: false,
      error: "not_found",
    })
  })

  it("rejects a cross-account anomaly", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.anomalyEvent.findUnique).mockResolvedValue({
      id: "a1",
      store: { accountId: "acct-OTHER" },
    } as never)
    expect(await acknowledgeAnomaly({ anomalyId: "a1" })).toEqual({
      ok: false,
      error: "not_in_account",
    })
  })

  it("marks ACKNOWLEDGED without explanation, EXPLAINED with one", async () => {
    vi.mocked(getServerSession).mockResolvedValue(sessionWith() as never)
    vi.mocked(prisma.anomalyEvent.findUnique).mockResolvedValue({
      id: "a1",
      store: { accountId: "acct-A" },
    } as never)
    vi.mocked(prisma.anomalyEvent.update).mockResolvedValue({} as never)

    await acknowledgeAnomaly({ anomalyId: "a1" })
    expect(prisma.anomalyEvent.update).toHaveBeenLastCalledWith({
      where: { id: "a1" },
      data: {
        status: "ACKNOWLEDGED",
        explanation: null,
        acknowledgedAt: expect.any(Date),
      },
    })

    await acknowledgeAnomaly({ anomalyId: "a1", explanation: "supplier return" })
    expect(prisma.anomalyEvent.update).toHaveBeenLastCalledWith({
      where: { id: "a1" },
      data: {
        status: "EXPLAINED",
        explanation: "supplier return",
        acknowledgedAt: expect.any(Date),
      },
    })
  })
})
