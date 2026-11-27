import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The crew page's refresh (2026-11-20): phones send the version of the view
 * they hold, and the server answers "unchanged" from one query instead of
 * loading the whole view. The crew path is read-only (no auto-close) and
 * runs `ensureCheckSetup` once per request.
 *
 * November 2026 is PST, so LA = UTC-8. Morning opens 9:00 am, Submit 4:30 pm,
 * due 5:30 pm, 30 min grace.
 */

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  store: { findMany: vi.fn() },
  checkTemplate: { findMany: vi.fn(), findUnique: vi.fn() },
  checkSubmission: { findMany: vi.fn() },
  checkClosure: { findMany: vi.fn() },
  checkStart: { findMany: vi.fn() },
  checkMark: { findMany: vi.fn() },
  checkPause: { findMany: vi.fn() },
}))
vi.mock("@/lib/prisma", () => ({ prisma: db }))
const setup = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock("@/lib/checks/setup", async (orig) => ({ ...(await orig<typeof import("@/lib/checks/setup")>()), ensureCheckSetup: setup }))
const autoClose = vi.hoisted(() => vi.fn(async () => 0))
vi.mock("@/lib/checks/close", async (orig) => ({ ...(await orig<typeof import("@/lib/checks/close")>()), autoCloseChecks: autoClose }))
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => null) }))

import { NextRequest } from "next/server"
import { clockKey, checkStateByCode, checkStateVersion } from "@/lib/checks/version"
import { loadCrewView } from "@/lib/checks/crew"
import { loadCheckGrid } from "@/lib/checks/data"
import { GET } from "@/app/api/checks/[code]/state/route"

const MORNING = {
  kind: "MORNING" as const,
  opensAtMin: 540,
  submitFromMin: 990,
  dueAtMin: 1050,
  dueByWeekday: [],
  graceMin: 30, thanksgivingOff: false, thanksgivingOpensMin: null, thanksgivingDueMin: null,
  enabled: true,
}
const STORE = { id: "s1", name: "Van Nuys", accountId: "acc1" }
const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: STORE.id,
  name: STORE.name,
  accountId: STORE.accountId,
  stage: "ready",
  templates: [MORNING],
  db: "hash-a",
  ...over,
})
/** An LA wall-clock time on 2026-11-20 (or another day), as an instant. */
const la = (hhmm: string, day = "2026-11-20") => {
  const [h, m] = hhmm.split(":").map(Number)
  const [y, mo, d] = day.split("-").map(Number)
  return new Date(Date.UTC(y, mo - 1, d, h + 8, m))
}

function emptyGrid() {
  db.store.findMany.mockResolvedValue([{ id: STORE.id, name: STORE.name, lifecycleStage: "ready" }])
  db.checkTemplate.findMany.mockResolvedValue([])
  db.checkSubmission.findMany.mockResolvedValue([])
  db.checkClosure.findMany.mockResolvedValue([])
  db.checkStart.findMany.mockResolvedValue([])
  db.checkMark.findMany.mockResolvedValue([])
  db.checkPause.findMany.mockResolvedValue([])
}

beforeEach(() => {
  vi.clearAllMocks()
  emptyGrid()
})

describe("clockKey", () => {
  it("holds still inside a phase and moves at every window boundary", () => {
    const at = (t: string) => clockKey([MORNING], la(t))
    expect(at("10:00")).toBe(at("12:00")) // preview all along
    expect(at("08:59")).not.toBe(at("09:01")) // list opens
    expect(at("16:29")).not.toBe(at("16:31")) // Submit unlocks
    expect(at("17:29")).not.toBe(at("17:31")) // goes late
    expect(at("17:59")).not.toBe(at("18:01")) // closes
  })

  it("moves when the business day rolls over", () => {
    expect(clockKey([MORNING], la("23:00"))).not.toBe(clockKey([MORNING], la("02:00", "2026-11-21")))
  })

  it("moves when a window is edited", () => {
    expect(clockKey([MORNING], la("16:45"))).not.toBe(clockKey([{ ...MORNING, submitFromMin: 1020 }], la("16:45")))
  })
})

