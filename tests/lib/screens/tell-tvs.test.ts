import { beforeEach, describe, expect, it, vi } from "vitest"

/** Every save tells the account's TVs, after the write and only when it worked; and the dashboard reads On from the beat. */

const { prisma, tx, session, tvsChanged, seenFor, order } = vi.hoisted(() => {
  const order: string[] = []
  const write = (name: string, value: unknown = { id: "x" }) =>
    vi.fn(async (..._a: unknown[]) => {
      order.push(name)
      return value
    })
  const tx = {
    screen: { findMany: vi.fn(), findUnique: vi.fn(), update: write("write"), create: write("write") },
    screenPairing: { delete: write("write") },
    screenPlaylist: { createMany: vi.fn(), deleteMany: vi.fn() },
    screenSlide: { deleteMany: vi.fn(), createMany: write("write") },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
  }
  return {
    tx,
    order,
    session: { current: { user: { accountId: "acc1", role: "OWNER" } } as unknown },
    tvsChanged: vi.fn(async (_accountId: string) => {
      order.push("tell")
    }),
    seenFor: vi.fn(async (_h: string[]) => new Map<string, { at: Date; device: string | null }>()),
    prisma: {
      store: { findFirst: vi.fn() },
      screen: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: write("write", { count: 1 }), delete: vi.fn() },
      screenPairing: { findUnique: vi.fn() },
      screenPlaylist: { deleteMany: vi.fn() },
      screenMedia: { findMany: vi.fn(), findFirst: vi.fn(), delete: write("write") },
      screenTime: { findFirst: vi.fn(), updateMany: write("write", { count: 1 }), create: write("write"), delete: vi.fn() },
      $transaction: vi.fn(async (f: unknown) => {
        if (typeof f === "function") return (f as (t: typeof tx) => unknown)(tx)
        order.push("write")
        return f
      }),
    },
  }
})
vi.mock("@/lib/prisma", () => ({ prisma }))
vi.mock("@/lib/auth-scope", () => ({ getSession: async () => session.current }))
vi.mock("@/lib/auth", () => ({ hasOwnerAccess: (r: string) => r === "OWNER" }))
vi.mock("@/lib/blob", () => ({ deleteScreenMedia: vi.fn(), checkThumbKey: (k: string) => k }))
vi.mock("@/lib/rate-limit", () => ({ rateLimitKey: async () => null }))
vi.mock("@/lib/account-stores", () => ({ getAccountStores: async () => [{ id: "s1", name: "Hollywood" }] }))
vi.mock("@/lib/screens/push", async (orig) => ({ ...(await orig<typeof import("@/lib/screens/push")>()), tvsChanged, seenFor }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/headers", () => ({ headers: async () => new Headers() }))

import {
  addTime,
  claimScreen,
  deleteMedia,
  identifyScreens,
  removeScreen,
  removeTime,
  setPictures,
  updateScreen,
  updateTime,
} from "@/lib/counter/actions/screens"
import { loadScreens } from "@/lib/counter/adapters/screens"

const w = { name: "Lunch", days: 127, start: 660, end: 900 }

beforeEach(() => {
  vi.clearAllMocks()
  order.length = 0
  session.current = { user: { accountId: "acc1", role: "OWNER" } }
  prisma.store.findFirst.mockResolvedValue({ id: "s1" })
  prisma.screenPairing.findUnique.mockResolvedValue({ code: "482913", tokenHash: "h", device: null, expiresAt: new Date(Date.now() + 60_000) })
  tx.screen.findUnique.mockResolvedValue(null)
  prisma.screen.findFirst.mockResolvedValue({ id: "a", playlistId: "p", times: [], _count: { times: 0 } })
  prisma.screenMedia.findMany.mockResolvedValue([{ id: "m1", storeId: null }])
  prisma.screenMedia.findFirst.mockResolvedValue({ id: "m1", blobKey: "acc1/k.jpg" })
  prisma.screenTime.findFirst.mockResolvedValue({ id: "t1", playlistId: "pt" })
  tx.screen.findMany.mockResolvedValue([
    { id: "a", name: "a", storeId: "s1", playlistId: "p", playlist: { slides: [], _count: { screens: 1, times: 0 } }, times: [] },
  ])
})

const saves: [string, () => Promise<{ ok: boolean }>][] = [
  ["claimScreen", () => claimScreen({ code: "482 913", storeId: "s1", name: "Left" })],
  ["updateScreen", () => updateScreen({ screenId: "a", name: "Left", storeId: "s1" })],
  ["removeScreen", () => removeScreen("a")],
  ["setPictures", () => setPictures([{ screenId: "a", timeId: null, slides: [{ mediaId: "m1", seconds: 10 }] }])],
  ["addTime", () => addTime({ screenId: "a", ...w })],
  ["updateTime", () => updateTime({ timeId: "t1", ...w })],
  ["removeTime", () => removeTime("t1")],
  ["identifyScreens", () => identifyScreens(true)],
  ["deleteMedia", () => deleteMedia("m1")],
]

describe("every save tells the TVs", () => {
  it.each(saves)("%s: once, for this account, after the write", async (_n, run) => {
    expect((await run()).ok).toBe(true)
    expect(tvsChanged).toHaveBeenCalledTimes(1)
    expect(tvsChanged).toHaveBeenCalledWith("acc1")
    expect(order.at(-1)).toBe("tell")
    expect(order.indexOf("write")).toBeGreaterThanOrEqual(0)
    expect(order.lastIndexOf("write")).toBeLessThan(order.indexOf("tell"))
  })

  it.each(saves)("%s: a save that worked stays one even if telling the TVs blows up", async (_n, run) => {
    tvsChanged.mockRejectedValueOnce(new Error("boom"))
    expect((await run()).ok).toBe(true)
  })

  it.each(saves)("%s: says nothing when someone who is not an owner tries", async (_n, run) => {
    session.current = { user: { accountId: "acc1", role: "MANAGER" } }
    expect((await run()).ok).toBe(false)
    expect(tvsChanged).not.toHaveBeenCalled()
  })

  it("says nothing when nothing was saved", async () => {
    prisma.screen.updateMany.mockResolvedValueOnce({ count: 0 })
    expect((await updateScreen({ screenId: "a", name: "Left", storeId: "s1" })).ok).toBe(false)
    prisma.screenPairing.findUnique.mockResolvedValueOnce(null)
    expect((await claimScreen({ code: "482913", storeId: "s1", name: "Left" })).ok).toBe(false)
    prisma.screen.findFirst.mockResolvedValueOnce(null)
    expect((await removeScreen("a")).ok).toBe(false)
    prisma.$transaction.mockRejectedValueOnce(new Error("db down"))
    expect((await setPictures([{ screenId: "a", timeId: null, slides: [] }])).ok).toBe(false)
    expect(tvsChanged).not.toHaveBeenCalled()
  })
})

describe("loadScreens reads On from the beat", () => {
  const now = Date.now()
  beforeEach(() => prisma.screenMedia.findMany.mockResolvedValue([]))
  const db = (id: string, lastSeenAt: Date | null, device: string | null = "db tv", pairedAt = new Date(now - 30 * 86_400_000)) => ({
    id, name: id, storeId: "s1", tokenHash: `hash-${id}`, pairedAt, device, lastSeenAt, playlist: null, times: [],
  })

  it("reads when each TV was paired", async () => {
    prisma.screen.findMany.mockResolvedValue([])
    await loadScreens("acc1")
    expect(prisma.screen.findMany.mock.calls[0][0].select).toMatchObject({ tokenHash: true, pairedAt: true })
  })

  it("a TV paired again shows waiting, not On from a beat of its last pairing", async () => {
    // claimScreen clears lastSeenAt and sets pairedAt; the Redis note outlives that by a day.
    prisma.screen.findMany.mockResolvedValue([
      db("a", null, null, new Date(now - 60_000)),
      db("b", null, null, new Date(now - 60_000)),
    ])
    seenFor.mockResolvedValueOnce(
      new Map([
        ["hash-a", { at: new Date(now - 120_000), device: "last owner's tv" }],
        ["hash-b", { at: new Date(now - 10_000), device: "beat tv" }],
      ]),
    )
    const { screens } = await loadScreens("acc1")
    expect(screens.map((s) => [s.state, s.lastSeenAt, s.device])).toEqual([
      ["waiting", null, null],
      ["on", new Date(now - 10_000).toISOString(), "beat tv"],
    ])
  })

  it("asks Redis once for every screen, inside the account, and adds no query", async () => {
    prisma.screen.findMany.mockResolvedValue([db("a", null), db("b", null)])
    await loadScreens("acc1")
    expect(seenFor).toHaveBeenCalledTimes(1)
    expect(seenFor).toHaveBeenCalledWith(["hash-a", "hash-b"])
    expect(prisma.screen.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.screen.findMany.mock.calls[0][0].where).toEqual({ accountId: "acc1" })
    expect(prisma.screenMedia.findMany).toHaveBeenCalledTimes(1)
  })

  it("is exactly the database's answer when Redis has nothing", async () => {
    const seen = new Date(now - 60_000)
    prisma.screen.findMany.mockResolvedValue([db("a", seen), db("b", new Date(now - 3_600_000)), db("c", null, null)])
    const { screens } = await loadScreens("acc1")
    expect(screens.map((s) => [s.state, s.lastSeenAt, s.device])).toEqual([
      ["on", seen.toISOString(), "db tv"],
      ["off", new Date(now - 3_600_000).toISOString(), "db tv"],
      ["waiting", null, null],
    ])
  })

  it("shows a TV On from the beat when the database last heard long ago, or never", async () => {
    const beat = new Date(now - 30_000)
    prisma.screen.findMany.mockResolvedValue([db("a", new Date(now - 3_600_000)), db("b", null, null), db("c", new Date(now - 10_000))])
    seenFor.mockResolvedValueOnce(
      new Map([
        ["hash-a", { at: beat, device: "beat tv" }],
        ["hash-b", { at: beat, device: null }],
        ["hash-c", { at: new Date(now - 3_600_000), device: null }],
      ]),
    )
    const { screens } = await loadScreens("acc1")
    expect(screens.map((s) => [s.state, s.lastSeenAt, s.device])).toEqual([
      ["on", beat.toISOString(), "beat tv"],
      ["on", beat.toISOString(), null],
      ["on", new Date(now - 10_000).toISOString(), "db tv"],
    ])
  })

  it("never hands the token hash to the page", async () => {
    prisma.screen.findMany.mockResolvedValue([db("a", null)])
    const data = await loadScreens("acc1")
    expect(JSON.stringify(data)).not.toContain("hash-a")
    expect(data.screens[0]).not.toHaveProperty("tokenHash")
  })
})
