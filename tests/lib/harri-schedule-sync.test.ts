// Harri schedule sync: each week Harri serves replaces that week's shifts.
//
// Two holes this pins (2026-11-20 audit):
//  - a week served with zero shifts was skipped before the delete, so shifts
//    the manager had removed stayed behind as phantom staffed hours;
//  - a shift whose harriShiftId was stored under another weekStart was
//    skipped by `skipDuplicates` and never moved.
// A week whose request FAILED must still never be cleared.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/monitoring/job-run", () => ({
  withJobRun: vi.fn(
    async (
      _name: string,
      _opts: unknown,
      fn: (ctx: { jobRunId: string; addRows: (n: number) => void }) => Promise<unknown>,
    ) => fn({ jobRunId: "jr", addRows: () => {} }),
  ),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    harriBrand: { findFirst: vi.fn(async () => ({ id: "hb1", brandId: 20122359 })) },
    harriShift: {
      deleteMany: vi.fn((args: unknown) => ({ op: "deleteMany", args })),
      createMany: vi.fn((args: unknown) => ({ op: "createMany", args })),
    },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}))

vi.mock("@/lib/harri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/harri")>()
  return { ...actual, harriFetch: vi.fn() }
})

import { prisma } from "@/lib/prisma"
import { harriFetch } from "@/lib/harri"
import { runHarriScheduleSync } from "@/lib/harri-schedule-sync"

const STORE = "store-1"
const WEEK1 = new Date("2026-11-16T00:00:00.000Z")
const WEEK2 = new Date("2026-11-23T00:00:00.000Z")

function weekWithShift(id: number) {
  return {
    data: {
      schedule: [
        {
          id: 1,
          start_date: "Nov 16, 2026",
          roles: [
            {
              position: { code: "cook", name: "Cook" },
              role_days: [
                {
                  date: "Nov 17, 2026",
                  assignees: [
                    {
                      user_id: 8,
                      assignee_shifts: [
                        { id, start_time: "Nov 17, 2026 09:00", end_time: "Nov 17, 2026 17:00" },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  }
}

const run = () =>
  runHarriScheduleSync({
    storeId: STORE,
    startDate: WEEK1,
    endDate: new Date("2026-11-29T00:00:00.000Z"),
    triggeredBy: "manual",
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe("runHarriScheduleSync", () => {
  it("clears a week Harri served with no shifts", async () => {
    vi.mocked(harriFetch).mockImplementation((async (url: string) =>
      url.includes("Nov+23") ? { data: { schedule: [] } } : weekWithShift(7)
    ) as never)
    const r = await run()

    expect(r).toMatchObject({ weeksRequested: 2, weeksOk: 2, weeksEmpty: 1, shiftsWritten: 1 })
    expect(prisma.harriShift.deleteMany).toHaveBeenCalledWith({
      where: { storeId: STORE, weekStart: WEEK2 },
    })
  })

  it("never clears a week whose request failed", async () => {
    vi.mocked(harriFetch).mockImplementation((async (url: string) => {
      if (url.includes("Nov+23")) throw new Error("Harri API error 502 on /schedule")
      return weekWithShift(7)
    }) as never)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const r = await run()
    warn.mockRestore()

    expect(r).toMatchObject({ weeksOk: 1, weeksEmpty: 0 })
    const deleted = vi.mocked(prisma.harriShift.deleteMany).mock.calls.map(
      ([a]) => JSON.stringify(a),
    )
    expect(deleted.join()).not.toContain(WEEK2.toISOString())
  })

  it("moves a shift stored under another week: its id is deleted with the week, in one transaction", async () => {
    vi.mocked(harriFetch).mockImplementation((async (url: string) =>
      url.includes("Nov+23") ? { data: { schedule: [] } } : weekWithShift(4242)
    ) as never)
    await run()

    expect(prisma.harriShift.deleteMany).toHaveBeenCalledWith({
      where: {
        storeId: STORE,
        OR: [{ weekStart: WEEK1 }, { harriShiftId: { in: [4242] } }],
      },
    })
    const [ops] = vi.mocked(prisma.$transaction).mock.calls[0] as unknown as [Array<{ op: string }>]
    expect(ops.map((o) => o.op)).toEqual(["deleteMany", "createMany"])
  })
})
