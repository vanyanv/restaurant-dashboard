// Developer portal adapter. Pinned: it says whether a name is set and never
// what it is set to; a connection is ready only when the server holds every
// key it needs; and Vercel being unreachable still leaves a full list of keys.
// Showing values is on only for the one account DEVELOPER_PORTAL_ACCOUNT_ID
// names, and the keys that sign sessions and passes are never offered.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/developer/vercel-env", () => ({ listVercelEnv: vi.fn() }))
vi.mock("@/lib/monitoring/server-error-hook", () => ({ reportServerError: vi.fn() }))

import { listVercelEnv } from "@/lib/developer/vercel-env"
import { awaitSections } from "@/lib/counter/adapters/types"
import { dataOf } from "@/lib/counter/section-data"
import { CONNECTIONS, NEVER_SHOWN_KEY_NAMES, allKeyNames, allKeys } from "@/lib/counter/connections"
import { DEVELOPER_RETRY, getDeveloperSectionPromises, type DeveloperKeyRow } from "@/lib/counter/adapters/developer"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

/** A value no key name contains, different for every name. */
const sentinel = (i: number) => `s3ntinel-${i}-zq`
const SENTINEL = /s3ntinel/

const EXTRA_ON_VERCEL = ["GROQ_API_KEY", "BLOB_READ_WRITE_TOKEN"]
const PLATFORM_ON_VERCEL = ["VERCEL_OIDC_TOKEN", "NODE_ENV"]
const PIN = "DEVELOPER_PORTAL_ACCOUNT_ID"
const ME = { accountId: "acc_1" }

/** Every name the list knows is unset, so a test starts from nothing. */
function clearAll() {
  for (const name of [...allKeyNames(), ...EXTRA_ON_VERCEL]) vi.stubEnv(name, "")
}

function setAll() {
  ;[...allKeyNames(), ...EXTRA_ON_VERCEL, ...PLATFORM_ON_VERCEL].forEach((name, i) => {
    if (name !== "NODE_ENV" && name !== PIN) vi.stubEnv(name, sentinel(i))
  })
}

const vercelOk = () =>
  asMock(listVercelEnv).mockResolvedValue({
    ok: true,
    rows: [
      { name: "DATABASE_URL", type: "sensitive", targets: ["production", "preview"] },
      { name: "NEXTAUTH_URL", type: "plain", targets: ["production"] },
      { name: "GROQ_API_KEY", type: "encrypted", targets: ["production", "preview", "development"] },
      { name: "BLOB_READ_WRITE_TOKEN", type: "encrypted", targets: ["production"] },
      { name: "VERCEL_OIDC_TOKEN", type: "plain", targets: ["development"] },
      { name: "lowercase_name", type: "plain", targets: ["production"] },
    ],
  })

async function load(who = ME) {
  const s = await awaitSections(getDeveloperSectionPromises(who))
  const need = <T,>(v: T | null): T => {
    if (v === null) throw new Error("section did not load")
    return v
  }
  return {
    raw: s,
    summary: need(dataOf(s.summary)),
    map: need(dataOf(s.map)),
    stack: need(dataOf(s.stack)),
    keys: need(dataOf(s.keys)),
    setup: need(dataOf(s.setup)),
  }
}

const row = (rows: DeveloperKeyRow[], name: string) => {
  const r = rows.find((x) => x.name === name)
  if (!r) throw new Error(`no row for ${name}`)
  return r
}

beforeEach(() => {
  vi.clearAllMocks()
  clearAll()
  vi.stubEnv(PIN, "acc_1")
  vercelOk()
})
afterEach(() => vi.unstubAllEnvs())

describe("the shape", () => {
  it("hands back five promises without awaiting anything", () => {
    const p = getDeveloperSectionPromises(ME)
    expect(Object.keys(p).sort()).toEqual(["keys", "map", "setup", "stack", "summary"])
    for (const v of Object.values(p)) expect(typeof v.then).toBe("function")
  })

  it("asks Vercel once, and only for the keys", async () => {
    await load()
    expect(listVercelEnv).toHaveBeenCalledTimes(1)
  })

  it("every section is ready", async () => {
    const { raw } = await load()
    for (const [k, v] of Object.entries(raw)) expect(v.status, k).toBe("ready")
  })
})

