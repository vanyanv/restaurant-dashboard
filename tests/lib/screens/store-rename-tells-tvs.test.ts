import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * A menu-board TV shows its store's name, and its answer sits on the CDN.
 * Renaming a store must clear it; any other store edit must not.
 * The push module here is the real one, over a mocked Vercel and Ably, so
 * "telling the TVs cannot fail the save" is proved against what really runs.
 */

const { prisma, session, purge, waitUntil, order } = vi.hoisted(() => {
  const order: string[] = []
  return {
    order,
    session: { current: { user: { id: "u1", accountId: "acc1", role: "OWNER" } } as unknown },
    purge: vi.fn((_tag: string | string[]): Promise<void> => {
      order.push("clear")
      return Promise.resolve()
    }),
    waitUntil: vi.fn((_p: Promise<unknown>): void => {}),
    prisma: {
      store: {
        findFirst: vi.fn(),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          order.push("write")
          return { id: "s1", accountId: "acc1", ...data }
        }),
      },
    },
  }
})
vi.mock("@/lib/prisma", () => ({ prisma }))
vi.mock("@/lib/auth-scope", () => ({ getSession: async () => session.current }))
vi.mock("@/lib/auth", () => ({ hasOwnerAccess: (r: string) => r === "OWNER" }))
vi.mock("@/lib/account-stores", () => ({ getAccountStoreRows: vi.fn() }))
vi.mock("@/lib/chat/owner-scope", () => ({ invalidateOwnerStoreCache: vi.fn() }))
vi.mock("@/lib/cache/cached", () => ({ bustTags: vi.fn(async () => {}) }))
vi.mock("@/lib/cache/redis", () => ({ getRedis: () => null }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock("@vercel/functions", () => ({ dangerouslyDeleteByTag: purge, waitUntil }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { updateStore } from "@/app/actions/store/crud-actions"
import { tvTag } from "@/lib/screens/push"

const fetchMock = vi.fn()
const form = (name: string, more: Record<string, string> = {}) => {
  const f = new FormData()
  f.set("name", name)
  f.set("isActive", "true")
  for (const [k, v] of Object.entries(more)) f.set(k, v)
  return f
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  order.length = 0
  session.current = { user: { id: "u1", accountId: "acc1", role: "OWNER" } }
  prisma.store.findFirst.mockResolvedValue({ id: "s1", accountId: "acc1", name: "Hollywood" })
  purge.mockImplementation(() => {
    order.push("clear")
    return Promise.resolve()
  })
  waitUntil.mockImplementation(() => {})
  vi.stubEnv("VERCEL", "")
  vi.stubEnv("NEXTAUTH_SECRET", "s3cret")
  vi.stubEnv("ABLY_TV_PUBLISH_KEY", "app.id:pub")
  fetchMock.mockReset().mockImplementation(async () => {
    order.push("tell")
    return new Response("{}", { status: 201 })
  })
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/** Run the save and let up to `ms` pass for it. */
async function save(f: FormData, ms = 0) {
  const p = updateStore("s1", f)
  await vi.advanceTimersByTimeAsync(ms)
  return p
}

describe("updateStore and the TVs", () => {
  it("a new name: clears this account's TV answers and tells the TVs, after the write", async () => {
    const res = await save(form("Hollywood Blvd"))
    expect(res).toMatchObject({ success: true, store: { name: "Hollywood Blvd" } })
    expect(prisma.store.findFirst.mock.calls[0][0].where).toEqual({ id: "s1", accountId: "acc1" })
    expect(purge).toHaveBeenCalledTimes(1)
    expect(purge.mock.calls[0]).toEqual([tvTag("acc1")])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(order).toEqual(["write", "clear", "tell"])
    expect(waitUntil).toHaveBeenCalledTimes(1)
  })

  it("the same name, with other things changed: the TVs are left alone", async () => {
    const res = await save(form("Hollywood", { address: "1 Vine St", phone: "555-0100", fixedMonthlyRent: "9000" }))
    expect(res).toMatchObject({ success: true })
    expect(prisma.store.update).toHaveBeenCalledTimes(1)
    expect(purge).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(waitUntil).not.toHaveBeenCalled()
  })

  it.each([
    ["someone who is not an owner", () => { session.current = { user: { id: "u2", accountId: "acc1", role: "MANAGER" } } }],
    ["a store of another account", () => prisma.store.findFirst.mockResolvedValue(null)],
    ["a write that fails", () => prisma.store.update.mockRejectedValueOnce(new Error("db down"))],
  ])("nothing is said to the TVs for %s", async (_n, given) => {
    given()
    const res = await save(form("Hollywood Blvd"))
    expect(res).toHaveProperty("error")
    expect(purge).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ["the clear rejects", () => purge.mockRejectedValue(new Error("down")), 300],
    ["the clear throws", () => purge.mockImplementation(() => { throw new Error("no context") }), 300],
    ["the clear never answers", () => purge.mockImplementation(() => new Promise<void>(() => {})), 5300],
    ["Ably is unreachable", () => fetchMock.mockRejectedValue(new Error("offline")), 0],
    ["Ably refuses", () => fetchMock.mockResolvedValue(new Response("no", { status: 401 })), 0],
    ["there is nothing to hang the second clear on", () => waitUntil.mockImplementation(() => { throw new Error("no request") }), 0],
    ["on Vercel with no request context", () => vi.stubEnv("VERCEL", "1"), 0],
  ])("the rename is saved all the same when %s", async (_n, given, ms) => {
    given()
    const res = await save(form("Hollywood Blvd"), ms)
    expect(res).toMatchObject({ success: true, store: { name: "Hollywood Blvd" } })
    expect(res).not.toHaveProperty("error")
  })
})
