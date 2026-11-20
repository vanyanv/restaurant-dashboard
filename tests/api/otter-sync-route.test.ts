// POST /api/otter/sync. An owner's manual sync used to read every account's
// Otter stores (an unscoped findMany) and filter on `isActive` alone, so it
// synced other tenants' stores and pre-open stores. It now scopes to the
// caller's accountId and uses shouldSyncStore like every other Otter path;
// the cron caller, which has no session, still syncs every account.

import { describe, it, expect, vi, beforeEach } from "vitest"

const session = vi.hoisted(() => ({ value: null as unknown }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => session.value) }))
vi.mock("@/lib/auth", () => ({ authOptions: {}, hasOwnerAccess: () => true }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/cache/cached", () => ({ bustTags: vi.fn(async () => {}) }))
const cron = vi.hoisted(() => ({ value: false }))
vi.mock("@/lib/rate-limit", () => ({
  isCronRequest: () => cron.value,
  rateLimit: vi.fn(async () => null),
  RATE_LIMIT_TIERS: { strict: {} },
}))

const db = vi.hoisted(() => ({ otterStore: { findMany: vi.fn() } }))
vi.mock("@/lib/prisma", () => ({ prisma: db }))

const phase = { synced: 0, failed: 0, changed: 0, removed: 0, fetchFailed: 0 }
vi.mock("@/lib/otter-metrics-sync", () => ({
  runMetricsSyncForStore: vi.fn(async (storeId: string) => ({
    storeId,
    daily: phase,
    categories: { ...phase, fetchFailed: storeId === "s-open" ? 1 : 0 },
    items: phase,
    modifiers: phase,
    ratings: phase,
    windowStart: new Date(),
    windowEnd: new Date(),
    problems: storeId === "s-open" ? ["categories: fetch failed for 1/4 days"] : [],
  })),
  totalChangedRows: () => 0,
}))

import { POST } from "@/app/api/otter/sync/route"
import { runMetricsSyncForStore } from "@/lib/otter-metrics-sync"
import type { NextRequest } from "next/server"

const req = () =>
  new Request("http://test.local/api/otter/sync", { method: "POST" }) as unknown as NextRequest

beforeEach(() => {
  vi.clearAllMocks()
  cron.value = false
  session.value = { user: { id: "u1", role: "OWNER", accountId: "acct-1" } }
  db.otterStore.findMany.mockResolvedValue([
    { otterStoreId: "o1", storeId: "s-open", store: { id: "s-open", name: "Open", isActive: true, lifecycleStage: "ready" } },
    { otterStoreId: "o2", storeId: "s-pre", store: { id: "s-pre", name: "Soon", isActive: true, lifecycleStage: "pre_open" } },
    { otterStoreId: "o3", storeId: "s-off", store: { id: "s-off", name: "Off", isActive: false, lifecycleStage: "ready" } },
  ])
})

describe("POST /api/otter/sync", () => {
  it("scopes an owner's sync to their account and skips stores shouldSyncStore rejects", async () => {
    const body = await (await POST(req())).json()

    expect(db.otterStore.findMany.mock.calls[0][0].where).toEqual({
      store: { accountId: "acct-1" },
    })
    expect(vi.mocked(runMetricsSyncForStore).mock.calls.map(([sid]) => sid)).toEqual(["s-open"])
    // a failed fetch is reported, not hidden behind "failed: 0"
    expect(body).toMatchObject({ storesProcessed: 1, fetchFailures: 1, storesIncomplete: 1 })
    expect(body.message).toMatch(/INCOMPLETE/)
  })

  it("lets the cron caller sync every account", async () => {
    cron.value = true
    session.value = null
    await POST(req())
    expect(db.otterStore.findMany.mock.calls[0][0].where).toBeUndefined()
  })
})
