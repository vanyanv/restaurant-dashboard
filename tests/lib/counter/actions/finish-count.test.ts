// finishCount: calibration and the guarded status flip commit together, so a
// double tap or a retry after a crash never applies a recount twice.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/auth", () => ({ hasOwnerAccess: () => true }))
vi.mock("@/lib/auth-scope", () => ({
  getSession: vi.fn(async () => ({ user: { id: "u1", accountId: "acct-A", role: "OWNER" } })),
  requireOwnerStore: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: { stockCount: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() } },
}))
const tx = { stockCount: { updateMany: vi.fn() } }
vi.mock("@/lib/inventory/calibration-update", () => ({
  applyCalibrationUpdatesForCount: vi.fn(
    async (_id: string, _acct: string, finish?: (t: unknown) => Promise<boolean>) =>
      finish ? finish(tx) : true,
  ),
}))
vi.mock("@/lib/inventory/store-inventory-context", () => ({
  loadStoreInventoryContext: vi.fn(),
  runningOnHandFromContext: vi.fn(),
}))

import { prisma } from "@/lib/prisma"
import { applyCalibrationUpdatesForCount } from "@/lib/inventory/calibration-update"
import { finishCount } from "@/lib/counter/actions/count"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.stockCount.findFirst).mockResolvedValue({
    id: "sc-1",
    status: "IN_PROGRESS",
    _count: { lines: 3 },
  } as never)
})

describe("finishCount", () => {
  it("flips IN_PROGRESS → COMPLETED inside the calibration transaction", async () => {
    tx.stockCount.updateMany.mockResolvedValue({ count: 1 })
    expect(await finishCount("sc-1")).toEqual({ ok: true, id: "sc-1" })
    expect(applyCalibrationUpdatesForCount).toHaveBeenCalledWith("sc-1", "acct-A", expect.any(Function))
    expect(tx.stockCount.updateMany).toHaveBeenCalledWith({
      where: { id: "sc-1", status: "IN_PROGRESS" },
      data: { status: "COMPLETED", completedAt: expect.any(Date), countedAt: expect.any(Date) },
    })
    // No flip outside the transaction.
    expect(prisma.stockCount.updateMany).not.toHaveBeenCalled()
    expect(prisma.stockCount.update).not.toHaveBeenCalled()
  })

  it("a second call that loses the race reports the count finished", async () => {
    tx.stockCount.updateMany.mockResolvedValue({ count: 0 })
    expect(await finishCount("sc-1")).toEqual({ ok: false, error: "This count is already finished" })
  })

  it("an already finished count never reaches calibration", async () => {
    vi.mocked(prisma.stockCount.findFirst).mockResolvedValue({
      id: "sc-1",
      status: "COMPLETED",
      _count: { lines: 3 },
    } as never)
    expect(await finishCount("sc-1")).toEqual({ ok: false, error: "This count is already finished" })
    expect(applyCalibrationUpdatesForCount).not.toHaveBeenCalled()
  })
})
