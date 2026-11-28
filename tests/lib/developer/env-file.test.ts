// A written .env.local must read back, through Next's own loader, as exactly
// the values that went in. And the unlock pass must refuse anything but a
// fresh one this server signed for this user.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { loadEnvConfig } from "@next/env"
import { buildEnvFile, quoteEnvValue } from "@/lib/developer/env-file"
import { createHmac } from "node:crypto"
import { UNLOCK_TTL_MS, issueUnlockToken, sessionFingerprint, unlockTokenIsValid } from "@/lib/developer/unlock-token"

const AWKWARD: Record<string, string> = {
  RT_PLAIN: "abc123",
  RT_URL: "postgresql://user:p%40ss@host.example.com:5432/db?sslmode=require&x=1",
  RT_SPACES: "Chris Neddy's <no-reply@example.com>",
  RT_HASH: "abc#def ghi",
  RT_DOLLAR: "pa$$word$HOME and ${PATH}",
  RT_DOUBLE: 'say "hi" there',
  RT_BOTH: `it's "quoted" both ways`,
  RT_NEWLINE: "-----BEGIN KEY-----\nline2\nline3\n-----END KEY-----",
  RT_NEWLINE_DOUBLE: 'first "a"\nsecond',
  RT_BACKSLASH_N: "literal \\n stays two characters",
  RT_EQUALS: "a=b=c==",
  RT_LEADING: "  padded  ",
  RT_BASE64: "c29tZS9iYXNlNjQrdmFsdWU=",
  RT_WINDOWS_BREAKS: "line one\r\nline two\r\n",
  RT_LONE_RETURN: "before\rafter",
}

describe("quoteEnvValue", () => {
  it("leaves a plain value bare", () => {
    expect(quoteEnvValue("abc-123_x.y/z")).toBe("abc-123_x.y/z")
    expect(quoteEnvValue("")).toBe("")
  })

  it("quotes spaces, #, quotes and line breaks", () => {
    expect(quoteEnvValue("a b")).toBe("'a b'")
    expect(quoteEnvValue("a#b")).toBe("'a#b'")
    expect(quoteEnvValue('a"b')).toBe(`'a"b'`)
    expect(quoteEnvValue("a'b")).toBe(`"a'b"`)
    expect(quoteEnvValue("a\nb")).toBe('"a\\nb"')
  })

  it("writes $ so the loader does not swap in another variable", () => {
    expect(quoteEnvValue("a$b")).toBe("a\\$b")
  })

  it("refuses a value no quoting can carry", () => {
    expect(quoteEnvValue("a'b\"c`d e")).toBeNull()
    expect(quoteEnvValue("ends in a backslash \\")).toBeNull()
  })

  it("writes a carriage return as \\r inside double quotes", () => {
    expect(quoteEnvValue("a\r\nb")).toBe('"a\\r\\nb"')
  })

  it("refuses a carriage return that double quotes cannot hold: the loader would read it back as a line break", () => {
    // A double quote inside, or a backslash-n that must stay two characters,
    // rules out the one style that can carry a carriage return.
    expect(quoteEnvValue('say "hi"\r\nthere')).toBeNull()
    expect(quoteEnvValue("literal \\n and a real\rreturn")).toBeNull()
    expect(quoteEnvValue("it's \"both\"\rkinds")).toBeNull()
    // A plain line break in the same spots is still fine.
    expect(quoteEnvValue('say "hi"\nthere')).toBe(`'say "hi"\nthere'`)
  })
})

