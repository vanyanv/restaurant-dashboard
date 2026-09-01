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
    // The account's hard mutes. Zero rows on the live database; the inbox asks
    // for the RULES rather than a count so the "Muted" segment can report a
    // measurement instead of a hard-coded empty list.
    alertPreference: { findMany: vi.fn() },
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
    { id: "s1", name: "Hollywood", isActive: true },
  ] as never)
  vi.mocked(prisma.alertPreference.findMany).mockResolvedValue([] as never)
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
    // The tally is now a severity x status x source cross-tab rather than a
    // severity-only groupBy over OPEN rows, so that one result can answer the
    // three severities, the two closed statuses and the five source tallies.
    // The OPEN scope moved out of the `where` and into this projection.
    vi.mocked(prisma.alert.groupBy).mockResolvedValue([
      { severity: "CRITICAL", status: "OPEN", source: "ANOMALY_EVENT", _count: { _all: 2 } },
      { severity: "WATCH", status: "OPEN", source: "ANOMALY_EVENT", _count: { _all: 5 } },
      { severity: "WATCH", status: "DISMISSED", source: "ANOMALY_EVENT", _count: { _all: 3 } },
    ] as never)

    const res = await getAlertInbox()
    if (!res.ok) throw new Error("expected ok")
    expect(res.data.counts).toEqual({
      critical: 2,
      watch: 5,
      info: 0,
      open: 7,
      acknowledged: 0,
      // A dismissal is NOT an acknowledgement, and this is the query-level
      // half of that ruling: the two statuses are counted separately and
      // neither is read off `acknowledgedAt`, which both of them set.
      dismissed: 3,
    })
  })

  it("tallies every source, including the four that have never fired", async () => {
    vi.mocked(getServerSession).mockResolvedValue(owner as never)
    vi.mocked(prisma.alert.groupBy).mockResolvedValue([
      { severity: "CRITICAL", status: "OPEN", source: "ANOMALY_EVENT", _count: { _all: 40 } },
      { severity: "WATCH", status: "DISMISSED", source: "ANOMALY_EVENT", _count: { _all: 10 } },
    ] as never)

    const res = await getAlertInbox()
    if (!res.ok) throw new Error("expected ok")
    // All five keys present, all statuses summed — this is what the five
    // source toggles read, and a missing key would render as a missing toggle.
    expect(res.data.bySource).toEqual({
      ANOMALY_EVENT: 50,
      PRICE_DELTA: 0,
      HARRI_VARIANCE: 0,
      QUANTITY_SPIKE: 0,
      NEW_PRODUCT: 0,
    })
  })

  it("carries acknowledgedAt onto the row", async () => {
    vi.mocked(getServerSession).mockResolvedValue(owner as never)
    const closedAt = new Date("2026-08-26T05:48:00Z")
    vi.mocked(prisma.alert.findMany).mockResolvedValue([
      { id: "a1", storeId: "s1", status: "DISMISSED", acknowledgedAt: closedAt },
    ] as never)

    const res = await getAlertInbox({ includeResolved: true })
    if (!res.ok) throw new Error("expected ok")
    // Without it there is no time-to-close median to compute at all.
    expect(res.data.alerts[0].acknowledgedAt).toBe(closedAt)
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
