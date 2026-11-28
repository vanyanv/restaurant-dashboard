// Reading the live site's keys. Pinned: only a developer who typed their
// password in the last five minutes gets a value; only for a name on the
// list; and the server log says who read what and never the value. Only a
// developer of the one account named by DEVELOPER_PORTAL_ACCOUNT_ID, still a
// developer in the database at the moment of every read, and only with a pass
// made in this same sign-in. The signing keys themselves are never handed out.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const jar = new Map<string, string>()
const cookieSet = vi.fn((name: string, value: string, _opts?: unknown) => void jar.set(name, value))
const cookieDelete = vi.fn((name: string) => void jar.delete(name))

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: cookieSet,
    delete: cookieDelete,
  })),
}))
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findFirst: vi.fn() } } }))
vi.mock("@/lib/rate-limit", () => ({ chargeAttemptKey: vi.fn(), clearAttemptKey: vi.fn() }))
vi.mock("@/lib/developer/vercel-env", () => ({ listVercelEnv: vi.fn() }))
vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn(async (given: string, hash: string) => hash === `hash-of:${given}`) },
}))

import { getServerSession } from "next-auth"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { chargeAttemptKey, clearAttemptKey } from "@/lib/rate-limit"
import { listVercelEnv } from "@/lib/developer/vercel-env"
import { UNLOCK_COOKIE, issueUnlockToken, sessionFingerprint } from "@/lib/developer/unlock-token"
import { exportEnvFile, lockKeys, revealKey, unlockKeys } from "@/lib/counter/actions/developer"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const DEV = { user: { id: "u_dev", role: "DEVELOPER", accountId: "acc_1", name: "Sam", email: "sam@example.com" } }
const OWNER = { user: { ...DEV.user, id: "u_owner", role: "OWNER" } }

const DB_VALUE = "postgres://fake-user:fake-pass@db.example.com/main"
const SECRET_VALUE = "fake value with spaces # and a hash"

let info: ReturnType<typeof vi.spyOn>
let warn: ReturnType<typeof vi.spyOn>

/** Everything written to the server log, as one string. */
const logged = () => [...info.mock.calls, ...warn.mock.calls].map((c) => c.join(" ")).join("\n")

const SESSION_COOKIE = "next-auth.session-token"

/** The mark of the sign-in the jar currently holds. */
const signInMark = () => sessionFingerprint([...jar].map(([name, value]) => ({ name, value }))) ?? ""

function unlock(userId = "u_dev", now = Date.now()) {
  jar.set(UNLOCK_COOKIE, issueUnlockToken(userId, signInMark(), now).token)
}