describe("buildEnvFile", () => {
  const file = buildEnvFile({
    madeAt: new Date("2026-11-27T10:00:00.000Z"),
    groups: [
      { title: "Neon Postgres", keys: [{ name: "DATABASE_URL", value: "postgres://x" }] },
      { title: "Empty one", keys: [] },
      {
        title: "Sign-in",
        keys: [
          { name: "SPACED_KEY", value: "s p a c e" },
          { name: "NEXTAUTH_URL", value: "https://live.example.com", note: "Use http://localhost:3000 on your own computer" },
          { name: "IMPOSSIBLE", value: "a'b\"c`d e" },
        ],
      },
    ],
    byHand: ["PREDICTHQ_API_TOKEN", "APP_URL"],
  })

  it("opens by saying these are the live site's values and when it was made", () => {
    const head = file.text.split("\n").slice(0, 4)
    expect(head.every((l) => l.startsWith("#"))).toBe(true)
    expect(head.join("\n")).toMatch(/LIVE site's values/)
    expect(head.join("\n")).toContain("Made 2026-11-27T10:00:00.000Z")
  })

  it("groups keys under the connection's name and skips empty groups", () => {
    expect(file.text).toContain("\n# Neon Postgres\nDATABASE_URL=postgres://x\n")
    expect(file.text).toContain("\n# Sign-in\nSPACED_KEY='s p a c e'\n")
    expect(file.text).not.toContain("Empty one")
  })

  it("writes a key's note as a comment above it", () => {
    expect(file.text).toContain("# Use http://localhost:3000 on your own computer\nNEXTAUTH_URL=https://live.example.com\n")
  })

  it("lists GitHub-only keys at the bottom, commented out, to set by hand", () => {
    const tail = file.text.trimEnd().split("\n").slice(-3)
    expect(tail[0]).toMatch(/^# .*[Ss]et this by hand/)
    expect(tail.slice(1)).toEqual(["# PREDICTHQ_API_TOKEN=", "# APP_URL="])
  })

  it("counts what it wrote and names what it could not", () => {
    expect(file.written).toBe(3)
    expect(file.skipped).toEqual(["IMPOSSIBLE"])
    expect(file.text).not.toMatch(/^IMPOSSIBLE=/m)
  })

  it("keeps a line break in a title or note from starting a real line", () => {
    const f = buildEnvFile({
      madeAt: new Date(0),
      groups: [{ title: "Bad\nEVIL=1", keys: [{ name: "A", value: "1", note: "n\nEVIL2=1" }] }],
      byHand: [],
    })
    expect(f.text).not.toMatch(/^EVIL/m)
  })

  it("names a value with a carriage return it cannot carry as skipped", () => {
    const f = buildEnvFile({
      madeAt: new Date(0),
      groups: [{ title: "T", keys: [{ name: "RETURN_KEY", value: 'a "b"\r\nc' }, { name: "FINE", value: "1" }] }],
      byHand: [],
    })
    expect(f.skipped).toEqual(["RETURN_KEY"])
    expect(f.written).toBe(1)
    expect(f.text).not.toMatch(/^RETURN_KEY=/m)
    expect(f.text).toContain("# RETURN_KEY= could not be written here. Copy this one on its own.")
  })

  it("writes nothing at all for a name of the wrong shape", () => {
    const odd = ["lower_case", "HAS-DASH", "HAS SPACE", "A=B", "BAD\nINJECTED", "9DIGIT", "", "__proto__", "X.Y"]
    const f = buildEnvFile({
      madeAt: new Date(0),
      groups: [
        { title: "Odd", keys: odd.map((name) => ({ name, value: "odd-value", note: "odd-note" })) },
        { title: "Fine", keys: [{ name: "FINE", value: "1" }] },
      ],
      byHand: ["GOOD_BY_HAND", "bad by hand", "ALSO\nINJECTED=1"],
    })
    expect(f.written).toBe(1)
    expect(f.skipped).toEqual([])
    expect(f.text).not.toContain("odd-value")
    expect(f.text).not.toContain("odd-note")
    expect(f.text).not.toContain("# Odd")
    expect(f.text).not.toMatch(/^INJECTED/m)
    for (const line of f.text.split("\n")) {
      if (line === "" || line.startsWith("#")) continue
      expect(line).toBe("FINE=1")
    }
    expect(f.text).toContain("# GOOD_BY_HAND=")
    expect(f.text).not.toContain("bad by hand")
    expect(f.text).not.toContain("ALSO")
  })

  it("writes a withheld key as a commented line that says to make your own, never its value", () => {
    const f = buildEnvFile({
      madeAt: new Date(0),
      groups: [{ title: "Sign-in", keys: [{ name: "SOME_SIGNING_KEY", value: "must-not-appear", withheld: true, note: "a note" }, { name: "FINE", value: "1" }] }],
      byHand: [],
    })
    expect(f.text).toContain("\n# Sign-in\n# SOME_SIGNING_KEY=  (not copied on purpose: make your own with: openssl rand -base64 32)\nFINE=1\n")
    expect(f.text).not.toContain("must-not-appear")
    expect(f.written).toBe(1)
    expect(f.skipped).toEqual([])
  })

  it("withholds the signing keys even when a caller forgets to say so", () => {
    const f = buildEnvFile({
      madeAt: new Date(0),
      groups: [{ title: "Sign-in", keys: [{ name: "NEXTAUTH_SECRET", value: "live-signing-key" }, { name: "CHECKS_SECRET", value: "live-checks-key" }] }],
      byHand: [],
    })
    expect(f.text).not.toContain("live-signing-key")
    expect(f.text).not.toContain("live-checks-key")
    expect(f.text).toContain("# NEXTAUTH_SECRET=  (not copied on purpose")
    expect(f.text).toContain("# CHECKS_SECRET=  (not copied on purpose")
    expect(f.written).toBe(0)
  })
})

describe("what is written reads back the same through Next's loader", () => {
  let dir: string
  const before = { ...process.env }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "env-file-test-"))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
    for (const k of Object.keys(process.env)) if (!(k in before)) delete process.env[k]
  })

  it("for every awkward value", () => {
    const file = buildEnvFile({
      madeAt: new Date(),
      groups: [{ title: "Round trip", keys: Object.entries(AWKWARD).map(([name, value]) => ({ name, value })) }],
      byHand: ["NOT_REAL"],
    })
    expect(file.skipped).toEqual([])
    // `.env`, not `.env.local`: the loader skips `.env.local` when NODE_ENV is "test".
    fs.writeFileSync(path.join(dir, ".env"), file.text)
    const quiet = { info: () => {}, error: () => {} }
    const { parsedEnv } = loadEnvConfig(dir, true, quiet, true)
    for (const [name, value] of Object.entries(AWKWARD)) expect(parsedEnv?.[name], name).toBe(value)
    expect(parsedEnv).not.toHaveProperty("NOT_REAL")
  })
})

