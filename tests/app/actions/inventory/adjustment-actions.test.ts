// logInventoryAdjustment — manual write that subtracts qty from running
// on-hand. Used for theft, expiry, supplier returns, damage, and "other".
// Daily spills/comps are absorbed into the weekly recount delta — this is
// strictly for major events the operator wants on the audit trail.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findUnique: vi.fn() },
    canonicalIngredient: { findUnique: vi.fn() },
    inventoryAdjustment: { create: vi.fn() },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { logInventoryAdjustment } from "@/app/actions/inventory/adjustment-actions"

const session = (overrides: Record<string, unknown> = {}) => ({
  user: { id: "u1", accountId: "acct-A", ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.inventoryAdjustment.create).mockResolvedValue({ id: "adj-1" } as never)
})

describe("logInventoryAdjustment", () => {
  it("returns null when no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const r = await logInventoryAdjustment({
      storeId: "s1",
      canonicalIngredientId: "ing-1",
      qty: 1,
      reason: "EXPIRY",
    })
    expect(r).toBeNull()
  })

  it("rejects invalid qty (≤ 0 or non-finite)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    for (const bad of [0, -1, NaN, Infinity]) {
      const r = await logInventoryAdjustment({
        storeId: "s1",
        canonicalIngredientId: "ing-1",
        qty: bad,
        reason: "EXPIRY",
      })
      expect(r).toEqual({ ok: false, error: "invalid_qty" })
    }
    expect(prisma.inventoryAdjustment.create).not.toHaveBeenCalled()
  })

  it("rejects a store outside the caller's account", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      accountId: "acct-OTHER",
    } as never)
    const r = await logInventoryAdjustment({
      storeId: "s1",
      canonicalIngredientId: "ing-1",
      qty: 1,
      reason: "EXPIRY",
    })
    expect(r).toEqual({ ok: false, error: "store_not_in_account" })
    expect(prisma.inventoryAdjustment.create).not.toHaveBeenCalled()
  })

  it("rejects an ingredient outside the caller's account", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      accountId: "acct-A",
    } as never)
    vi.mocked(prisma.canonicalIngredient.findUnique).mockResolvedValue({
      id: "ing-1",
      accountId: "acct-OTHER",
    } as never)
    const r = await logInventoryAdjustment({
      storeId: "s1",
      canonicalIngredientId: "ing-1",
      qty: 1,
      reason: "EXPIRY",
    })
    expect(r).toEqual({ ok: false, error: "ingredient_not_in_account" })
    expect(prisma.inventoryAdjustment.create).not.toHaveBeenCalled()
  })

  it("creates an InventoryAdjustment with the supplied reason, qty, note, and createdByUser", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      accountId: "acct-A",
    } as never)
    vi.mocked(prisma.canonicalIngredient.findUnique).mockResolvedValue({
      id: "ing-1",
      accountId: "acct-A",
    } as never)
    const occurredAt = new Date("2026-05-08T10:00:00.000Z")
    const r = await logInventoryAdjustment({
      storeId: "s1",
      canonicalIngredientId: "ing-1",
      qty: 3.5,
      reason: "THEFT",
      note: "register short",
      occurredAt,
    })
    expect(r).toEqual({ ok: true, adjustmentId: "adj-1" })

    const callArg = vi.mocked(prisma.inventoryAdjustment.create).mock.calls[0][0] as {
      data: {
        storeId: string
        canonicalIngredientId: string
        qty: number
        reason: string
        note: string | null
        occurredAt: Date
        createdByUserId: string
      }
    }
    expect(callArg.data.storeId).toBe("s1")
    expect(callArg.data.canonicalIngredientId).toBe("ing-1")
    expect(callArg.data.qty).toBe(3.5)
    expect(callArg.data.reason).toBe("THEFT")
    expect(callArg.data.note).toBe("register short")
    expect(callArg.data.occurredAt).toEqual(occurredAt)
    expect(callArg.data.createdByUserId).toBe("u1")
  })

  it("defaults occurredAt to now when not supplied", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.store.findUnique).mockResolvedValue({
      id: "s1",
      accountId: "acct-A",
    } as never)
    vi.mocked(prisma.canonicalIngredient.findUnique).mockResolvedValue({
      id: "ing-1",
      accountId: "acct-A",
    } as never)
    const before = Date.now()
    await logInventoryAdjustment({
      storeId: "s1",
      canonicalIngredientId: "ing-1",
      qty: 1,
      reason: "DAMAGE",
    })
    const after = Date.now()
    const callArg = vi.mocked(prisma.inventoryAdjustment.create).mock.calls[0][0] as {
      data: { occurredAt: Date }
    }
    const ts = callArg.data.occurredAt.getTime()
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })
})
