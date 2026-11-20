// The checks cron: alerts are read once and written in bulk, and the heavy
// grid load is skipped only when no check window can have changed anything
// since the last successful run.

import { describe, it, expect, vi, beforeEach } from "vitest"

const db = vi.hoisted(() => ({
  account: { findMany: vi.fn() },
  store: { findMany: vi.fn() },
  jobRun: { findFirst: vi.fn() },
  alert: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn((args: unknown) => ({ op: "update", args })),
  },
  $transaction: vi.fn(async (ops: unknown[]) => ops),
}))
vi.mock("@/lib/prisma", () => ({ prisma: db }))

const loadCheckGrid = vi.hoisted(() => vi.fn())
vi.mock("@/lib/checks/data", () => ({ loadCheckGrid }))

import { checkAlertAccountsDue, recordCheckAlerts, windowMovedSince } from "@/lib/checks/missed-alerts"
import type { CheckWindow } from "@/lib/checks/time"

// Morning: submit by 5:30 pm, 30 min grace. Night: due 2:00 am, 30 min grace.
const MORNING: CheckWindow & { dueByWeekday: number[] } = { opensAtMin: 9 * 60, submitFromMin: null, dueAtMin: 17 * 60 + 30, dueByWeekday: [], graceMin: 30 }
const NIGHT: CheckWindow & { dueByWeekday: number[] } = { opensAtMin: 17 * 60 + 30, submitFromMin: 24 * 60 + 30, dueAtMin: 26 * 60, dueByWeekday: [], graceMin: 30 }

const tpl = (w: typeof MORNING, extra: Partial<{ enabled: boolean; updatedAt: Date }> = {}) => ({
  ...w,
  enabled: true,
  updatedAt: new Date("2026-11-01T00:00:00Z"),
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  db.alert.findMany.mockResolvedValue([])
  db.alert.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }))
})

describe("windowMovedSince", () => {
  // 2026-11-20 is PST: Morning due 01:30Z on the 21st, closes 02:00Z.
  const day = "2026-11-20"
  it("is quiet mid-window, before the due time", () => {
    expect(windowMovedSince(day, MORNING, new Date("2026-11-20T23:30Z"), new Date("2026-11-21T00:00Z"))).toBe(false)
  })
  it("fires while the window is in its grace period", () => {
    expect(windowMovedSince(day, MORNING, new Date("2026-11-21T01:00Z"), new Date("2026-11-21T01:45Z"))).toBe(true)
  })
  it("fires for a window that closed since the last run", () => {
    expect(windowMovedSince(day, MORNING, new Date("2026-11-21T01:55Z"), new Date("2026-11-21T02:20Z"))).toBe(true)
  })
  it("is quiet once the close is behind the last run", () => {
    expect(windowMovedSince(day, MORNING, new Date("2026-11-21T02:05Z"), new Date("2026-11-21T02:40Z"))).toBe(false)
  })
  it("places a night window past midnight on the day it opened", () => {
    // Night of the 20th is due 2:00 am on the 21st = 10:00Z, closes 10:30Z.
    expect(windowMovedSince(day, NIGHT, new Date("2026-11-21T10:10Z"), new Date("2026-11-21T10:40Z"))).toBe(true)
    expect(windowMovedSince(day, NIGHT, new Date("2026-11-21T10:31Z"), new Date("2026-11-21T11:00Z"))).toBe(false)
  })
})

