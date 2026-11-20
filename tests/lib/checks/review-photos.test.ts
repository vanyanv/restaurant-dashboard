// "All the rest look good" on check photos. Pinned: one read of the photos,
// account-scoped; all or nothing (an id from another account, a photo already
// sent back, or a tick that no longer stands refuses the lot and writes
// nothing); one updateMany; one revalidation.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {}, hasOwnerAccess: (role: string) => role === "OWNER" || role === "DEVELOPER" }))
vi.mock("@/lib/auth-scope", () => ({ requireOwnerStore: vi.fn(), getSession: vi.fn() }))
vi.mock("@/lib/checks/email", () => ({ sendPinEmail: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    checkMark: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}))

import { revalidatePath } from "next/cache"
import { getSession } from "@/lib/auth-scope"
import { prisma } from "@/lib/prisma"
import { reviewCheckPhotos } from "@/lib/counter/actions/checks"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const OWNER = { user: { id: "u1", name: "Vardan", role: "OWNER", accountId: "acc_1" } }
const day = new Date("2026-11-19T00:00:00Z")
const mark = (id: string, itemId: string, extra: Record<string, unknown> = {}) => ({
  id, storeId: "st_1", kind: "EVENING", businessDate: day, itemId, done: true, review: null, ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  asMock(getSession).mockResolvedValue(OWNER)
  asMock(prisma.checkMark.updateMany).mockResolvedValue({ count: 2 })
})

describe("reviewCheckPhotos", () => {
  it("marks every photo in one write and revalidates once", async () => {
    const marks = [mark("m1", "it_1"), mark("m2", "it_2")]
    asMock(prisma.checkMark.findMany).mockResolvedValueOnce(marks).mockResolvedValueOnce(marks)
    const r = await reviewCheckPhotos({ markIds: ["m1", "m2", "m1"], verdict: "ok" })
    expect(r).toEqual({ ok: true, message: "2 marked as looking good." })
    // The photos are read inside the caller's account.
    expect(asMock(prisma.checkMark.findMany).mock.calls[0][0].where).toMatchObject({
      id: { in: ["m1", "m2"] },
      photoKey: { not: null },
      store: { accountId: "acc_1" },
    })
    expect(prisma.checkMark.updateMany).toHaveBeenCalledTimes(1)
    const write = asMock(prisma.checkMark.updateMany).mock.calls[0][0]
    expect(write.where.id).toEqual({ in: ["m1", "m2"] })
    expect(write.data).toMatchObject({ review: "ok", reviewNote: null, reviewedBy: "Vardan" })
    expect(prisma.checkMark.update).not.toHaveBeenCalled()
    // revalidateChecks: the desk and phone checks layouts, once each.
    expect(asMock(revalidatePath).mock.calls).toEqual([
      ["/dashboard/checks", "layout"],
      ["/m/checks", "layout"],
    ])
  })

  it("refuses all when any id is not a photo on the caller's account", async () => {
    asMock(prisma.checkMark.findMany).mockResolvedValueOnce([mark("m1", "it_1")])
    const r = await reviewCheckPhotos({ markIds: ["m1", "m_other"], verdict: "ok" })
    expect(r.ok).toBe(false)
    expect(prisma.checkMark.updateMany).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("refuses all when a photo was already sent back", async () => {
    asMock(prisma.checkMark.findMany).mockResolvedValueOnce([mark("m1", "it_1"), mark("m2", "it_2", { review: "redo" })])
    const r = await reviewCheckPhotos({ markIds: ["m1", "m2"], verdict: "ok" })
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/sent back/) })
    expect(prisma.checkMark.updateMany).not.toHaveBeenCalled()
  })

  it("refuses all when a newer tick or untick stands on one of the tasks", async () => {
    const marks = [mark("m1", "it_1"), mark("m2", "it_2")]
    // Newest first: crew redid it_2 after m2's photo.
    const latest = [marks[0], mark("m3", "it_2"), marks[1]]
    asMock(prisma.checkMark.findMany).mockResolvedValueOnce(marks).mockResolvedValueOnce(latest)
    const r = await reviewCheckPhotos({ markIds: ["m1", "m2"], verdict: "ok" })
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/changed/) })
    expect(prisma.checkMark.updateMany).not.toHaveBeenCalled()
    // The read of the standing ticks is account-scoped too.
    expect(asMock(prisma.checkMark.findMany).mock.calls[1][0].where.store).toEqual({ accountId: "acc_1" })
  })

  it("refuses anyone without owner access before reading anything", async () => {
    asMock(getSession).mockResolvedValue({ user: { ...OWNER.user, role: "VIEWER" } })
    const r = await reviewCheckPhotos({ markIds: ["m1"], verdict: "ok" })
    expect(r).toEqual({ ok: false, error: "Forbidden" })
    expect(prisma.checkMark.findMany).not.toHaveBeenCalled()
  })
})