describe("no value ever reaches a section", () => {
  it("with every name set to a recognisable value, none appears anywhere", async () => {
    setAll()
    const { raw, keys } = await load()
    // Proof the values were really there to leak.
    expect(process.env.DATABASE_URL).toMatch(SENTINEL)
    expect(keys.counts.ok).toBeGreaterThan(50)
    expect(JSON.stringify(raw)).not.toMatch(SENTINEL)
  })

  it("a key row has only the agreed fields: no value, start, length or hash", async () => {
    setAll()
    const { keys } = await load()
    const allowed = new Set(["name", "connectionName", "icon", "secret", "setHere", "vercel", "github", "state", "canReveal", "localNote", "neverShown"])
    for (const r of keys.rows) {
      for (const field of Object.keys(r)) expect(allowed, `${r.name}.${field}`).toContain(field)
      if (r.vercel) expect(Object.keys(r.vercel).sort()).toEqual(["targets", "type"])
    }
  })

  it("two servers with different values for the same names produce identical sections", async () => {
    setAll()
    const a = JSON.stringify((await load()).raw)
    ;[...allKeyNames(), ...EXTRA_ON_VERCEL].forEach((name, i) => {
      if (name !== PIN) vi.stubEnv(name, `other-${i * 7}-and-much-longer-than-before`)
    })
    const b = JSON.stringify((await load()).raw)
    expect(b).toBe(a)
  })
})

describe("map", () => {
  it("draws only connections marked for the map, grouped in order", async () => {
    const { map } = await load()
    expect(map.groups.map((g) => g.label)).toEqual(["Data", "Outside data", "Mail", "AI", "Hosting and jobs", "Our other apps"])
    const drawn = map.groups.flatMap((g) => g.connections.map((c) => c.name))
    expect(drawn).toEqual(CONNECTIONS.filter((c) => c.onMap).map((c) => c.name))
    expect(drawn).toContain("Pusher")
    expect(drawn).not.toContain("Sign-in")
  })

  it("is missing, naming the keys, when the server lacks one it needs", async () => {
    vi.stubEnv("OTTER_EMAIL", "x")
    const otter = (await load()).map.groups.flatMap((g) => g.connections).find((c) => c.id === "otter")
    expect(otter).toMatchObject({ status: "missing", missingKeys: ["OTTER_PASSWORD"], does: "orders in", flow: "in", icon: "orders" })
  })

  it("is ready once every needed key is set, without the optional ones", async () => {
    vi.stubEnv("OTTER_EMAIL", "x")
    vi.stubEnv("OTTER_PASSWORD", "x")
    const otter = (await load()).map.groups.flatMap((g) => g.connections).find((c) => c.id === "otter")
    expect(otter).toMatchObject({ status: "ready", missingKeys: [] })
  })

  it("treats a blank value as not set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "   ")
    const gemini = (await load()).map.groups.flatMap((g) => g.connections).find((c) => c.id === "gemini")
    expect(gemini?.status).toBe("missing")
  })

  it("is elsewhere when only GitHub holds the key", async () => {
    setAll()
    vi.stubEnv("PREDICTHQ_API_TOKEN", "")
    const phq = (await load()).map.groups.flatMap((g) => g.connections).find((c) => c.id === "predicthq")
    expect(phq).toMatchObject({ status: "elsewhere", missingKeys: [] })
  })

  it("accepts a second name for the same key", async () => {
    vi.stubEnv("RESEND_API_KEY", "x")
    vi.stubEnv("EMAIL_FROM", "x")
    const resend = (await load()).map.groups.flatMap((g) => g.connections).find((c) => c.id === "resend")
    expect(resend?.status).toBe("ready")
  })
})

describe("summary", () => {
  it("counts the map and names what is missing a key", async () => {
    setAll()
    vi.stubEnv("GEMINI_API_KEY", "")
    vi.stubEnv("PUSHER_SECRET", "")
    const { summary, map } = await load()
    const onMap = map.groups.flatMap((g) => g.connections).length
    expect(summary.onMap).toBe(onMap)
    expect(summary.missing).toEqual(["Google Gemini", "Pusher"])
    expect(summary.elsewhere).toBe(1)
    expect(summary.ready).toBe(onMap - 3)
  })

  it("names every server-backed connection when nothing is set", async () => {
    const { summary } = await load()
    expect(summary.ready).toBe(0)
    expect(summary.missing.length).toBe(summary.onMap - summary.elsewhere)
  })
})