describe("checkAlertAccountsDue", () => {
  /** A store row with nothing changed on it lately. */
  const QUIET = { updatedAt: new Date("2026-01-01T00:00Z"), checkClosures: [], checkPauses: [] }
  const lastRun = (iso: string) => db.jobRun.findFirst.mockResolvedValue({ startedAt: new Date(iso) })

  it("runs everything when there is no successful run on record", async () => {
    db.jobRun.findFirst.mockResolvedValue(null)
    expect(await checkAlertAccountsDue(new Date("2026-11-20T20:00Z"))).toBeNull()
    expect(db.store.findMany).not.toHaveBeenCalled()
  })

  it("skips when no window went past due or closed since the last run", async () => {
    lastRun("2026-11-20T19:30Z") // 11:30 am LA; it is now noon
    db.store.findMany.mockResolvedValue([{ ...QUIET, accountId: "a1", checkTemplates: [tpl(MORNING), tpl(NIGHT)] }])
    expect(await checkAlertAccountsDue(new Date("2026-11-20T20:00Z"))).toEqual([])
  })

  it("runs the account whose window closed since the last run, and only that one", async () => {
    lastRun("2026-11-21T01:50Z")
    db.store.findMany.mockResolvedValue([
      { ...QUIET, accountId: "a1", checkTemplates: [tpl(MORNING)] },
      { ...QUIET, accountId: "a2", checkTemplates: [tpl(NIGHT)] },
    ])
    expect(await checkAlertAccountsDue(new Date("2026-11-21T02:20Z"))).toEqual(["a1"])
  })

  it("does not run for a switched-off check", async () => {
    lastRun("2026-11-21T01:50Z")
    db.store.findMany.mockResolvedValue([{ ...QUIET, accountId: "a1", checkTemplates: [tpl(MORNING, { enabled: false })] }])
    expect(await checkAlertAccountsDue(new Date("2026-11-21T02:20Z"))).toEqual([])
  })

  it("runs for a store with no checks set up yet (the grid load sets them up)", async () => {
    lastRun("2026-11-20T19:30Z")
    db.store.findMany.mockResolvedValue([{ ...QUIET, accountId: "a1", checkTemplates: [] }])
    expect(await checkAlertAccountsDue(new Date("2026-11-20T20:00Z"))).toEqual(["a1"])
  })

  it("runs for a checklist window edited since the last run", async () => {
    lastRun("2026-11-20T19:30Z")
    db.store.findMany.mockResolvedValue([
      { ...QUIET, accountId: "a1", checkTemplates: [tpl(MORNING, { updatedAt: new Date("2026-11-20T19:45Z") })] },
    ])
    expect(await checkAlertAccountsDue(new Date("2026-11-20T20:00Z"))).toEqual(["a1"])
  })

  it("runs for a store whose stage changed, a day marked closed, or checks paused or resumed", async () => {
    lastRun("2026-11-20T19:30Z")
    db.store.findMany.mockResolvedValue([
      { ...QUIET, accountId: "a1", updatedAt: new Date("2026-11-20T19:45Z"), checkTemplates: [tpl(MORNING)] },
      { ...QUIET, accountId: "a2", checkClosures: [{ id: "c" }], checkTemplates: [tpl(MORNING)] },
      { ...QUIET, accountId: "a3", checkPauses: [{ id: "p" }], checkTemplates: [tpl(MORNING)] },
      { ...QUIET, accountId: "a4", checkTemplates: [tpl(MORNING)] },
    ])
    expect(await checkAlertAccountsDue(new Date("2026-11-20T20:00Z"))).toEqual(["a1", "a2", "a3"])
  })

  it("runs everything when the last real run is over 2 hours old (an un-marked closed day leaves no trace)", async () => {
    lastRun("2026-11-20T17:30Z")
    expect(await checkAlertAccountsDue(new Date("2026-11-20T20:00Z"))).toBeNull()
    expect(db.store.findMany).not.toHaveBeenCalled()
  })

  it("measures from the last SUCCESS run of checks.alerts", async () => {
    lastRun("2026-11-20T19:30Z")
    db.store.findMany.mockResolvedValue([])
    await checkAlertAccountsDue(new Date("2026-11-20T20:00Z"))
    expect(db.jobRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jobName: "checks.alerts", status: "SUCCESS" } }),
    )
  })
})