describe("the unlock pass", () => {
  beforeEach(() => vi.stubEnv("NEXTAUTH_SECRET", "test-signing-secret"))
  afterEach(() => vi.unstubAllEnvs())

  const NOW = 1_800_000_000_000
  const SID = "mark-of-sign-in-A"

  /** A pass with any body at all, signed exactly as the server signs. */
  const signed = (payload: unknown, label = "developer-keys-unlock") => {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
    const mac = createHmac("sha256", "test-signing-secret").update(`${label}:${body}`).digest("base64url")
    return `${body}.${mac}`
  }

  it("works for the user and the sign-in it was made for, for five minutes", () => {
    const { token, exp } = issueUnlockToken("u_dev", SID, NOW)
    expect(exp).toBe(NOW + 5 * 60_000)
    expect(UNLOCK_TTL_MS).toBe(5 * 60_000)
    expect(unlockTokenIsValid(token, "u_dev", SID, NOW + 1)).toBe(true)
    expect(unlockTokenIsValid(token, "u_dev", SID, exp - 1)).toBe(true)
  })

  it("stops working when the time is up", () => {
    const { token, exp } = issueUnlockToken("u_dev", SID, NOW)
    expect(unlockTokenIsValid(token, "u_dev", SID, exp)).toBe(false)
    expect(unlockTokenIsValid(token, "u_dev", SID, exp + 60_000)).toBe(false)
  })

  it("does not work for anyone else", () => {
    const { token } = issueUnlockToken("u_dev", SID, NOW)
    expect(unlockTokenIsValid(token, "u_other", SID, NOW)).toBe(false)
    expect(unlockTokenIsValid(token, "", SID, NOW)).toBe(false)
  })

  it("does not work under a different sign-in, or with none", () => {
    const { token } = issueUnlockToken("u_dev", SID, NOW)
    expect(unlockTokenIsValid(token, "u_dev", "mark-of-sign-in-B", NOW)).toBe(false)
    expect(unlockTokenIsValid(token, "u_dev", "", NOW)).toBe(false)
    expect(unlockTokenIsValid(token, "u_dev", null, NOW)).toBe(false)
    expect(unlockTokenIsValid(token, "u_dev", undefined, NOW)).toBe(false)
  })

  it("cannot be made without a sign-in to tie it to", () => {
    expect(() => issueUnlockToken("u_dev", "", NOW)).toThrow()
  })

  it("refuses a correctly signed pass from before passes were tied to a sign-in", () => {
    const old = signed({ uid: "u_dev", exp: NOW + 60_000 })
    expect(unlockTokenIsValid(old, "u_dev", SID, NOW)).toBe(false)
    expect(unlockTokenIsValid(old, "u_dev", "", NOW)).toBe(false)
    expect(unlockTokenIsValid(old, "u_dev", undefined, NOW)).toBe(false)
  })

  it("refuses a correctly signed pass that claims to last longer than five minutes", () => {
    // Signed properly, so only the cap on how long a pass may last can stop it.
    const inWindow = signed({ uid: "u_dev", exp: NOW + UNLOCK_TTL_MS, sid: SID })
    const tooLong = signed({ uid: "u_dev", exp: NOW + UNLOCK_TTL_MS + 1, sid: SID })
    const farFuture = signed({ uid: "u_dev", exp: NOW + 9e9, sid: SID })
    expect(unlockTokenIsValid(inWindow, "u_dev", SID, NOW)).toBe(true)
    expect(unlockTokenIsValid(tooLong, "u_dev", SID, NOW)).toBe(false)
    expect(unlockTokenIsValid(farFuture, "u_dev", SID, NOW)).toBe(false)
  })

  it("refuses a body that was changed, a signature that was changed, and junk", () => {
    const { token } = issueUnlockToken("u_dev", SID, NOW)
    const [body, mac] = token.split(".")
    const forged = Buffer.from(JSON.stringify({ uid: "u_dev", exp: NOW + 9e9, sid: SID })).toString("base64url")
    expect(unlockTokenIsValid(`${forged}.${mac}`, "u_dev", SID, NOW)).toBe(false)
    expect(unlockTokenIsValid(`${body}.${mac.slice(0, -1)}A`, "u_dev", SID, NOW)).toBe(false)
    expect(unlockTokenIsValid(`${body}.`, "u_dev", SID, NOW)).toBe(false)
    expect(unlockTokenIsValid(body, "u_dev", SID, NOW)).toBe(false)
    expect(unlockTokenIsValid(`${token}.extra`, "u_dev", SID, NOW)).toBe(false)
    expect(unlockTokenIsValid("", "u_dev", SID, NOW)).toBe(false)
    expect(unlockTokenIsValid(undefined, "u_dev", SID, NOW)).toBe(false)
  })

  it("refuses a pass signed with another secret", () => {
    const { token } = issueUnlockToken("u_dev", SID, NOW)
    vi.stubEnv("NEXTAUTH_SECRET", "a-different-secret")
    expect(unlockTokenIsValid(token, "u_dev", SID, NOW)).toBe(false)
  })

  it("is not a crew pass: the same body signed under another label is refused", () => {
    const crew = signed({ uid: "u_dev", exp: NOW + 60_000, sid: SID }, "crew-pass")
    expect(unlockTokenIsValid(crew, "u_dev", SID, NOW)).toBe(false)
  })

  it("is simply false, not an error, when the signing secret is unset", () => {
    const { token } = issueUnlockToken("u_dev", SID, NOW)
    vi.stubEnv("NEXTAUTH_SECRET", "")
    expect(unlockTokenIsValid(token, "u_dev", SID, NOW)).toBe(false)
  })
})

