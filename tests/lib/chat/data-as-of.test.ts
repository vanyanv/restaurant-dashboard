/*
 * "Data as of" is read from the newest SUCCESS JobRun for the sync jobs that
 * write a table, not from MAX(col) over the table. Sources that people or
 * other code also write (invoices, cogs) and sources with no job keep the
 * table read, and a source with no SUCCESS run yet falls back to it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const findFirst = vi.fn()
const queryRaw = vi.fn()
vi.mock("@/lib/prisma", () => ({
  prisma: { jobRun: { findFirst: (a: unknown) => findFirst(a) }, $queryRaw: (...a: unknown[]) => queryRaw(...a) },
}))
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }))

async function load() {
  vi.resetModules()
  return import("@/lib/chat/data-as-of")
}

beforeEach(() => {
  findFirst.mockReset()
  queryRaw.mockReset()
})

describe("asOfForTool from JobRun", () => {
  it("uses the newest SUCCESS completedAt of the source's job, never touching the table", async () => {
    findFirst.mockResolvedValue({ completedAt: new Date("2026-11-20T08:00:00Z") })
    const { asOfForTool } = await load()
    expect(await asOfForTool("getDailySales")).toBe("2026-11-20T08:00:00.000Z")
    expect(findFirst).toHaveBeenCalledWith({
      where: { jobName: "otter.metrics.sync", status: "SUCCESS", completedAt: { not: null } },
      orderBy: { startedAt: "desc" },
      select: { completedAt: true },
    })
    expect(queryRaw).not.toHaveBeenCalled()
  })

  it("takes the newest across a source with two jobs (orders sync + drain)", async () => {
    findFirst.mockImplementation(async ({ where }) =>
      where.jobName === "otter.orders.sync"
        ? { completedAt: new Date("2026-11-20T04:00:00Z") }
        : { completedAt: new Date("2026-11-19T04:00:00Z") },
    )
    const { asOfForTool } = await load()
    expect(await asOfForTool("getOrderById")).toBe("2026-11-20T04:00:00.000Z")
  })

  it("falls back to MAX(column) when no SUCCESS run exists", async () => {
    findFirst.mockResolvedValue(null)
    queryRaw.mockResolvedValue([{ max: new Date("2026-11-18T00:00:00Z") }])
    const { asOfForTool } = await load()
    expect(await asOfForTool("getHourlyTrend")).toBe("2026-11-18T00:00:00.000Z")
  })

  it.each(["searchInvoices", "getCogsByItem", "getRevenueForecast", "getAlerts"])(
    "%s keeps the table read",
    async (tool) => {
      queryRaw.mockResolvedValue([{ max: new Date("2026-11-17T00:00:00Z") }])
      const { asOfForTool } = await load()
      expect(await asOfForTool(tool)).toBe("2026-11-17T00:00:00.000Z")
      expect(findFirst).not.toHaveBeenCalled()
    },
  )

  it("returns null for an unstamped tool and for a failed read", async () => {
    const { asOfForTool } = await load()
    expect(await asOfForTool("listStores")).toBeNull()
    findFirst.mockRejectedValue(new Error("down"))
    expect(await asOfForTool("getDailySales")).toBeNull()
  })

  it("maxAsOfForTools returns the newest across sources, one read per source", async () => {
    findFirst.mockImplementation(async ({ where }) =>
      where.jobName === "otter.hourly.sync"
        ? { completedAt: new Date("2026-11-20T09:00:00Z") }
        : { completedAt: new Date("2026-11-20T04:00:00Z") },
    )
    const { maxAsOfForTools } = await load()
    expect(await maxAsOfForTools(["getDailySales", "compareSales", "getHourlyTrend"])).toBe(
      "2026-11-20T09:00:00.000Z",
    )
    expect(findFirst).toHaveBeenCalledTimes(2)
  })
})
