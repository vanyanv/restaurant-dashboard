// The store file's save path (review, 2026-10-28): lifecycle sent only when
// the owner changed it; commission rates in ONE unit (percents) with
// out-of-range and non-numeric values refused with a visible error.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/app/actions/store-actions", () => ({
  createStore: vi.fn(),
  deleteStore: vi.fn(),
  updateStore: vi.fn(async () => ({ success: true })),
}))
vi.mock("@/app/actions/cogs-actions", () => ({ setStoreTargetCogsPct: vi.fn() }))
vi.mock("@/app/actions/store/fixed-expense-actions", () => ({
  createStoreFixedExpense: vi.fn(),
  deleteStoreFixedExpense: vi.fn(),
  updateStoreFixedExpense: vi.fn(),
}))
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {}, hasOwnerAccess: () => true }))
vi.mock("@/lib/prisma", () => ({
  prisma: { store: { findFirst: vi.fn(), update: vi.fn() } },
}))
vi.mock("@/lib/account-stores", () => ({ getAccountStoreRows: vi.fn() }))
vi.mock("@/lib/chat/owner-scope", () => ({ invalidateOwnerStoreCache: vi.fn() }))
vi.mock("@/lib/cache/cached", () => ({ bustTags: vi.fn(async () => undefined) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { updateStore } from "@/app/actions/store-actions"
import { updateStore as realUpdateStore } from "@/app/actions/store/crud-actions"
import { saveStoreFile, type StoreFileEdit } from "@/lib/counter/actions/store"
import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"

const EDIT: StoreFileEdit = {
  name: "Hollywood",
  address: null,
  phone: null,
  fixedMonthlyRent: 24_000,
  fixedMonthlyLabor: null,
  fixedMonthlyTowels: null,
  fixedMonthlyCleaning: null,
  uberCommissionRate: 27,
  doordashCommissionRate: 25,
  uberPickupCommissionRate: 10,
  doordashPickupCommissionRate: 6,
  grubhubCommissionRate: null,
}

const sent = () => vi.mocked(updateStore).mock.calls[0][1] as FormData

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getServerSession).mockResolvedValue({ user: { role: "OWNER", accountId: "acc_1" } } as never)
  vi.mocked(prisma.store.findFirst).mockResolvedValue({ id: "s1" } as never)
  vi.mocked(prisma.store.update).mockResolvedValue({ id: "s1" } as never)
})

describe("saveStoreFile — lifecycle", () => {
  it("does not send the stage when the owner left it alone", async () => {
    await saveStoreFile("s1", EDIT)
    // A store the nightly model promoted warming_up → ready must not be put back.
    expect(sent().has("lifecycleStage")).toBe(false)
  })

  it("sends the stage when the owner changed it", async () => {
    await saveStoreFile("s1", { ...EDIT, lifecycleStage: "ready" })
    expect(sent().get("lifecycleStage")).toBe("ready")
  })
})

describe("saveStoreFile — rates travel as percents", () => {
  it("sends what the owner typed, and blank for a cleared optional rate", async () => {
    await saveStoreFile("s1", EDIT)
    expect(sent().get("doordashCommissionRate")).toBe("25")
    expect(sent().get("doordashPickupCommissionRate")).toBe("6")
    expect(sent().get("grubhubCommissionRate")).toBe("")
  })
})

describe("updateStore — one unit, strict", () => {
  function form(over: Record<string, string>) {
    const f = new FormData()
    f.set("name", "Hollywood")
    f.set("isActive", "true")
    for (const [k, v] of Object.entries(over)) f.set(k, v)
    return f
  }
  const saved = () =>
    vi.mocked(prisma.store.update).mock.calls[0][0].data as Record<string, unknown>

  it("stores percents as fractions, once: 25 → 0.25, 1 → 0.01", async () => {
    const r = await realUpdateStore("s1", form({ doordashCommissionRate: "25", grubhubCommissionRate: "1" }))
    expect(r).toMatchObject({ success: true })
    expect(saved().doordashCommissionRate).toBe(0.25)
    expect(saved().grubhubCommissionRate).toBe(0.01)
  })

  it("refuses 150 instead of saving 1.5%", async () => {
    const r = await realUpdateStore("s1", form({ uberCommissionRate: "150" }))
    expect(r).toEqual({ error: "Uber Eats delivery must be between 0% and 100%" })
    expect(prisma.store.update).not.toHaveBeenCalled()
  })

  it("refuses a non-numeric pickup or Grubhub rate instead of ignoring it", async () => {
    const r = await realUpdateStore("s1", form({ grubhubCommissionRate: "abc" }))
    expect(r).toEqual({ error: "Grubhub must be a number, like 25 for 25%" })
    expect(prisma.store.update).not.toHaveBeenCalled()
  })

  it("blank clears an optional rate; an absent field is left unchanged", async () => {
    await realUpdateStore("s1", form({ uberPickupCommissionRate: "" }))
    expect(saved().uberPickupCommissionRate).toBeNull()
    expect("doordashCommissionRate" in saved()).toBe(false)
    expect(saved().lifecycleStage).toBeUndefined()
  })
})