describe("keys", () => {
  it("has one row per name: the whole list, then what only Vercel knows", async () => {
    const { keys } = await load()
    const names = keys.rows.map((r) => r.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.slice(0, allKeyNames().length)).toEqual(allKeyNames())
    expect(names.slice(allKeyNames().length)).toEqual(["GROQ_API_KEY", "BLOB_READ_WRITE_TOKEN"])
  })

  it("never lists a name the platform sets or one of the wrong shape", async () => {
    setAll()
    const names = (await load()).keys.rows.map((r) => r.name)
    for (const n of [...PLATFORM_ON_VERCEL, "lowercase_name"]) expect(names).not.toContain(n)
  })

  it("marks a set key ok and revealable, with what Vercel holds", async () => {
    vi.stubEnv("DATABASE_URL", "x")
    expect(row((await load()).keys.rows, "DATABASE_URL")).toEqual({
      name: "DATABASE_URL",
      connectionName: "Neon Postgres",
      icon: "database",
      secret: true,
      setHere: true,
      vercel: { type: "sensitive", targets: ["production", "preview"] },
      github: true,
      state: "ok",
      canReveal: true,
    })
  })

  it("marks a needed key that is not set as missing, and not revealable", async () => {
    expect(row((await load()).keys.rows, "NEXTAUTH_SECRET")).toMatchObject({ state: "missing", setHere: false, canReveal: false, vercel: null })
  })

  it("marks what Vercel holds and the code never reads as unused", async () => {
    vi.stubEnv("GROQ_API_KEY", "x")
    const { rows } = (await load()).keys
    expect(row(rows, "GROQ_API_KEY")).toEqual({
      name: "GROQ_API_KEY",
      connectionName: null,
      icon: "key",
      secret: true,
      setHere: true,
      vercel: { type: "encrypted", targets: ["production", "preview", "development"] },
      github: false,
      state: "unused",
      canReveal: true,
    })
    expect(row(rows, "BLOB_READ_WRITE_TOKEN")).toMatchObject({ state: "unused", setHere: false, canReveal: false })
  })

  it("marks a key only GitHub holds as githubOnly", async () => {
    expect(row((await load()).keys.rows, "PREDICTHQ_API_TOKEN")).toMatchObject({ state: "githubOnly", github: true, canReveal: false })
  })

  it("marks an unset switch, tool or covered second name as not needed here", async () => {
    vi.stubEnv("EMAIL_FROM", "x")
    const { rows } = (await load()).keys
    for (const n of ["SERVICE_SHUTDOWN_AT", "E2E_USER_PASSWORD", "CHAT_ROUTING_MODEL", "CHECKS_EMAIL_FROM"]) {
      expect(row(rows, n).state, n).toBe("notNeededHere")
    }
  })

  it("carries the note for a new computer", async () => {
    expect(row((await load()).keys.rows, "NEXTAUTH_URL").localNote).toMatch(/localhost:3000/)
  })

  it("counts every row once, by state", async () => {
    setAll()
    vi.stubEnv("GEMINI_API_KEY", "")
    const { keys } = await load()
    expect(Object.values(keys.counts).reduce((a, b) => a + b, 0)).toBe(keys.rows.length)
    expect(keys.counts.missing).toBe(1)
    expect(keys.counts.unused).toBe(2)
    expect(keys.vercelStatus).toEqual({ ok: true })
  })
})

describe("who may be shown values", () => {
  it("is on for the account the setting names", async () => {
    vi.stubEnv("DATABASE_URL", "x")
    const { keys } = await load()
    expect(keys.valuesAvailable).toBe(true)
    expect(keys).not.toHaveProperty("valuesOffReason")
    expect(row(keys.rows, "DATABASE_URL").canReveal).toBe(true)
  })

  it("is off, saying it is not set up, while the setting is missing", async () => {
    for (const unset of ["", "  "]) {
      vi.stubEnv(PIN, unset)
      vi.stubEnv("DATABASE_URL", "x")
      const { keys } = await load()
      expect(keys.valuesAvailable).toBe(false)
      expect(keys.valuesOffReason).toBe("notSetUp")
      expect(keys.rows.some((r) => r.canReveal)).toBe(false)
      // Everything else about the row is still told.
      expect(row(keys.rows, "DATABASE_URL")).toMatchObject({ state: "ok", setHere: true, canReveal: false })
    }
  })

  it("is off for a developer of any other account", async () => {
    vi.stubEnv("DATABASE_URL", "x")
    const { keys } = await load({ accountId: "acc_2" })
    expect(keys.valuesAvailable).toBe(false)
    expect(keys.valuesOffReason).toBe("otherAccount")
    expect(keys.rows.some((r) => r.canReveal)).toBe(false)
  })

  it("never puts the setting's own value, or the caller's account, in a section", async () => {
    vi.stubEnv(PIN, "acc_s3ntinel_pin")
    const { raw } = await load({ accountId: "acc_s3ntinel_pin" })
    expect(JSON.stringify(raw)).not.toMatch(SENTINEL)
  })
})

