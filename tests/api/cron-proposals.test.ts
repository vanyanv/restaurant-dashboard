/**
 * Contract for the post-sync proposal generator. The route walks every active
 * store, and before 2026-09-19 it did so with no `maxDuration` and no bound —
 * so Vercel's 10s default killed every run at ~11s, nothing was written, and
 * the next run restarted the same walk. What is asserted here is the bound:
 * a run stops starting stores at its budget, reports what it skipped, and the
 * following run resumes after the last store the previous one finished rather
 * than re-walking the same prefix.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {}, hasOwnerAccess: () => true }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: vi.fn() },
    user: { findFirst: vi.fn() },
    jobRun: { findFirst: vi.fn(), update: vi.fn() },
  },
}))

// withJobRun's own contract is covered by tests/lib/monitoring/cron-wrapper.test.ts.
// Here it is a pass-through so the assertions are about the route's walk.
vi.mock("@/lib/monitoring/job-run", () => ({
  withJobRun: vi.fn(
    async (
      _name: string,
      _opts: unknown,
      fn: (ctx: { jobRunId: string; addRows: (n: number) => void }) => Promise<unknown>,
    ) => fn({ jobRunId: "run-1", addRows: () => {} }),
  ),
}))

vi.mock("@/lib/mapping-proposals-core", () => ({
  generateMappingProposalsCore: vi.fn(),
}))

import { prisma } from "@/lib/prisma"
import { generateMappingProposalsCore } from "@/lib/mapping-proposals-core"
import { GET } from "@/app/api/cron/proposals/route"
import type { NextRequest } from "next/server"

const SECRET = "test-cron-secret"
const findStores = vi.mocked(prisma.store.findMany)
const findPreviousRun = vi.mocked(prisma.jobRun.findFirst)
const updateJobRun = vi.mocked(prisma.jobRun.update)
const core = vi.mocked(generateMappingProposalsCore)

const STORES = [
  { id: "s-a", name: "Alpha", accountId: "acct-1" },
  { id: "s-b", name: "Bravo", accountId: "acct-1" },
  { id: "s-c", name: "Charlie", accountId: "acct-1" },
]

function req(): NextRequest {
  return new Request("http://test.local/api/cron/proposals", {
    headers: { authorization: `Bearer ${SECRET}` },
  }) as unknown as NextRequest
}

/** Store ids in the order the route handed them to the core, run by run. */
function walkedIds(): string[] {
  return core.mock.calls.map((c) => (c[1] as { storeId: string }).storeId)
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  findStores.mockResolvedValue(STORES as never)
  vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "owner-1" } as never)
  findPreviousRun.mockResolvedValue(null as never)
  updateJobRun.mockResolvedValue({} as never)
  core.mockResolvedValue({ ok: true, created: 1, skippedExisting: 0 } as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("GET /api/cron/proposals", () => {
  it("walks every store when the budget allows and defers none", async () => {
    const res = await GET(req())

    expect(walkedIds()).toEqual(["s-a", "s-b", "s-c"])
    await expect(res.json()).resolves.toMatchObject({ deferred: 0 })
    expect(updateJobRun).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { metadata: { deferred: 0, lastStoreId: "s-c" } },
      }),
    )
  })

  it("resumes after the last store the previous run finished", async () => {
    findPreviousRun.mockResolvedValue({
      metadata: { deferred: 2, lastStoreId: "s-a" },
    } as never)

    await GET(req())

    // Alpha was done last run, so this one starts at Bravo and wraps to Alpha.
    expect(walkedIds()).toEqual(["s-b", "s-c", "s-a"])
  })

  it("starts from the top when the recorded store is no longer active", async () => {
    findPreviousRun.mockResolvedValue({
      metadata: { deferred: 0, lastStoreId: "s-deactivated" },
    } as never)

    await GET(req())

    expect(walkedIds()).toEqual(["s-a", "s-b", "s-c"])
  })

  it("stops starting stores at the budget and reports the rest as deferred", async () => {
    vi.useFakeTimers()
    // Each store burns 40s of the 75s budget, so the third is never started.
    core.mockImplementation(async () => {
      vi.advanceTimersByTime(40_000)
      return { ok: true, created: 0, skippedExisting: 3 } as never
    })

    const res = await GET(req())

    expect(walkedIds()).toEqual(["s-a", "s-b"])
    await expect(res.json()).resolves.toMatchObject({ deferred: 1 })
    // The cursor is the last store completed — next run picks up at Charlie.
    expect(updateJobRun).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { metadata: { deferred: 1, lastStoreId: "s-b" } },
      }),
    )
  })

  it("keeps walking when a store throws instead of returning an error", async () => {
    core.mockImplementation(async (_scope, opts) => {
      const { storeId } = opts as { storeId: string }
      if (storeId === "s-a") throw new Error("connection terminated")
      return { ok: true, created: 0, skippedExisting: 0 } as never
    })

    const res = await GET(req())
    const body = (await res.json()) as {
      stores: Array<{ storeId: string; error?: string }>
    }

    // An uncaught throw would leave the loop before recordProgress, so the
    // rotation would never advance past the store that threw.
    expect(walkedIds()).toEqual(["s-a", "s-b", "s-c"])
    expect(body.stores.find((s) => s.storeId === "s-a")?.error).toBe(
      "connection terminated",
    )
    expect(updateJobRun).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { metadata: { deferred: 0, lastStoreId: "s-c" } },
      }),
    )
  })

  it("writes the cursor after every store, not once at the end", async () => {
    await GET(req())

    // The budget only decides whether to START a store, so one slow store can
    // carry the invocation past maxDuration and kill it mid-walk. A cursor
    // written only after the loop would not survive that, and the next run
    // would begin at the same slow store — the starvation the rotation exists
    // to prevent.
    const cursors = updateJobRun.mock.calls.map(
      (c) => (c[0] as { data: { metadata: { lastStoreId: string } } }).data.metadata.lastStoreId,
    )
    expect(cursors).toEqual(
      expect.arrayContaining(["s-a", "s-b", "s-c"]),
    )
    expect(cursors.indexOf("s-a")).toBeLessThan(cursors.indexOf("s-c"))
  })

  it("fails the run rather than closing it with an unwritten cursor", async () => {
    updateJobRun.mockRejectedValue(new Error("write conflict") as never)

    // Swallowing this closed the run SUCCESS with no cursor, and the next run
    // re-walked the prefix — under a budget, the tail would never be reached.
    await expect(GET(req())).rejects.toThrow("write conflict")
  })

  it("advances the cursor past a store whose generation failed", async () => {
    core.mockImplementation(async (_scope, opts) => {
      const { storeId } = opts as { storeId: string }
      return storeId === "s-a"
        ? ({ ok: false, error: "no_data" } as never)
        : ({ ok: true, created: 0, skippedExisting: 0 } as never)
    })

    const res = await GET(req())
    const body = (await res.json()) as {
      stores: Array<{ storeId: string; error?: string }>
    }

    // A failing store must not pin the rotation to itself forever.
    expect(walkedIds()).toEqual(["s-a", "s-b", "s-c"])
    expect(body.stores.find((s) => s.storeId === "s-a")?.error).toBe("no_data")
    expect(updateJobRun).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { metadata: { deferred: 0, lastStoreId: "s-c" } },
      }),
    )
  })
})
