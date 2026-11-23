import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma, tx, session } = vi.hoisted(() => {
  const tx = {
    screen: { findMany: vi.fn() },
    screenPlaylist: { createMany: vi.fn(), deleteMany: vi.fn() },
    screenSlide: { deleteMany: vi.fn(), createMany: vi.fn() },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
  }
  return {
    tx,
    session: { current: { user: { accountId: "acc1", role: "OWNER" } } as unknown },
    prisma: {
      screen: { findFirst: vi.fn(), updateMany: vi.fn() },
      screenMedia: { findMany: vi.fn() },
      screenTime: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
      $transaction: vi.fn(async (f: unknown) => (typeof f === "function" ? (f as (t: typeof tx) => unknown)(tx) : f)),
    },
  }
})
vi.mock("@/lib/prisma", () => ({ prisma }))
vi.mock("@/lib/auth-scope", () => ({ getSession: async () => session.current }))
vi.mock("@/lib/auth", () => ({ hasOwnerAccess: (r: string) => r === "OWNER" }))
vi.mock("@/lib/blob", () => ({ deleteScreenMedia: vi.fn(), checkThumbKey: (k: string) => k }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/headers", () => ({ headers: async () => new Headers() }))

import { addTime, identifyScreens, setPictures, updateTime } from "@/lib/counter/actions/screens"

const screen = (id: string, over: object = {}) => ({
  id, name: id, storeId: "s1", playlistId: `p-${id}`, playlist: { slides: [{ mediaId: "m1" }], _count: { screens: 1, times: 0 } }, times: [], ...over,
})
const slide = { mediaId: "m1", seconds: 10 }

beforeEach(() => {
  vi.clearAllMocks()
  session.current = { user: { accountId: "acc1", role: "OWNER" } }
  prisma.screenMedia.findMany.mockResolvedValue([{ id: "m1", storeId: null }])
})

describe("setPictures", () => {
  it("reads every row inside the account and writes once for many screens", async () => {
    tx.screen.findMany.mockResolvedValue([screen("a"), screen("b")])
    const r = await setPictures([
      { screenId: "a", timeId: null, slides: [slide] },
      { screenId: "b", timeId: null, slides: [slide] },
    ])
    expect(r).toEqual({ ok: true })
    expect(tx.screen.findMany.mock.calls[0][0].where.accountId).toBe("acc1")
    expect(prisma.screenMedia.findMany.mock.calls[0][0].where.accountId).toBe("acc1")
    expect(tx.screenSlide.deleteMany).toHaveBeenCalledTimes(1)
    expect(tx.screenSlide.createMany).toHaveBeenCalledTimes(1)
    expect(tx.screenSlide.createMany.mock.calls[0][0].data).toHaveLength(2)
    expect(tx.$executeRaw).not.toHaveBeenCalled()
  })

  it("copies a list that another screen still shares, so it never changes that screen", async () => {
    tx.screen.findMany.mockResolvedValue([screen("a", { playlist: { slides: [], _count: { screens: 2, times: 0 } } })])
    expect(await setPictures([{ screenId: "a", timeId: null, slides: [slide] }])).toEqual({ ok: true })
    const made = tx.screenPlaylist.createMany.mock.calls[0][0].data[0].id
    expect(made).not.toBe("p-a")
    expect(tx.screenSlide.deleteMany.mock.calls[0][0].where.playlistId.in).toEqual([made])
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
    expect(tx.screenPlaylist.deleteMany.mock.calls[0][0].where).toMatchObject({ id: { in: ["p-a"] }, accountId: "acc1", screens: { none: {} } })
  })

  it("locks the screens before reading them", async () => {
    tx.screen.findMany.mockResolvedValue([screen("a")])
    await setPictures([{ screenId: "a", timeId: null, slides: [slide] }])
    expect(tx.$queryRaw.mock.calls[0][0].join("?")).toMatch(/FOR UPDATE/)
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.screen.findMany.mock.invocationCallOrder[0])
  })

  it("refuses when the TV changed since the owner looked, and writes nothing", async () => {
    tx.screen.findMany.mockResolvedValue([screen("a")])
    const r = await setPictures([{ screenId: "a", timeId: null, slides: [slide], was: ["other"] }])
    expect(r).toEqual({ ok: false, error: "a was changed somewhere else. Look again, then redo it." })
    expect(tx.screenSlide.deleteMany).not.toHaveBeenCalled()
    expect(await setPictures([{ screenId: "a", timeId: null, slides: [slide], was: ["m1"] }])).toEqual({ ok: true })
  })

  it.each([
    ["a screen of another account", () => tx.screen.findMany.mockResolvedValue([])],
    ["a picture of another account", () => { tx.screen.findMany.mockResolvedValue([screen("a")]); prisma.screenMedia.findMany.mockResolvedValue([]) }],
    ["a picture kept for another store", () => { tx.screen.findMany.mockResolvedValue([screen("a")]); prisma.screenMedia.findMany.mockResolvedValue([{ id: "m1", storeId: "s2" }]) }],
  ])("changes nothing for %s", async (_n, given) => {
    given()
    expect((await setPictures([{ screenId: "a", timeId: null, slides: [slide] }])).ok).toBe(false)
    expect(tx.screenSlide.deleteMany).not.toHaveBeenCalled()
    expect(tx.screenPlaylist.createMany).not.toHaveBeenCalled()
  })

  it("refuses a time that is not on that screen", async () => {
    tx.screen.findMany.mockResolvedValue([screen("a", { times: [{ id: "t1", playlistId: "pt", playlist: { slides: [] } }] })])
    expect((await setPictures([{ screenId: "a", timeId: "t9", slides: [slide] }])).ok).toBe(false)
    expect(await setPictures([{ screenId: "a", timeId: "t1", slides: [slide] }])).toEqual({ ok: true })
    expect(tx.screenSlide.deleteMany.mock.calls[0][0].where.playlistId.in).toEqual(["pt"])
  })

  it("is for owners only", async () => {
    session.current = { user: { accountId: "acc1", role: "MANAGER" } }
    expect((await setPictures([{ screenId: "a", timeId: null, slides: [] }])).ok).toBe(false)
    expect(tx.screen.findMany).not.toHaveBeenCalled()
  })
})

describe("times and names", () => {
  it("stays inside the account", async () => {
    prisma.screen.findFirst.mockResolvedValue(null)
    const w = { name: "Lunch", days: 127, start: 660, end: 900 }
    expect((await addTime({ screenId: "a", ...w })).ok).toBe(false)
    expect(prisma.screen.findFirst.mock.calls[0][0].where).toEqual({ id: "a", accountId: "acc1" })
    prisma.screenTime.updateMany.mockResolvedValue({ count: 0 })
    expect((await updateTime({ timeId: "t", ...w })).ok).toBe(false)
    expect(prisma.screenTime.updateMany.mock.calls[0][0].where).toEqual({ id: "t", screen: { accountId: "acc1" } })
    prisma.screen.updateMany.mockResolvedValue({ count: 1 })
    await identifyScreens(true)
    expect(prisma.screen.updateMany.mock.calls[0][0].where).toEqual({ accountId: "acc1" })
  })
  it("needs at least one day", async () => {
    expect(await addTime({ screenId: "a", name: "x", days: 0, start: 0, end: 0 })).toEqual({ ok: false, error: "Pick at least one day" })
  })
})