describe("recordCheckAlerts — one read, bulk writes", () => {
  const cell = (day: string, kind: "MORNING" | "EVENING", status: string) => ({ day, kind, status, submission: null })
  const store = (id: string, cells: unknown[]) => ({
    id,
    name: `Store ${id}`,
    templates: [
      { kind: "MORNING", ...MORNING },
      { kind: "EVENING", ...NIGHT },
    ],
    cells,
  })

  it("reads existing alerts with one findMany and creates the new ones with one createMany", async () => {
    loadCheckGrid.mockResolvedValue([
      store("s1", [cell("2026-11-19", "MORNING", "missed"), cell("2026-11-20", "EVENING", "missed")]),
      store("s2", [cell("2026-11-20", "MORNING", "missed"), cell("2026-11-20", "EVENING", "on_time")]),
    ])
    const out = await recordCheckAlerts({ accountIds: ["a1"], now: new Date("2026-11-21T12:00Z") })

    expect(db.account.findMany).not.toHaveBeenCalled()
    expect(loadCheckGrid).toHaveBeenCalledTimes(1)
    expect(db.alert.findUnique).not.toHaveBeenCalled()
    expect(db.alert.findMany).toHaveBeenCalledTimes(1)
    expect(db.alert.findMany.mock.calls[0][0].where.dedupeKey.in.sort()).toEqual([
      "STORE_CHECK:s1:2026-11-19",
      "STORE_CHECK:s1:2026-11-20",
      "STORE_CHECK:s2:2026-11-20",
    ])
    expect(db.alert.createMany).toHaveBeenCalledTimes(1)
    const { data, skipDuplicates } = db.alert.createMany.mock.calls[0][0]
    expect(skipDuplicates).toBe(true)
    expect(data).toHaveLength(3)
    expect(data[0]).toMatchObject({ source: "STORE_CHECK", target: "STORE_CHECK", storeId: "s1" })
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(out).toEqual({ created: 3 })
  })

  it("rewrites an open alert, reopens a dealt-with one only for new news, in one transaction", async () => {
    loadCheckGrid.mockResolvedValue([
      store("s1", [
        cell("2026-11-19", "MORNING", "missed"),
        cell("2026-11-20", "MORNING", "missed"),
        cell("2026-11-20", "EVENING", "missed"),
      ]),
      store("s2", [cell("2026-11-20", "MORNING", "missed")]),
    ])
    db.alert.findMany.mockResolvedValue([
      // Open, and the title changed (a second check went wrong): rewritten.
      { id: "x1", dedupeKey: "STORE_CHECK:s1:2026-11-20", status: "OPEN", title: "old", metadata: { checks: [{}] } },
      // Acknowledged, same news: left alone.
      { id: "x2", dedupeKey: "STORE_CHECK:s1:2026-11-19", status: "ACKNOWLEDGED", title: "t", metadata: { checks: [{}] } },
      // Dismissed with nothing on it, now one check: reopened.
      { id: "x3", dedupeKey: "STORE_CHECK:s2:2026-11-20", status: "DISMISSED", title: "t", metadata: { checks: [] } },
    ])
    const out = await recordCheckAlerts({ accountId: "a1", now: new Date("2026-11-21T12:00Z") })

    expect(db.alert.createMany).not.toHaveBeenCalled()
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    const ops = db.$transaction.mock.calls[0][0] as Array<{ args: { where: { id: string }; data: { status?: string } } }>
    expect(ops.map((o) => o.args.where.id).sort()).toEqual(["x1", "x3"])
    expect(ops.find((o) => o.args.where.id === "x3")!.args.data.status).toBe("OPEN")
    expect(out).toEqual({ created: 0 })
  })

  it("counts only the rows createMany actually inserted (a concurrent run may win)", async () => {
    loadCheckGrid.mockResolvedValue([store("s1", [cell("2026-11-20", "MORNING", "missed")])])
    db.alert.createMany.mockResolvedValue({ count: 0 })
    expect(await recordCheckAlerts({ accountId: "a1", now: new Date("2026-11-21T12:00Z") })).toEqual({ created: 0 })
  })

  it("writes nothing when nothing went wrong", async () => {
    loadCheckGrid.mockResolvedValue([store("s1", [cell("2026-11-20", "MORNING", "on_time")])])
    await recordCheckAlerts({ accountId: "a1", now: new Date("2026-11-21T12:00Z") })
    expect(db.alert.findMany).not.toHaveBeenCalled()
    expect(db.alert.createMany).not.toHaveBeenCalled()
  })
})
