/*
 * Contract tests for the two tools added 2026-10-28. The loaders are mocked:
 * what is under test is the store scope reaching `assertOwnerOwnsStores`, the
 * account reaching the loader, and the shapes the model is handed — above
 * all that nothing is invented when Harri has no rows, and that a check that
 * is still open is never reported as missed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/chat/owner-scope", () => ({
  assertOwnerOwnsStores: vi.fn(),
  listOwnerStores: vi.fn(),
  renderStoreListForPrompt: vi.fn(),
}))
vi.mock("@/lib/counter/labor-figures", () => ({ loadLaborFigures: vi.fn() }))
vi.mock("@/lib/checks/data", () => ({ loadCheckGrid: vi.fn() }))

import { assertOwnerOwnsStores } from "@/lib/chat/owner-scope"
import { loadLaborFigures } from "@/lib/counter/labor-figures"
import { loadCheckGrid } from "@/lib/checks/data"
import { getLaborActuals } from "@/lib/chat/tools/labor"
import { getCleaningChecks } from "@/lib/chat/tools/checks"
import type { ChatToolContext } from "@/lib/chat/tools/types"

const ctx: ChatToolContext = { ownerId: "u1", accountId: "acct-A", prisma: {} as never }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertOwnerOwnsStores).mockImplementation(async (_a, ids) => ids ?? ["s1", "s2"])
})

describe("getLaborActuals", () => {
  const week = {
    days: [],
    actualHours: 101.26,
    scheduledHours: null,
    cost: 2034.567,
    blendedRate: 20.0921,
    splh: 61.234,
    laborPct: 22.849,
    overtimeCost: 45.5,
  }

  it("scopes the store and the account, and rounds what the model reads", async () => {
    vi.mocked(loadLaborFigures).mockResolvedValue({
      week,
      days: [{ key: "2026-10-20", label: "Mon Oct 20", actualHours: 14.04, scheduledHours: 16, cost: 280.111, splh: 60, laborPct: 21.66, totalSales: 1293 }],
      roles: [{ position: "Line cook", payType: "HOURLY", hours: 60.04, cost: 1200.555, share: 59.01 }],
      leaks: {
        rows: [{ code: "LATE_CLOCK_OUT", label: "Clocked out late", kind: "leak", alerts: 4, hours: 1.26, cost: 25.3, people: 2 }],
        leakedHours: 1.26,
        leakedCost: 25.3,
        uncostableAlerts: 1,
      },
    })

    const out = await getLaborActuals.execute({ storeId: "s1", dateRange: { from: "2026-10-20", to: "2026-10-26" } }, ctx)

    expect(assertOwnerOwnsStores).toHaveBeenCalledWith("acct-A", ["s1"])
    const call = vi.mocked(loadLaborFigures).mock.calls[0][0]
    expect(call.accountId).toBe("acct-A")
    expect(call.storeId).toBe("s1")
    // Calendar days, read on local getters by the Counter loaders.
    expect([call.range.start.getDate(), call.range.end.getDate()]).toEqual([20, 26])

    expect(out.hasLabor).toBe(true)
    expect(out.totals).toEqual({
      actualHours: 101.3,
      scheduledHours: null,
      laborCost: 2034.57,
      laborPct: 22.8,
      salesPerLaborHour: 61.23,
      overtimeCost: 45.5,
      avgHourlyRate: 20.09,
    })
    expect(out.roles[0]).toEqual({ position: "Line cook", payType: "HOURLY", hours: 60, cost: 1200.56, sharePct: 59 })
    expect(out.timekeeping?.extraCost).toBe(25.3)
  })

  it("passes null for every store and says when Harri has nothing", async () => {
    vi.mocked(loadLaborFigures).mockResolvedValue({
      week: { ...week, actualHours: 0, cost: 0, blendedRate: null, splh: null, laborPct: null, overtimeCost: 0 },
      days: [{ key: "2026-10-20", label: "Mon", actualHours: 0, scheduledHours: null, cost: 0, splh: null, laborPct: null, totalSales: 900 }],
      roles: [],
      leaks: null,
    })
    const out = await getLaborActuals.execute({ dateRange: { from: "2026-10-20", to: "2026-10-20" } }, ctx)
    expect(vi.mocked(loadLaborFigures).mock.calls[0][0].storeId).toBeNull()
    expect(assertOwnerOwnsStores).not.toHaveBeenCalled()
    expect(out.hasLabor).toBe(false)
    expect(out.timekeeping).toBeNull()
  })

  it("refuses a range past 92 days", async () => {
    await expect(
      getLaborActuals.execute({ dateRange: { from: "2026-07-01", to: "2026-10-01" } }, ctx),
    ).rejects.toThrow(/92 days/)
  })
})

describe("getCleaningChecks", () => {
  const sub = (crewName: string, lateMinutes: number, flags: Array<{ section: string; item: string; note: string }> = []) => ({
    id: "x", crewName, submittedAt: new Date(), startedAt: null, lateMinutes, flaggedCount: flags.length, flags, photos: [{ id: "p", sectionName: "Kitchen" }],
  })

  it("counts statuses, lists problems newest first, and never returns photos", async () => {
    vi.mocked(loadCheckGrid).mockResolvedValue([
      {
        id: "s1",
        name: "Van Nuys",
        templates: [],
        closedDays: [],
        cells: [
          { day: "2026-10-20", kind: "MORNING", status: "on_time", submission: sub("Maria G.", 0), startedBy: null },
          { day: "2026-10-20", kind: "EVENING", status: "missed", submission: null, startedBy: null },
          { day: "2026-10-21", kind: "EVENING", status: "late", submission: sub("Vardan", 25, [{ section: "Kitchen", item: "Clean the fryer", note: "Out of degreaser" }]), startedBy: null },
          { day: "2026-10-21", kind: "TRANSITION", status: "open", submission: null, startedBy: null },
        ],
      },
    ] as never)

    const out = await getCleaningChecks.execute({ storeIds: ["s1"], dateRange: { from: "2026-10-20", to: "2026-10-21" } }, ctx)

    expect(assertOwnerOwnsStores).toHaveBeenCalledWith("acct-A", ["s1"])
    expect(vi.mocked(loadCheckGrid).mock.calls[0][0]).toMatchObject({ accountId: "acct-A", storeIds: ["s1"], fromDay: "2026-10-20" })
    const store = out.stores[0]
    expect(store.counts).toEqual({ on_time: 1, late: 1, missed: 1, open: 1, closed: 0 })
    // One of three due checks on time; the open one is not due yet.
    expect(store.onTimePct).toBe(33)
    expect(store.problems.map((p) => [p.date, p.check, p.status])).toEqual([
      ["2026-10-21", "Evening", "late"],
      ["2026-10-20", "Evening", "missed"],
    ])
    expect(store.flagged).toEqual([
      { date: "2026-10-21", check: "Evening", section: "Kitchen", item: "Clean the fryer", note: "Out of degreaser", submittedBy: "Vardan" },
    ])
    expect(JSON.stringify(out)).not.toMatch(/photo|pin/i)
  })

  it("refuses a range past 31 days", async () => {
    await expect(
      getCleaningChecks.execute({ dateRange: { from: "2026-09-01", to: "2026-10-02" } }, ctx),
    ).rejects.toThrow(/31 days/)
  })

  it("refuses a range that starts after today rather than reporting zero checks", async () => {
    await expect(
      getCleaningChecks.execute({ dateRange: { from: "2099-01-01", to: "2099-01-02" } }, ctx),
    ).rejects.toThrow(/after today/)
    expect(loadCheckGrid).not.toHaveBeenCalled()
  })
})
