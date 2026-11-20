// The COGS sweep's skip gate. It compares the newest source change against
// the START of the last sweep that actually materialized the window — not its
// completion (a source row written mid-sweep would be skipped forever), and
// never a skipped run (a skip is recorded as SUCCESS too, and would otherwise
// become the new baseline).

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: vi.fn() } }))

import { prisma } from "@/lib/prisma"
import { getLastSuccessfulCogsSweepAt, shouldSkipCogsSweep } from "@/lib/cogs-sweep-gate"

const queryRaw = vi.mocked(prisma.$queryRaw) as unknown as ReturnType<typeof vi.fn>
const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?").replace(/\s+/g, " ")

const input = {
  storeId: "store-1",
  accountId: "acct-1",
  startDate: new Date("2026-11-17T00:00:00Z"),
  endDate: new Date("2026-11-20T00:00:00Z"),
  lookbackDays: 3,
}

beforeEach(() => {
  queryRaw.mockReset()
})

/** First $queryRaw = source change, second = last sweep (Promise.all order). */
function readings(sourceChangedAt: Date | null, lastSweepStartedAt: Date | null) {
  queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join("?")
    if (sql.includes(`FROM "JobRun"`)) return [{ startedAt: lastSweepStartedAt }]
    return [{ changedAt: sourceChangedAt }]
  })
}

describe("getLastSuccessfulCogsSweepAt", () => {
  it("reads the start of the last non-skipped successful sweep with the same lookback", async () => {
    const at = new Date("2026-11-20T08:00:00Z")
    queryRaw.mockResolvedValueOnce([{ startedAt: at }])
    expect(await getLastSuccessfulCogsSweepAt("store-1", 3)).toBe(at)
    const sql = sqlOf(queryRaw.mock.calls[0])
    expect(sql).toContain(`SELECT "startedAt" FROM "JobRun"`)
    expect(sql).toContain(`COALESCE("metadata"->>'skipped', 'false') <> 'true'`)
    expect(sql).toContain(`'SUCCESS'::"JobStatus"`)
    expect(sql).toContain(`ORDER BY "startedAt" DESC`)
    expect(queryRaw.mock.calls[0].slice(1)).toEqual(["store-1", 3])
  })
})

describe("shouldSkipCogsSweep", () => {
  it("runs when there has never been a materialization", async () => {
    readings(new Date("2026-11-20T01:00:00Z"), null)
    expect((await shouldSkipCogsSweep(input)).shouldSkip).toBe(false)
  })

  it("skips when nothing changed since the last materialization started", async () => {
    readings(new Date("2026-11-20T01:00:00Z"), new Date("2026-11-20T08:00:00Z"))
    const r = await shouldSkipCogsSweep(input)
    expect(r.shouldSkip).toBe(true)
    expect(r.reason).toBe("no source changes since last successful sweep")
  })

  it("skips when no source has any timestamp at all", async () => {
    readings(null, new Date("2026-11-20T08:00:00Z"))
    expect((await shouldSkipCogsSweep(input)).shouldSkip).toBe(true)
  })

  it("runs when a source row changed after the last materialization started — even if before it finished", async () => {
    readings(new Date("2026-11-20T08:00:30Z"), new Date("2026-11-20T08:00:00Z"))
    expect((await shouldSkipCogsSweep(input)).shouldSkip).toBe(false)
  })

  it("reads OtterMenuItem.syncedAt for the window, which only moves on a real change", async () => {
    readings(null, null)
    await shouldSkipCogsSweep(input)
    const sourceCall = queryRaw.mock.calls.find((c) => !sqlOf(c).includes(`FROM "JobRun"`))!
    expect(sqlOf(sourceCall)).toContain(`SELECT MAX("syncedAt") FROM "OtterMenuItem"`)
  })
})