describe("check-state version", () => {
  it("is one query, and changes with the database hash, the store and the clock", async () => {
    db.$queryRaw.mockResolvedValue([row()])
    const a = await checkStateByCode("van-nuys-abc123", la("10:00"))
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)
    expect(a?.store).toEqual(STORE)
    const v = a!.version

    db.$queryRaw.mockResolvedValue([row()])
    expect((await checkStateByCode("van-nuys-abc123", la("11:00")))!.version).toBe(v)
    db.$queryRaw.mockResolvedValue([row({ db: "hash-b" })])
    expect((await checkStateByCode("van-nuys-abc123", la("11:00")))!.version).not.toBe(v)
    db.$queryRaw.mockResolvedValue([row({ stage: "pre_open" })])
    expect((await checkStateByCode("van-nuys-abc123", la("11:00")))!.version).not.toBe(v)
    db.$queryRaw.mockResolvedValue([row()])
    expect((await checkStateByCode("van-nuys-abc123", la("16:45")))!.version).not.toBe(v)
  })

  it("never queries for a code that cannot be one, and is null for an unknown one", async () => {
    expect(await checkStateByCode("NOT A CODE", la("10:00"))).toBeNull()
    expect(db.$queryRaw).not.toHaveBeenCalled()
    db.$queryRaw.mockResolvedValue([])
    expect(await checkStateByCode("gone-123456", la("10:00"))).toBeNull()
  })

  it("filters by the store's account when looked up by id", async () => {
    db.$queryRaw.mockResolvedValue([row()])
    await checkStateVersion(STORE, la("10:00"))
    const values = (db.$queryRaw.mock.calls[0] as unknown[]).slice(1).flatMap((v) =>
      typeof v === "object" && v !== null && "values" in v ? (v as { values: unknown[] }).values : [v],
    )
    expect(values).toContain(STORE.id)
    expect(values).toContain(STORE.accountId)
    // The view covers yesterday and today.
    expect(values).toContain("2026-11-19")
    expect(values).toContain("2026-11-20")
  })
})

describe("loadCrewView", () => {
  it("runs setup once, does not auto-close by default, and carries the version", async () => {
    db.$queryRaw.mockResolvedValue([row()])
    const view = await loadCrewView(STORE, la("10:00"))
    expect(setup).toHaveBeenCalledTimes(1)
    expect(autoClose).not.toHaveBeenCalled()
    expect(view.version).toMatch(/^[\w-]{20}$/)
  })

  it("closes a finished window when asked (page render, changed refresh)", async () => {
    db.checkTemplate.findMany.mockResolvedValue([
      { id: "t1", storeId: STORE.id, ...MORNING, createdAt: new Date("2026-01-01"), sections: [{ _count: { items: 3 } }] },
    ])
    await loadCrewView(STORE, la("19:00"), { setup: false, version: "v", autoClose: true })
    expect(autoClose).toHaveBeenCalled()
  })

  it("skips setup and the version query when the caller has them", async () => {
    const view = await loadCrewView(STORE, la("10:00"), { setup: false, version: "given" })
    expect(setup).not.toHaveBeenCalled()
    expect(db.$queryRaw).not.toHaveBeenCalled()
    expect(view.version).toBe("given")
  })
})

describe("loadCheckGrid", () => {
  const missedMorning = () => {
    db.checkTemplate.findMany.mockResolvedValue([
      { id: "t1", storeId: STORE.id, ...MORNING, createdAt: new Date("2026-01-01"), sections: [{ _count: { items: 3 } }] },
    ])
  }

  it("still closes a finished window for the owners' screens and the cron", async () => {
    missedMorning()
    await loadCheckGrid({ accountId: STORE.accountId, fromDay: "2026-11-19", toDay: "2026-11-20", now: la("19:00") })
    expect(setup).toHaveBeenCalledTimes(1)
    expect(autoClose).toHaveBeenCalled()
  })

  it("does neither when told not to (the crew page)", async () => {
    missedMorning()
    await loadCheckGrid({
      accountId: STORE.accountId,
      fromDay: "2026-11-19",
      toDay: "2026-11-20",
      now: la("19:00"),
      setup: false,
      autoClose: false,
    })
    expect(setup).not.toHaveBeenCalled()
    expect(autoClose).not.toHaveBeenCalled()
  })
})

describe("GET /api/checks/[code]/state", () => {
  const get = (q = "") =>
    GET(new NextRequest(`http://x/api/checks/van-nuys-abc123/state${q}`), { params: Promise.resolve({ code: "van-nuys-abc123" }) })

  it("answers unchanged from the one query when the phone's version is current", async () => {
    db.$queryRaw.mockResolvedValue([row()])
    const first = await (await get()).json()
    expect(first.view.version).toBeTruthy()
    vi.clearAllMocks()
    emptyGrid()
    db.$queryRaw.mockResolvedValue([row()])
    const res = await get(`?v=${first.view.version}`)
    expect(await res.json()).toEqual({ unchanged: true, version: first.view.version })
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)
    expect(db.store.findMany).not.toHaveBeenCalled()
    expect(setup).not.toHaveBeenCalled()
  })

  it("sends the whole view, read-only, when the version moved", async () => {
    db.$queryRaw.mockResolvedValue([row({ db: "hash-b" })])
    const body = await (await get("?v=old")).json()
    expect(body.view.store).toEqual({ name: STORE.name })
    expect(db.$queryRaw).toHaveBeenCalledTimes(1) // the version is not read twice
    expect(setup).toHaveBeenCalledTimes(1)
    expect(autoClose).not.toHaveBeenCalled()
  })

  it("404s an unknown code", async () => {
    db.$queryRaw.mockResolvedValue([])
    expect((await get()).status).toBe(404)
  })
})
