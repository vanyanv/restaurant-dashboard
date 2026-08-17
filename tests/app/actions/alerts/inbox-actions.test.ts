// getAlertInbox / acknowledgeAlert / dismissAlert — the read+act layer for the
// alert inbox. The Alert table had been ingested on a schedule with no UI at
// all; these pin the scoping rules that keep the inbox trustworthy: owner-only,
// account-scoped, bounded to the relevance horizon, open-by-default.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({
  authOptions: {},
  hasOwnerAccess: (role: string) => role === "OWNER" || role === "DEVELOPER",
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: vi.fn() },
    alert: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import {
  getAlertInbox,
  acknowledgeAlert,
  dismissAlert,
} from "@/app/actions/alerts/inbox-actions"
import { ANOMALY_RELEVANCE_DAYS } from "@/lib/anomaly-window"

const owner = { user: { id: "u1", accountId: "acct-A", role: "OWNER" } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.alert.groupBy).mockResolvedValue([] as never)
  vi.mocked(prisma.alert.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.store.findMany).mockResolvedValue([
    { id: "s1", name: "Hollywood" },
  ] as never)
})

describe("getAlertInbox", () => {
  it("refuses a non-owner", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u2", accountId: "acct-A", role: "VIEWER" },
    } as never)
    expect(await getAlertInbox()).toEqual({ ok: false, error: "unauthorized" })
  })

  it("returns an empty inbox when the account has no stores", async () => {
    vi.mocked(getServerSession).mockResolvedValue(owner as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([] as never)

    const res = await getAlertInbox()
    if (!res.ok) throw new Error("expected ok")
    expect(res.data.alerts).toEqual([])
    expect(res.data.counts.open).toBe(0)
    expect(prisma.alert.findMany).not.toHaveBeenCalled()
  })

  it("shows only open alerts inside the relevance horizon by default", async () => {
    vi.mocked(getServerSession).mockResolvedValue(owner as never)
    await getAlertInbox()

    const where = vi.mocked(prisma.alert.findMany).mock.calls[0]![0]!.where!
    expect(where.status).toBe("OPEN")
    const gte = (where.occurredOn as { gte: Date }).gte
    const ageDays = (Date.now() - gte.getTime()) / (24 * 60 * 60 * 1000)
    expect(ageDays).toBeGreaterThan(ANOMALY_RELEVANCE_DAYS - 1)
    expect(ageDays).toBeLessThan(ANOMALY_RELEVANCE_DAYS + 2)
  })

  it("drops the status filter when resolved history is requested", async () => {
    vi.mocked(getServerSession).mockResolvedValue(owner as never)
    await getAlertInbox({ includeResolved: true })

    const where = vi.mocked(prisma.alert.findMany).mock.calls[0]![0]!.where!
    expect(where.status).toBeUndefined()
  })

  it("ignores a storeId that isn't in the account", async () => {
    vi.mocked(getServerSession).mockResolvedValue(owner as never)
    await getAlertInbox({ storeId: "someone-elses-store" })

    const where = vi.mocked(prisma.alert.findMany).mock.calls[0]![0]!.where!
    expect(where.storeId).toEqual({ in: ["s1"] })
  })

  it("counts open alerts by severity", async () => {
    vi.mocked(getServerSession).mockResolvedValue(owner as never)
    vi.mocked(prisma.alert.groupBy).mockResolvedValue([
      { severity: "CRITICAL", _count: { _all: 2 } },
      { severity: "WATCH", _count: { _all: 5 } },
    ] as never)

    const res = await getAlertInbox()
    if (!res.ok) throw new Error("expected ok")
    expect(res.data.counts).toEqual({ critical: 2, watch: 5, info: 0, open: 7 })
  })
})

describe("acknowledgeAlert / dismissAlert", () => {
  it("rejects an alert belonging to another account", async () => {
    vi.mocked(getServerSession).mockResolvedValue(owner as never)
    vi.mocked(prisma.alert.findUnique).mockResolvedValue({
      id: "a1",
      store: { accountId: "acct-OTHER" },
    } as never)

    expect(await acknowledgeAlert({ alertId: "a1" })).toEqual({
      ok: false,
      error: "not_in_account",
    })
    expect(prisma.alert.update).not.toHaveBeenCalled()
  })

  it("records ACKNOWLEDGED without an explanation, EXPLAINED with one", async () => {
    vi.mocked(getServerSession).mockResolvedValue(owner as never)
    vi.mocked(prisma.alert.findUnique).mockResolvedValue({
      id: "a1",
      store: { accountId: "acct-A" },
    } as never)
    vi.mocked(prisma.alert.update).mockResolvedValue({} as never)

    await acknowledgeAlert({ alertId: "a1" })
    expect(prisma.alert.update).toHaveBeenLastCalledWith({
      where: { id: "a1" },
      data: {
        status: "ACKNOWLEDGED",
        explanation: null,
        acknowledgedAt: expect.any(Date),
      },
    })

    await acknowledgeAlert({ alertId: "a1", explanation: "  supplier return  " })
    expect(prisma.alert.update).toHaveBeenLastCalledWith({
      where: { id: "a1" },
      data: {
        status: "EXPLAINED",
        explanation: "supplier return",
        acknowledgedAt: expect.any(Date),
      },
    })
  })

  it("treats a whitespace-only explanation as no explanation", async () => {
    vi.mocked(getServerSession).mockResolvedValue(owner as never)
    vi.mocked(prisma.alert.findUnique).mockResolvedValue({
      id: "a1",
      store: { accountId: "acct-A" },
    } as never)
    vi.mocked(prisma.alert.update).mockResolvedValue({} as never)

    await acknowledgeAlert({ alertId: "a1", explanation: "   " })
    expect(prisma.alert.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ACKNOWLEDGED", explanation: null }),
      }),
    )
  })

  it("dismisses without recording an explanation", async () => {
    vi.mocked(getServerSession).mockResolvedValue(owner as never)
    vi.mocked(prisma.alert.findUnique).mockResolvedValue({
      id: "a1",
      store: { accountId: "acct-A" },
    } as never)
    vi.mocked(prisma.alert.update).mockResolvedValue({} as never)

    await dismissAlert({ alertId: "a1" })
    expect(prisma.alert.update).toHaveBeenLastCalledWith({
      where: { id: "a1" },
      data: { status: "DISMISSED", acknowledgedAt: expect.any(Date) },
    })
  })
})