describe("the mark of a sign-in", () => {
  const c = (name: string, value: string) => ({ name, value })

  it("is the same for the same cookie and different for another", () => {
    const a = sessionFingerprint([c("next-auth.session-token", "cookie-A")])
    expect(a).toBe(sessionFingerprint([c("other", "x"), c("next-auth.session-token", "cookie-A")]))
    expect(a).not.toBe(sessionFingerprint([c("next-auth.session-token", "cookie-B")]))
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it("never contains the cookie itself", () => {
    expect(sessionFingerprint([c("next-auth.session-token", "cookie-A")])).not.toContain("cookie-A")
  })

  it("reads the secure name the live site uses, ahead of the plain one", () => {
    const secure = sessionFingerprint([c("__Secure-next-auth.session-token", "cookie-S")])
    expect(secure).not.toBeNull()
    expect(
      sessionFingerprint([c("next-auth.session-token", "planted"), c("__Secure-next-auth.session-token", "cookie-S")]),
    ).toBe(secure)
  })

  it("joins a cookie that was split into numbered parts, in order", () => {
    const whole = sessionFingerprint([c("next-auth.session-token", "part0part1part2")])
    const split = sessionFingerprint([
      c("next-auth.session-token.2", "part2"),
      c("next-auth.session-token.0", "part0"),
      c("next-auth.session-token.1", "part1"),
    ])
    expect(split).toBe(whole)
  })

  it("is null when there is no sign-in cookie, or an empty one", () => {
    expect(sessionFingerprint([])).toBeNull()
    expect(sessionFingerprint([c("developer_keys_unlock", "x"), c("next-auth.csrf-token", "y")])).toBeNull()
    expect(sessionFingerprint([c("next-auth.session-token", "")])).toBeNull()
    expect(sessionFingerprint([c("next-auth.session-token.evil", "x")])).toBeNull()
  })
})
