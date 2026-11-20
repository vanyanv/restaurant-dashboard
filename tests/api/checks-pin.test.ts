import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Crew PIN pacing (2026-11-20). Only wrong PINs are charged; malformed
 * requests are refused before any budget is touched; one phone is held to
 * 5 wrong PINs per 10 minutes and one address to 30; a store past 50 wrong PINs in a day raises one
 * alert and slows every address, but a crew member with the right PIN still
 * gets in.
 *
 * The limiter is the real in-memory one (no Redis in tests); each test uses
 * its own store id and addresses so counters do not leak between tests.
 */

const db = vi.hoisted(() => ({
  crewMember: { findFirst: vi.fn() },
  checkStart: { upsert: vi.fn() },
  alert: { createMany: vi.fn() },
  errorEvent: { create: vi.fn() },
}))
vi.mock("@/lib/prisma", () => ({ prisma: db }))

const crew = vi.hoisted(() => ({ findStoreByCode: vi.fn(), loadCrewView: vi.fn() }))
vi.mock("@/lib/checks/crew", () => crew)

process.env.CHECKS_SECRET = "test-secret"

import { NextRequest } from "next/server"
import { POST } from "@/app/api/checks/[code]/pin/route"

const GOOD_PIN = "4829"
let storeN = 0
let store = { id: "s0", name: "Van Nuys", accountId: "acc1" }

let phoneN = 0
/** A fresh phone id (the `crew_dev` cookie the route hands out). */
const phone = () => `00000000-0000-4000-8000-${String(++phoneN).padStart(12, "0")}`

function req(pin: unknown, ip: string, dev?: string, raw?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip }
  if (dev) headers.cookie = `crew_dev=${dev}`
  return new NextRequest("https://x.test/api/checks/van-nuys/pin", {
    method: "POST",
    headers,
    body: raw ?? JSON.stringify({ pin }),
  })
}
const call = (pin: unknown, ip: string, dev?: string, raw?: string) =>
  POST(req(pin, ip, dev, raw), { params: Promise.resolve({ code: "van-nuys" }) })

beforeEach(() => {
  vi.clearAllMocks()
  storeN += 1
  store = { id: `s${storeN}`, name: "Van Nuys", accountId: "acc1" }
  crew.findStoreByCode.mockResolvedValue(store)
  crew.loadCrewView.mockResolvedValue({ active: { kind: "MORNING", day: "2026-11-20" } })
  db.crewMember.findFirst.mockImplementation(async ({ where }: { where: { pin: string } }) =>
    where.pin === GOOD_PIN ? { id: "c1", firstName: "Ana", lastName: "Lopez" } : null,
  )
  db.checkStart.upsert.mockResolvedValue({})
  db.alert.createMany.mockResolvedValue({ count: 1 })
  db.errorEvent.create.mockResolvedValue({})
})

describe("POST /api/checks/[code]/pin", () => {
  it("refuses a malformed PIN without charging anything", async () => {
    const ip = `10.0.${storeN}.1`
    const dev = phone()
    for (let i = 0; i < 9; i++) {
      expect((await call("12", ip, dev)).status).toBe(400)
      expect((await call(null, ip, dev, "not json")).status).toBe(400)
    }
    // Nine rounds of junk later (18 requests, under the 20-a-minute ceiling), a right PIN from the same phone works.
    expect((await call(GOOD_PIN, ip, dev)).status).toBe(200)
    expect(db.crewMember.findFirst).toHaveBeenCalledTimes(1)
  })

  it("lets a right PIN in and never charges it", async () => {
    const ip = `10.1.${storeN}.1`
    const dev = phone()
    for (let i = 0; i < 8; i++) expect((await call(GOOD_PIN, ip, dev)).status).toBe(200)
  })

  it("hands a phone without one its own id", async () => {
    const res = await call(GOOD_PIN, `10.1.${storeN}.9`)
    expect(res.cookies.get("crew_dev")?.value).toMatch(/^[0-9a-f-]{36}$/)
    const again = await call(GOOD_PIN, `10.1.${storeN}.9`, phone())
    expect(again.cookies.get("crew_dev")).toBeUndefined()
  })

  it("one phone's typos never block a coworker on the same store Wi-Fi", async () => {
    const ip = `10.2.${storeN}.1`
    const mine = phone()
    for (let i = 0; i < 5; i++) expect((await call("0000", ip, mine)).status).toBe(401)
    expect((await call("0001", ip, mine)).status).toBe(429)
    expect((await call(GOOD_PIN, ip, mine)).status).toBe(429)
    // A coworker on the same Wi-Fi signs straight in.
    expect((await call(GOOD_PIN, ip, phone())).status).toBe(200)
  })

  it("holds one address to 30 wrong PINs per 10 minutes, however many phone ids it uses", async () => {
    // A minute between phones keeps each batch under the 20-a-minute ceiling,
    // and six minutes in total stays inside the 10-minute window.
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      const ip = `10.5.${storeN}.1`
      for (let p = 0; p < 6; p++) {
        const dev = phone()
        for (let i = 0; i < 5; i++) expect((await call("0000", ip, dev)).status).toBe(401)
        vi.setSystemTime(Date.now() + 61_000)
      }
      expect((await call("0000", ip, phone())).status).toBe(429)
      expect((await call("0000", ip)).status).toBe(429)
    } finally {
      vi.useRealTimers()
    }
  })

  it("past 50 wrong PINs a day at a store: one alert, slower guessing, crew still get in", async () => {
    // 50 wrong PINs from 10 addresses, 5 each: nobody hits their own limit.
    for (let a = 0; a < 10; a++) {
      const dev = phone()
      for (let i = 0; i < 5; i++) expect((await call("0000", `10.3.${storeN}.${a}`, dev)).status).toBe(401)
    }
    expect(db.alert.createMany).not.toHaveBeenCalled()

    // The 51st goes past the budget and raises the alert.
    expect((await call("0000", `10.3.${storeN}.100`, phone())).status).toBe(401)
    expect(db.alert.createMany).toHaveBeenCalledTimes(1)
    const alert = db.alert.createMany.mock.calls[0][0].data[0]
    expect(alert).toMatchObject({ storeId: store.id, source: "STORE_CHECK", severity: "WATCH" })
    expect(alert.dedupeKey).toMatch(new RegExp(`^STORE_CHECK_PIN:${store.id}:`))
    expect(db.errorEvent.create).toHaveBeenCalledTimes(1)

    // Now every phone gets 2 wrong PINs per 10 minutes, not 5.
    const fresh = phone()
    const freshIp = `10.3.${storeN}.200`
    expect((await call("0000", freshIp, fresh)).status).toBe(401)
    expect((await call("0000", freshIp, fresh)).status).toBe(401)
    expect((await call("0000", freshIp, fresh)).status).toBe(429)

    // The store is not locked: a crew member on another phone signs in.
    expect((await call(GOOD_PIN, freshIp, phone())).status).toBe(200)
  })

  it("an alert write that fails does not turn a wrong PIN into a 500", async () => {
    db.alert.createMany.mockRejectedValue(new Error("db down"))
    for (let a = 0; a < 11; a++) {
      const dev = phone()
      for (let i = 0; i < 5; i++) await call("0000", `10.4.${storeN}.${a}`, dev)
    }
    expect((await call("0000", `10.4.${storeN}.99`, phone())).status).toBe(401)
  })
})