beforeEach(() => {
  vi.clearAllMocks()
  jar.clear()
  jar.set(SESSION_COOKIE, "session-cookie-A")
  info = vi.spyOn(console, "info").mockImplementation(() => {})
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.stubEnv("NEXTAUTH_SECRET", "test-signing-secret")
  vi.stubEnv("DEVELOPER_PORTAL_ACCOUNT_ID", "acc_1")
  vi.stubEnv("CHECKS_SECRET", "")
  vi.stubEnv("DATABASE_URL", DB_VALUE)
  vi.stubEnv("RESEND_API_KEY", SECRET_VALUE)
  vi.stubEnv("GEMINI_API_KEY", "")
  asMock(getServerSession).mockResolvedValue(DEV)
  asMock(prisma.user.findFirst).mockResolvedValue({ password: "hash-of:right-password" })
  asMock(chargeAttemptKey).mockResolvedValue("allowed")
  asMock(clearAttemptKey).mockResolvedValue(undefined)
  asMock(listVercelEnv).mockResolvedValue({ ok: true, rows: [{ name: "GROQ_API_KEY", type: "encrypted", targets: ["production"] }] })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("unlockKeys", () => {
  it("opens for a developer with the right password, for five minutes", async () => {
    const before = Date.now()
    const r = await unlockKeys("right-password")
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const left = new Date(r.expiresAt).getTime() - before
    expect(left).toBeGreaterThan(4.9 * 60_000)
    expect(left).toBeLessThan(5.1 * 60_000)

    expect(cookieSet).toHaveBeenCalledTimes(1)
    const [name, , opts] = cookieSet.mock.calls[0]
    expect(name).toBe(UNLOCK_COOKIE)
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "strict", maxAge: 300, secure: false })
    expect((opts as { path: string }).path).toMatch(/^\//)
  })

  it("counts the try before checking it, and wipes the count once the password is right", async () => {
    const order: string[] = []
    asMock(chargeAttemptKey).mockImplementation(async () => (order.push("count"), "allowed"))
    asMock(bcrypt.compare).mockImplementationOnce(async () => (order.push("check"), true))
    asMock(clearAttemptKey).mockImplementation(async () => void order.push("wipe"))
    expect((await unlockKeys("right-password")).ok).toBe(true)
    expect(order).toEqual(["count", "check", "wipe"])
    expect(asMock(chargeAttemptKey).mock.calls[0]).toEqual(["developer-keys-unlock:u_dev", { limit: 5, windowMs: 15 * 60_000 }])
    expect(clearAttemptKey).toHaveBeenCalledWith("developer-keys-unlock:u_dev")
  })

  it("marks the cookie secure on the live site", async () => {
    vi.stubEnv("NODE_ENV", "production")
    await unlockKeys("right-password")
    expect(cookieSet.mock.calls[0][2]).toMatchObject({ secure: true, httpOnly: true, sameSite: "strict" })
  })

  it("looks the password up by the signed-in user, their account and the developer role", async () => {
    await unlockKeys("right-password")
    expect(asMock(prisma.user.findFirst).mock.calls[0][0]).toEqual({
      where: { id: "u_dev", accountId: "acc_1", role: "DEVELOPER", removedAt: null },
      select: { password: true },
    })
  })

  it("the cookie it sets then opens revealKey", async () => {
    await unlockKeys("right-password")
    expect(await revealKey("DATABASE_URL")).toEqual({ ok: true, value: DB_VALUE })
  })

  it("refuses an owner before touching the database", async () => {
    asMock(getServerSession).mockResolvedValue(OWNER)
    expect(await unlockKeys("right-password")).toEqual({ ok: false })
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
    expect(cookieSet).not.toHaveBeenCalled()
  })

  it("refuses a signed-out caller", async () => {
    asMock(getServerSession).mockResolvedValue(null)
    expect(await unlockKeys("right-password")).toEqual({ ok: false })
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
  })

  it("refuses a wrong password, counts it against that user, and sets nothing", async () => {
    expect(await unlockKeys("wrong-password")).toEqual({ ok: false })
    expect(chargeAttemptKey).toHaveBeenCalledTimes(1)
    expect(asMock(chargeAttemptKey).mock.calls[0][0]).toBe("developer-keys-unlock:u_dev")
    expect(asMock(chargeAttemptKey).mock.calls[0][1]).toEqual({ limit: 5, windowMs: 15 * 60_000 })
    expect(clearAttemptKey).not.toHaveBeenCalled()
    expect(cookieSet).not.toHaveBeenCalled()
    expect(logged()).not.toContain("wrong-password")
  })

  it("refuses even the right password once too many wrong ones were typed", async () => {
    asMock(chargeAttemptKey).mockResolvedValue("over")
    expect(await unlockKeys("right-password")).toEqual({ ok: false })
    expect(bcrypt.compare).not.toHaveBeenCalled()
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
    expect(cookieSet).not.toHaveBeenCalled()
  })

  it("refuses even the right password when the count cannot be kept", async () => {
    asMock(chargeAttemptKey).mockResolvedValue("unavailable")
    expect(await unlockKeys("right-password")).toEqual({ ok: false })
    expect(bcrypt.compare).not.toHaveBeenCalled()
    expect(cookieSet).not.toHaveBeenCalled()
  })

  it("refuses another account's developer before counting or touching the database", async () => {
    asMock(getServerSession).mockResolvedValue({ user: { ...DEV.user, accountId: "acc_2" } })
    expect(await unlockKeys("right-password")).toEqual({ ok: false })
    expect(chargeAttemptKey).not.toHaveBeenCalled()
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
    expect(cookieSet).not.toHaveBeenCalled()
  })

  it("refuses everyone while DEVELOPER_PORTAL_ACCOUNT_ID is not set", async () => {
    for (const unset of ["", "   "]) {
      vi.stubEnv("DEVELOPER_PORTAL_ACCOUNT_ID", unset)
      expect(await unlockKeys("right-password")).toEqual({ ok: false })
    }
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
    expect(cookieSet).not.toHaveBeenCalled()
  })

  it("refuses when there is no sign-in cookie to tie the pass to", async () => {
    jar.delete(SESSION_COOKIE)
    expect(await unlockKeys("right-password")).toEqual({ ok: false })
    expect(cookieSet).not.toHaveBeenCalled()
  })

  it("ties the pass to the sign-in: it stops working under another sign-in cookie", async () => {
    await unlockKeys("right-password")
    expect(await revealKey("DATABASE_URL")).toEqual({ ok: true, value: DB_VALUE })
    jar.set(SESSION_COOKIE, "session-cookie-B")
    expect(await revealKey("DATABASE_URL")).toEqual({ ok: false, code: "locked" })
    expect(await exportEnvFile()).toEqual({ ok: false, code: "locked" })
  })

  it("reads the live site's sign-in cookie under its secure name", async () => {
    jar.delete(SESSION_COOKIE)
    jar.set("__Secure-next-auth.session-token", "session-cookie-S")
    await unlockKeys("right-password")
    expect(await revealKey("DATABASE_URL")).toEqual({ ok: true, value: DB_VALUE })
    jar.delete("__Secure-next-auth.session-token")
    expect(await revealKey("DATABASE_URL")).toEqual({ ok: false, code: "locked" })
  })

  it("refuses, and counts it, when the user row is gone or no longer a developer", async () => {
    asMock(prisma.user.findFirst).mockResolvedValue(null)
    expect(await unlockKeys("right-password")).toEqual({ ok: false })
    expect(chargeAttemptKey).toHaveBeenCalledTimes(1)
    expect(clearAttemptKey).not.toHaveBeenCalled()
  })

  it("refuses an empty, huge or non-text password without checking it", async () => {
    for (const bad of ["", "x".repeat(201), undefined, null, 42, { length: 5 }]) {
      expect(await unlockKeys(bad as never)).toEqual({ ok: false })
    }
    expect(bcrypt.compare).not.toHaveBeenCalled()
  })

  it("says the same thing whatever went wrong, even a database error", async () => {
    asMock(prisma.user.findFirst).mockRejectedValue(new Error("Can't reach database server"))
    expect(await unlockKeys("right-password")).toEqual({ ok: false })
    expect(cookieSet).not.toHaveBeenCalled()
  })
})

describe("revealKey", () => {
  it("returns the value to a developer who has unlocked", async () => {
    unlock()
    expect(await revealKey("DATABASE_URL")).toEqual({ ok: true, value: DB_VALUE })
  })

  it("refuses an owner, even holding a pass", async () => {
    asMock(getServerSession).mockResolvedValue(OWNER)
    unlock("u_owner")
    expect(await revealKey("DATABASE_URL")).toEqual({ ok: false, code: "forbidden" })
  })

  it("refuses a signed-out caller", async () => {
    asMock(getServerSession).mockResolvedValue(null)
    unlock()
    expect(await revealKey("DATABASE_URL")).toEqual({ ok: false, code: "forbidden" })
  })

  it("is locked without the cookie", async () => {
    expect(await revealKey("DATABASE_URL")).toEqual({ ok: false, code: "locked" })
  })

  it("refuses another account's developer, even holding a pass", async () => {
    asMock(getServerSession).mockResolvedValue({ user: { ...DEV.user, accountId: "acc_2" } })
    unlock()
    expect(await revealKey("DATABASE_URL")).toEqual({ ok: false, code: "forbidden" })
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
  })

  it("refuses everyone while DEVELOPER_PORTAL_ACCOUNT_ID is not set", async () => {
    vi.stubEnv("DEVELOPER_PORTAL_ACCOUNT_ID", "")
    unlock()
    expect(await revealKey("DATABASE_URL")).toEqual({ ok: false, code: "forbidden" })
  })

  it("asks the database again who this is, selecting only the id", async () => {
    unlock()
    await revealKey("DATABASE_URL")
    expect(prisma.user.findFirst).toHaveBeenCalledTimes(1)
    expect(asMock(prisma.user.findFirst).mock.calls[0][0]).toEqual({
      where: { id: "u_dev", accountId: "acc_1", role: "DEVELOPER", removedAt: null },
      select: { id: true },
    })
  })

  it("refuses someone removed or no longer a developer since their session began", async () => {
    unlock()
    asMock(prisma.user.findFirst).mockResolvedValue(null)
    expect(await revealKey("DATABASE_URL")).toEqual({ ok: false, code: "forbidden" })
    expect(info).not.toHaveBeenCalled()
  })

  it("refuses when the database cannot say who this is", async () => {
    unlock()
    asMock(prisma.user.findFirst).mockRejectedValue(new Error("Can't reach database server"))
    expect(await revealKey("DATABASE_URL")).toEqual({ ok: false, code: "forbidden" })
  })

  it("does not ask the database for someone who has not unlocked", async () => {
    await revealKey("DATABASE_URL")
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
  })

  it("never hands out the keys that sign sessions and passes", async () => {
    unlock()
    vi.stubEnv("CHECKS_SECRET", "fake-checks-secret")
    expect(await revealKey("NEXTAUTH_SECRET")).toEqual({ ok: false, code: "withheld" })
    expect(await revealKey("CHECKS_SECRET")).toEqual({ ok: false, code: "withheld" })
    expect(info).not.toHaveBeenCalled()
  })

  it("is locked once the five minutes are up", async () => {
    unlock("u_dev", Date.now() - 5 * 60_000 - 1)
    expect(await revealKey("DATABASE_URL")).toEqual({ ok: false, code: "locked" })
  })

  it("is locked for a cookie that was tampered with", async () => {
    const { token } = issueUnlockToken("u_dev", signInMark())
    const [body, mac] = token.split(".")
    const longer = Buffer.from(JSON.stringify({ uid: "u_dev", exp: Date.now() + 60_000, sid: signInMark() })).toString("base64url")
    for (const bad of [`${longer}.${mac}`, `${body}.${"A".repeat(mac.length)}`, body, "junk", `${body}.`]) {
      jar.set(UNLOCK_COOKIE, bad)
      expect(await revealKey("DATABASE_URL"), bad).toEqual({ ok: false, code: "locked" })
    }
  })

  it("is locked for another developer's pass", async () => {
    unlock("u_someone_else")
    expect(await revealKey("DATABASE_URL")).toEqual({ ok: false, code: "locked" })
  })

  it("is locked for a pass signed before the signing secret changed", async () => {
    unlock()
    vi.stubEnv("NEXTAUTH_SECRET", "rotated-secret")
    expect(await revealKey("DATABASE_URL")).toEqual({ ok: false, code: "locked" })
  })

  it("refuses a name that is not on the list and that Vercel does not hold", async () => {
    unlock()
    vi.stubEnv("SOME_OTHER_THING", "should never come back")
    expect(await revealKey("SOME_OTHER_THING")).toEqual({ ok: false, code: "unknown" })
  })

  it("refuses a name off the list when Vercel cannot be asked", async () => {
    unlock()
    vi.stubEnv("GROQ_API_KEY", "fake-groq")
    asMock(listVercelEnv).mockResolvedValue({ ok: false, reason: "couldn't reach Vercel" })
    expect(await revealKey("GROQ_API_KEY")).toEqual({ ok: false, code: "unknown" })
  })

  it("allows a name off the list that Vercel holds", async () => {
    unlock()
    vi.stubEnv("GROQ_API_KEY", "fake-groq")
    expect(await revealKey("GROQ_API_KEY")).toEqual({ ok: true, value: "fake-groq" })
  })

  it("does not ask Vercel for a name already on the list", async () => {
    unlock()
    await revealKey("DATABASE_URL")
    expect(listVercelEnv).not.toHaveBeenCalled()
  })

  it("refuses names the platform sets, even if Vercel lists them", async () => {
    unlock()
    asMock(listVercelEnv).mockResolvedValue({
      ok: true,
      rows: ["NODE_ENV", "PATH", "VERCEL_OIDC_TOKEN", "GITHUB_TOKEN"].map((name) => ({ name, type: "plain", targets: [] })),
    })
    vi.stubEnv("VERCEL_OIDC_TOKEN", "fake-oidc")
    for (const name of ["NODE_ENV", "PATH", "VERCEL_OIDC_TOKEN", "GITHUB_TOKEN", "HOME"]) {
      expect(await revealKey(name), name).toEqual({ ok: false, code: "unknown" })
    }
  })

  it("refuses lowercase and odd names, and anything that is not text", async () => {
    unlock()
    const odd = ["database_url", "Database_Url", " DATABASE_URL", "DATABASE_URL ", "DATABASE-URL", "1DATABASE", "_X", "", "__proto__", "constructor", "toString", "DATABASE_URL\n", "A.B"]
    for (const name of [...odd, undefined, null, 7, ["DATABASE_URL"], { toString: () => "DATABASE_URL" }]) {
      expect(await revealKey(name as never), String(name)).toEqual({ ok: false, code: "unknown" })
    }
  })

  it("says a known name is not set, without a value", async () => {
    unlock()
    expect(await revealKey("GEMINI_API_KEY")).toEqual({ ok: false, code: "notSet" })
  })

  it("writes one log line naming who and which key, and never the value", async () => {
    unlock()
    await revealKey("DATABASE_URL")
    expect(info).toHaveBeenCalledTimes(1)
    const line = JSON.parse(info.mock.calls[0][0] as string)
    expect(Object.keys(line).sort()).toEqual(["at", "event", "key", "userId"])
    expect(line).toMatchObject({ event: "developer.keys.revealed", userId: "u_dev", key: "DATABASE_URL" })
    expect(new Date(line.at).toISOString()).toBe(line.at)
    expect(logged()).not.toContain(DB_VALUE)
    expect(logged()).not.toContain("fake-pass")
  })

  it("writes nothing when it refuses", async () => {
    await revealKey("DATABASE_URL")
    unlock()
    await revealKey("NOPE")
    await revealKey("GEMINI_API_KEY")
    expect(info).not.toHaveBeenCalled()
  })
})

describe("exportEnvFile", () => {
  it("refuses an owner, a signed-out caller and a developer who has not unlocked", async () => {
    expect(await exportEnvFile()).toEqual({ ok: false, code: "locked" })
    asMock(getServerSession).mockResolvedValue(OWNER)
    unlock("u_owner")
    expect(await exportEnvFile()).toEqual({ ok: false, code: "forbidden" })
    asMock(getServerSession).mockResolvedValue(null)
    expect(await exportEnvFile()).toEqual({ ok: false, code: "forbidden" })
    expect(info).not.toHaveBeenCalled()
  })

  it("refuses another account's developer, and everyone while the setting is missing", async () => {
    asMock(getServerSession).mockResolvedValue({ user: { ...DEV.user, accountId: "acc_2" } })
    unlock()
    expect(await exportEnvFile()).toEqual({ ok: false, code: "forbidden" })
    asMock(getServerSession).mockResolvedValue(DEV)
    vi.stubEnv("DEVELOPER_PORTAL_ACCOUNT_ID", "")
    expect(await exportEnvFile()).toEqual({ ok: false, code: "forbidden" })
    expect(info).not.toHaveBeenCalled()
  })

  it("asks the database again who this is, and refuses someone no longer a developer", async () => {
    unlock()
    asMock(prisma.user.findFirst).mockResolvedValue(null)
    expect(await exportEnvFile()).toEqual({ ok: false, code: "forbidden" })
    expect(asMock(prisma.user.findFirst).mock.calls[0][0]).toEqual({
      where: { id: "u_dev", accountId: "acc_1", role: "DEVELOPER", removedAt: null },
      select: { id: true },
    })
    asMock(prisma.user.findFirst).mockRejectedValue(new Error("Can't reach database server"))
    expect(await exportEnvFile()).toEqual({ ok: false, code: "forbidden" })
    expect(info).not.toHaveBeenCalled()
  })

  it("never copies the keys that sign sessions and passes: a commented line says to make your own", async () => {
    unlock()
    vi.stubEnv("CHECKS_SECRET", "fake-checks-secret")
    const r = await exportEnvFile()
    if (!r.ok) throw new Error("refused")
    expect(r.text).not.toContain("test-signing-secret")
    expect(r.text).not.toContain("fake-checks-secret")
    expect(r.text).not.toMatch(/^NEXTAUTH_SECRET=/m)
    expect(r.text).not.toMatch(/^CHECKS_SECRET=/m)
    expect(r.text).toContain("\n# NEXTAUTH_SECRET=  (not copied on purpose: make your own with: openssl rand -base64 32)\n")
    expect(r.text).toContain("\n# CHECKS_SECRET=  (not copied on purpose: make your own with: openssl rand -base64 32)\n")
    expect(r.count).toBe((r.text.match(/^[A-Z][A-Z0-9_]*=/gm) ?? []).length)
    expect(r.skipped).toEqual([])
  })

  it("leaves a signing key out altogether when this server does not have it", async () => {
    unlock()
    const r = await exportEnvFile()
    if (!r.ok) throw new Error("refused")
    expect(r.text).toContain("# NEXTAUTH_SECRET=")
    expect(r.text).not.toContain("CHECKS_SECRET")
  })

  it("drops an odd-shaped name from Vercel's list, value and all", async () => {
    unlock()
    const odd = ["lower_case", "HAS-DASH", "BAD\nINJECTED", "HAS SPACE", "9STARTS_WITH_DIGIT"]
    for (const name of odd) vi.stubEnv(name, "odd-value-should-not-appear")
    asMock(listVercelEnv).mockResolvedValue({
      ok: true,
      rows: odd.map((name) => ({ name, type: "plain", targets: ["production"] })),
    })
    const r = await exportEnvFile()
    if (!r.ok) throw new Error("refused")
    expect(r.text).not.toContain("odd-value-should-not-appear")
    expect(r.text).not.toMatch(/^INJECTED=/m)
    for (const name of odd) expect(r.text).not.toContain(name.split("\n")[0])
    expect(r.skipped).toEqual([])
  })

  it("writes the set keys under their connection, quoted where needed", async () => {
    unlock()
    vi.stubEnv("NEXTAUTH_URL", "https://live.example.com")
    const r = await exportEnvFile()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.filename).toBe(".env.local")
    expect(r.text).toContain(`\n# Neon Postgres\nDATABASE_URL=${DB_VALUE}\n`)
    expect(r.text).toContain(`\n# Resend\nRESEND_API_KEY='${SECRET_VALUE}'\n`)
    expect(r.text).toContain("# Use http://localhost:3000 on your own computer\nNEXTAUTH_URL=https://live.example.com\n")
    expect(r.text).toMatch(/^# \.env\.local\n# These are the LIVE site's values/)
    expect(r.text).toMatch(/# Made \d{4}-\d\d-\d\dT[\d:.]+Z\n/)
    expect(r.skipped).toEqual([])
  })

  it("leaves out what is not set, and connections with nothing set", async () => {
    unlock()
    const r = await exportEnvFile()
    if (!r.ok) throw new Error("refused")
    expect(r.text).not.toMatch(/^GEMINI_API_KEY=/m)
    expect(r.text).not.toContain("# Google Gemini")
    expect(r.count).toBe((r.text.match(/^[A-Z][A-Z0-9_]*=/gm) ?? []).length)
  })

  it("ends with the GitHub-only keys, commented out, to set by hand", async () => {
    unlock()
    const r = await exportEnvFile()
    if (!r.ok) throw new Error("refused")
    const foot = r.text.slice(r.text.indexOf("# Only the timed jobs on GitHub"))
    expect(foot).toMatch(/[Ss]et this by hand/)
    expect(foot).toContain("\n# PREDICTHQ_API_TOKEN=\n")
    expect(foot).toContain("\n# APP_URL=\n")
    expect(r.text.trimEnd().endsWith("=")).toBe(true)
  })

  it("adds what Vercel holds and the code does not read, never a platform name", async () => {
    unlock()
    vi.stubEnv("GROQ_API_KEY", "fake-groq")
    vi.stubEnv("VERCEL_OIDC_TOKEN", "fake-oidc")
    asMock(listVercelEnv).mockResolvedValue({
      ok: true,
      rows: ["GROQ_API_KEY", "VERCEL_OIDC_TOKEN", "DATABASE_URL"].map((name) => ({ name, type: "encrypted", targets: ["production"] })),
    })
    const r = await exportEnvFile()
    if (!r.ok) throw new Error("refused")
    expect(r.text).toContain("\n# Held by Vercel, not read by the code\nGROQ_API_KEY=fake-groq\n")
    expect(r.text).not.toContain("fake-oidc")
    expect(r.text.match(/^DATABASE_URL=/gm)).toHaveLength(1)
  })

  it("still exports the list's keys when Vercel cannot be asked", async () => {
    unlock()
    asMock(listVercelEnv).mockResolvedValue({ ok: false, reason: "not set up" })
    const r = await exportEnvFile()
    expect(r.ok && r.text).toContain(`DATABASE_URL=${DB_VALUE}`)
  })

  it("writes one log line saying ALL, and never a value", async () => {
    unlock()
    await exportEnvFile()
    expect(info).toHaveBeenCalledTimes(1)
    const line = JSON.parse(info.mock.calls[0][0] as string)
    expect(line).toMatchObject({ event: "developer.keys.exported", userId: "u_dev", key: "ALL" })
    expect(logged()).not.toContain(DB_VALUE)
    expect(logged()).not.toContain(SECRET_VALUE)
  })
})

describe("lockKeys", () => {
  it("clears the cookie, after which nothing is revealed", async () => {
    unlock()
    expect(await lockKeys()).toEqual({ ok: true })
    expect(cookieDelete).toHaveBeenCalledWith(UNLOCK_COOKIE)
    expect(await revealKey("DATABASE_URL")).toEqual({ ok: false, code: "locked" })
  })
})