describe("the keys that sign sessions and passes", () => {
  it("are listed as set, and never offered for showing", async () => {
    setAll()
    const { keys } = await load()
    expect(keys.valuesAvailable).toBe(true)
    for (const name of NEVER_SHOWN_KEY_NAMES) {
      expect(row(keys.rows, name), name).toMatchObject({ setHere: true, state: "ok", canReveal: false, neverShown: true })
    }
  })

  it("carry the mark even when not set, and no other row carries it", async () => {
    const { keys } = await load()
    expect(row(keys.rows, "NEXTAUTH_SECRET")).toMatchObject({ state: "missing", canReveal: false, neverShown: true })
    const marked = keys.rows.filter((r) => r.neverShown).map((r) => r.name)
    expect(marked.sort()).toEqual([...NEVER_SHOWN_KEY_NAMES].sort())
    expect(row(keys.rows, "DATABASE_URL")).not.toHaveProperty("neverShown")
  })
})

describe("when Vercel cannot be asked", () => {
  it.each(["not set up", "couldn't reach Vercel"] as const)("%s: the list is still whole, and says why", async (reason) => {
    asMock(listVercelEnv).mockResolvedValue({ ok: false, reason })
    vi.stubEnv("DATABASE_URL", "x")
    const { raw, keys } = await load()
    expect(raw.keys.status).toBe("ready")
    expect(keys.vercelStatus).toEqual({ ok: false, reason })
    expect(keys.rows.map((r) => r.name)).toEqual(allKeyNames())
    expect(keys.rows.every((r) => r.vercel === null)).toBe(true)
    expect(keys.counts.unused).toBe(0)
    expect(row(keys.rows, "DATABASE_URL")).toMatchObject({ state: "ok", canReveal: true })
    expect(row(keys.rows, "NEXTAUTH_SECRET").state).toBe("missing")
  })

  it("a reader that breaks its promise fails the keys alone, not the page", async () => {
    asMock(listVercelEnv).mockRejectedValue(new Error("boom"))
    const s = await awaitSections(getDeveloperSectionPromises(ME))
    expect(s.keys.status).toBe("failed")
    expect(s.keys.status === "failed" && s.keys.retryAction).toBe(DEVELOPER_RETRY)
    expect(DEVELOPER_RETRY).toBe("retryDeveloper")
    expect(s.map.status).toBe("ready")
    expect(s.setup.status).toBe("ready")
  })
})

describe("stack and setup", () => {
  it("passes the stack through", async () => {
    const { stack } = await load()
    expect(stack.groups.map((g) => g.label)).toEqual(["Framework", "Data", "Interface", "Sign-in", "AI", "Testing"])
  })

  it("lists the five commands in order, each with a plain line", async () => {
    const { setup } = await load()
    expect(setup.steps.map((s) => s.command)).toEqual([
      "npm ci",
      // `npx`: a new computer has no Vercel command installed yet.
      "npx vercel link",
      "npx vercel env pull .env.local",
      "npx prisma generate",
      "npm run dev",
    ])
    for (const s of setup.steps) expect(s.explain.length).toBeGreaterThan(10)
  })

  it("names the keys Vercel cannot hand over and warns off the one command", async () => {
    const { setup } = await load()
    expect(setup.byHand).toEqual(allKeys().filter((k) => k.where === "github").map((k) => k.name))
    expect(setup.byHand).toContain("PREDICTHQ_API_TOKEN")
    expect(setup.warning).toMatch(/prisma migrate dev/)
    expect(setup.warning).toMatch(/reset the live database/)
  })
})
