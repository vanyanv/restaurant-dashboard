// The password limit on the developer keys, run against the REAL limiter
// (the other test file replaces it, which is how a hole here went unseen).
// Pinned: guesses sent at the same moment cannot all reach the password
// check; the right password starts the count again; and a Redis that is set
// up but not answering means nobody unlocks.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const jar = new Map<string, string>()
const cookieSet = vi.fn((name: string, value: string, _opts?: unknown) => void jar.set(name, value))

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: cookieSet,
    delete: (name: string) => void jar.delete(name),
  })),
}))
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findFirst: vi.fn() } } }))
vi.mock("@/lib/developer/vercel-env", () => ({ listVercelEnv: vi.fn() }))
vi.mock("@/lib/cache/redis", async (original) => ({
  ...(await original<typeof import("@/lib/cache/redis")>()),
  getRedis: vi.fn(),
}))
vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn(async (given: string, hash: string) => {
      // A real check takes time; give the other guesses the chance to overtake.
      await new Promise((r) => setTimeout(r, 5))
      return hash === `hash-of:${given}`
    }),
  },
}))

import { getServerSession } from "next-auth"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { getRedis } from "@/lib/cache/redis"
import { unlockKeys } from "@/lib/counter/actions/developer"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
let n = 0

/** A different developer for every test, so one test's count never reaches the next. */
function signInFreshDeveloper(): string {
  const id = `u_limit_${Date.now()}_${n++}`
  asMock(getServerSession).mockResolvedValue({
    user: { id, role: "DEVELOPER", accountId: "acc_1", name: "Sam", email: "sam@example.com" },
  })
  return id
}

beforeEach(() => {
  vi.clearAllMocks()
  jar.clear()
  jar.set("next-auth.session-token", "session-cookie-A")
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.stubEnv("NEXTAUTH_SECRET", "test-signing-secret")
  vi.stubEnv("DEVELOPER_PORTAL_ACCOUNT_ID", "acc_1")
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "")
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "")
  asMock(getRedis).mockReturnValue(null)
  asMock(prisma.user.findFirst).mockResolvedValue({ password: "hash-of:right-password" })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("wrong passwords, against the real limiter", () => {
  it("forty guesses sent at once reach the password check five times at most", async () => {
    signInFreshDeveloper()
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => unlockKeys(`guess-${i}`)))
    expect(results.every((r) => r.ok === false)).toBe(true)
    expect(asMock(bcrypt.compare).mock.calls.length).toBeLessThanOrEqual(5)
    expect(cookieSet).not.toHaveBeenCalled()
  })

  it("the right password hidden among forty guesses at once is checked at most five times too", async () => {
    signInFreshDeveloper()
    const guesses = Array.from({ length: 40 }, (_, i) => (i === 39 ? "right-password" : `guess-${i}`))
    await Promise.all(guesses.map((g) => unlockKeys(g)))
    expect(asMock(bcrypt.compare).mock.calls.length).toBeLessThanOrEqual(5)
  })

  it("after five wrong ones, even the right password waits", async () => {
    signInFreshDeveloper()
    for (let i = 0; i < 5; i++) expect(await unlockKeys("wrong")).toEqual({ ok: false })
    asMock(bcrypt.compare).mockClear()
    expect(await unlockKeys("right-password")).toEqual({ ok: false })
    expect(bcrypt.compare).not.toHaveBeenCalled()
  })

  it("the right password starts the count again", async () => {
    signInFreshDeveloper()
    for (let i = 0; i < 4; i++) expect(await unlockKeys("wrong")).toEqual({ ok: false })
    expect((await unlockKeys("right-password")).ok).toBe(true)
    // Without the reset, the second of these would be the sixth and refused unchecked.
    for (let i = 0; i < 4; i++) expect(await unlockKeys("wrong")).toEqual({ ok: false })
    expect((await unlockKeys("right-password")).ok).toBe(true)
    expect(asMock(bcrypt.compare).mock.calls).toHaveLength(10)
  })

  it("one developer's wrong guesses do not lock another out", async () => {
    signInFreshDeveloper()
    for (let i = 0; i < 6; i++) await unlockKeys("wrong")
    signInFreshDeveloper()
    expect((await unlockKeys("right-password")).ok).toBe(true)
  })
})

describe("when Redis is set up but not answering", () => {
  beforeEach(() => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.example")
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token")
  })

  it("nobody unlocks, even with the right password, and the password is not checked", async () => {
    signInFreshDeveloper()
    const broken = {
      multi: () => {
        const tx = { set: () => tx, incr: () => tx, exec: async () => Promise.reject(new Error("Upstash did not answer")) }
        return tx
      },
      del: async () => 0,
    }
    asMock(getRedis).mockReturnValue(broken)
    expect(await unlockKeys("right-password")).toEqual({ ok: false })
    expect(bcrypt.compare).not.toHaveBeenCalled()
    expect(cookieSet).not.toHaveBeenCalled()
  })
})
