import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * "Forgot my PIN?" (2026-11-25): a phone number on file for someone active
 * at this store sends that person's PIN to their own email, never to the
 * screen; 3 unknown numbers per phone per day locks the phone; 3 emails per
 * person per day; each send raises one owner alert. Real in-memory limiter.
 */

const db = vi.hoisted(() => ({
  crewMember: { findFirst: vi.fn() },
  alert: { createMany: vi.fn() },
}))
vi.mock("@/lib/prisma", () => ({ prisma: db }))

const crew = vi.hoisted(() => ({ findStoreByCode: vi.fn(), checkLink: (c: string) => `https://x.test/checks/${c}` }))
vi.mock("@/lib/checks/crew", () => crew)

const mail = vi.hoisted(() => ({ sendPinEmail: vi.fn() }))
vi.mock("@/lib/checks/email", async (orig) => ({ ...(await orig<typeof import("@/lib/checks/email")>()), ...mail }))

import { NextRequest } from "next/server"
import { POST } from "@/app/api/checks/[code]/forgot-pin/route"

const MANUEL = "+18185550147"
let n = 0
let store = { id: "s0", name: "Glendale", accountId: "acc1" }
const dev = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`

function call(phone: unknown, ip: string, device?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip }
  if (device) headers.cookie = `crew_dev=${device}`
  const req = new NextRequest("https://x.test/api/checks/glendale/forgot-pin", {
    method: "POST",
    headers,
    body: JSON.stringify({ phone }),
  })
  return POST(req, { params: Promise.resolve({ code: "glendale" }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  n += 100
  store = { id: `s${n}`, name: "Glendale", accountId: "acc1" }
  crew.findStoreByCode.mockResolvedValue(store)
  const crewId = `c${n}`
  db.crewMember.findFirst.mockImplementation(async ({ where }: { where: { phone: string } }) =>
    where.phone === MANUEL
      ? { id: crewId, firstName: "Manuel", lastName: "Garcia", email: "manuel@example.com", pin: "4827" }
      : null,
  )
  db.alert.createMany.mockResolvedValue({ count: 1 })
  mail.sendPinEmail.mockResolvedValue({ ok: true })
})

describe("POST /api/checks/[code]/forgot-pin", () => {
  it("emails the PIN to the person and never returns it", async () => {
    const res = await call("(818) 555-0147", `10.9.${n}.1`, dev())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ email: "m•••••@example.com" })
    expect(JSON.stringify(body)).not.toContain("4827")
    expect(mail.sendPinEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "manuel@example.com", pin: "4827" }))
    expect(db.crewMember.findFirst.mock.calls[0][0].where).toMatchObject({
      storeId: store.id,
      phone: MANUEL,
      active: true,
      store: { accountId: "acc1" },
    })
    expect(db.alert.createMany).toHaveBeenCalledTimes(1)
  })

  it("refuses a malformed number without charging a try", async () => {
    const ip = `10.8.${n}.1`
    const d = dev()
    for (let i = 0; i < 5; i++) expect((await call("555", ip, d)).status).toBe(400)
    expect((await call(MANUEL, ip, d)).status).toBe(200)
  })

  it("locks a phone after 3 unknown numbers, even for a right one", async () => {
    const ip = `10.7.${n}.1`
    const d = dev()
    expect((await call("8185550100", ip, d)).status).toBe(404)
    expect((await call("8185550101", ip, d)).status).toBe(404)
    const third = await call("8185550102", ip, d)
    expect(third.status).toBe(429)
    expect((await third.json()).reason).toBe("locked")
    expect((await call(MANUEL, ip, d)).status).toBe(429)
    expect(mail.sendPinEmail).not.toHaveBeenCalled()
    // A coworker's phone on the same Wi-Fi still works.
    expect((await call(MANUEL, ip, dev())).status).toBe(200)
  })

  it("sends at most 3 emails per person per day", async () => {
    for (let i = 0; i < 3; i++) expect((await call(MANUEL, `10.6.${n}.${i}`, dev())).status).toBe(200)
    const res = await call(MANUEL, `10.6.${n}.9`, dev())
    expect(res.status).toBe(429)
    expect((await res.json()).reason).toBe("sent")
    expect(mail.sendPinEmail).toHaveBeenCalledTimes(3)
  })

  it("says so when there is no email or the send fails", async () => {
    db.crewMember.findFirst.mockResolvedValueOnce({ id: "x", firstName: "A", lastName: null, email: null, pin: "1111" })
    expect((await (await call(MANUEL, `10.5.${n}.1`, dev())).json()).reason).toBe("noemail")
    mail.sendPinEmail.mockResolvedValueOnce({ ok: false, reason: "nope" })
    const res = await call(MANUEL, `10.5.${n}.2`, dev())
    expect(res.status).toBe(503)
    expect(db.alert.createMany).not.toHaveBeenCalled()
  })
})
