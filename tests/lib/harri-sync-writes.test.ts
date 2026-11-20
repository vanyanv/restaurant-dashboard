// Harri labor + directory syncs: one change-only bulk upsert per table.
//
// These were sequential per-row `await upsert` calls that set syncedAt on
// every row every run. Since 2026-11-20 each table gets one
// INSERT ... ON CONFLICT ... DO UPDATE ... WHERE IS DISTINCT FROM (1000-row
// chunks), so syncedAt moves only when a row changes, and `rowsChanged` /
// `changed` is what the database reports.

import { describe, it, expect, vi, beforeEach } from "vitest"

type RawSql = { sql: string; values: unknown[] }
const raw: RawSql[] = []
let affected: (sql: RawSql) => number = () => 0

vi.mock("@/lib/monitoring/job-run", () => ({
  withJobRun: vi.fn(
    async (
      _name: string,
      _opts: unknown,
      fn: (ctx: { jobRunId: string; addRows: (n: number) => void }) => Promise<unknown>,
    ) => fn({ jobRunId: "jr", addRows: () => {} }),
  ),
}))

vi.mock("@/lib/checks/setup", () => ({ syncCrewFromHarri: vi.fn(async () => {}) }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    harriBrand: {
      findFirst: vi.fn(async () => ({ id: "hb1", brandId: 20122359 })),
      update: vi.fn(async () => ({})),
    },
    harriTimekeepingAlert: { findMany: vi.fn(async () => [{ userId: 8 }, { userId: 9 }]) },
    harriShift: { findMany: vi.fn(async () => [{ userId: 9 }]) },
    jobRun: { update: vi.fn(async () => ({})) },
    $executeRaw: vi.fn(async (sql: RawSql) => {
      raw.push(sql)
      return affected(sql)
    }),
  },
}))

vi.mock("@/lib/harri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/harri")>()
  return { ...actual, harriFetch: vi.fn() }
})

import { prisma } from "@/lib/prisma"
import { harriFetch } from "@/lib/harri"
import { runHarriLaborSync } from "@/lib/harri-labor-sync"
import { refreshHarriEmployees } from "@/lib/harri-employee-sync"

const STORE = "store-1"
const writesTo = (table: string) => raw.filter((r) => r.sql.includes(`INSERT INTO "${table}"`))

function alert(id: number, timeDiff: number) {
  return {
    id,
    employee_id: 7,
    user_id: 8,
    position: { id: 1, code: "cook", name: "Cook", category: { code: "QS" } },
    alert_time: "2026-11-18T09:01:00Z",
    alert_type: { id: 3, code: "EARLY_CLOCK_IN" },
    extra_info: { time_diff: timeDiff },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  raw.length = 0
  affected = () => 0
  vi.mocked(harriFetch).mockImplementation(async (url: string) => {
    if (url.includes("positions")) {
      return {
        data: {
          days: [
            {
              date: "2026-11-16",
              categories: [
                {
                  code: "QS",
                  name: "Quick",
                  positions: [
                    {
                      code: "cook",
                      name: "Cook",
                      hourly: { total_labor: 10000, cost: { net_amount: 9000 }, total_shift_count: 2, actual_seconds: 3600, user_ids: [8] },
                    },
                  ],
                },
              ],
            },
          ],
        },
      } as never
    }
    if (url.includes("alert")) return { data: { alerts: [alert(123456789012, 60), alert(123456789012, 120)] } } as never
    if (url.includes("categor")) {
      return { data: { total_labor_cost: 50000, date: "2026-11-18", categories: [{ id: 1, code: "QS", name: "Quick", total_labor_cost: 50000 }] } } as never
    }
    return { data: { total_labor_cost: 50000, date: "2026-11-18" } } as never
  })
})

describe("runHarriLaborSync — change-only bulk writes", () => {
  const opts = {
    storeId: STORE,
    startDate: new Date("2026-11-16T00:00:00Z"),
    endDate: new Date("2026-11-18T00:00:00Z"),
    triggeredBy: "manual" as const,
  }

  it("writes each table with one statement instead of a per-row upsert", async () => {
    const r = await runHarriLaborSync(opts)

    const labor = writesTo("HarriDailyLabor")
    expect(labor).toHaveLength(1)
    expect(labor[0].sql).toContain(`ON CONFLICT ("storeId", "date") DO UPDATE`)
    expect(labor[0].sql).toMatch(/IS DISTINCT FROM/)

    const positions = writesTo("HarriPositionDaily")
    expect(positions).toHaveLength(1)
    expect(positions[0].sql).toContain(
      `ON CONFLICT ("storeId", "date", "categoryCode", "positionCode", "payType")`,
    )
    expect(positions[0].values).toContainEqual([8])

    const alerts = writesTo("HarriTimekeepingAlert")
    expect(alerts).toHaveLength(1)
    expect(alerts[0].sql).toContain(`ON CONFLICT ("harriAlertId")`)
    // who/where are insert-only, exactly as the per-row upsert's `update` was
    expect(alerts[0].sql).not.toContain(`"storeId" = EXCLUDED`)
    expect(alerts[0].sql).not.toContain(`"userId" = EXCLUDED`)
    expect(alerts[0].sql).toContain(`"timeDiffSec" = EXCLUDED."timeDiffSec"`)
    // the id is bound as text and cast to bigint, and the repeated alert is
    // written once with its last sighting's timing
    expect(alerts[0].values).toContain("123456789012")
    expect(alerts[0].sql).toMatch(/\?::bigint/)
    expect(alerts[0].values).toContain(120)
    expect(alerts[0].values).not.toContain(60)

    expect(r).toMatchObject({ daysWritten: 3, positionsWritten: 1, alertsWritten: 1, rowsChanged: 0 })
  })

  it("reports the rows the database actually changed", async () => {
    affected = (sql) => (sql.sql.includes(`"HarriDailyLabor"`) ? 2 : 0)
    const r = await runHarriLaborSync(opts)
    expect(r.rowsChanged).toBe(2)
    expect(r.daysWritten).toBe(3)
  })
})

describe("refreshHarriEmployees — change-only bulk write", () => {
  it("writes the directory with one statement and reports what changed", async () => {
    vi.mocked(harriFetch).mockResolvedValue({
      data: [
        { id: 8, first_name: "Ana", last_name: "B", phone: "(555) 555-0100", status: "ACTIVE" },
        { id: 9, first_name: "Bo", last_name: "C", phone: null, status: "ACTIVE" },
      ],
    } as never)
    affected = () => 1

    const r = await refreshHarriEmployees({ storeId: STORE, brandId: 20122359, triggeredBy: "manual" })

    const writes = writesTo("HarriEmployee")
    expect(writes).toHaveLength(1)
    expect(writes[0].sql).toContain(`ON CONFLICT ("storeId", "userId") DO UPDATE`)
    expect(writes[0].sql).toMatch(/IS DISTINCT FROM/)
    expect(writes[0].values).toEqual(expect.arrayContaining([STORE, 8, 9, "Ana", "Bo"]))
    expect(r).toEqual({ requested: 2, fetched: 2, upserted: 2, changed: 1 })
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
  })
})
