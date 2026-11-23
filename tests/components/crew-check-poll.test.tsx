// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, render } from "@testing-library/react"
import { CrewCheckClient } from "@/app/checks/[code]/crew-check-client"
import type { CrewView } from "@/lib/checks/crew"
import { nextPollDelay } from "@/app/checks/[code]/poll-delay"

/**
 * The crew page's refresh (since 2026-11-23, to cut Vercel active CPU): on
 * the store and PIN screens it asks right when the next window event is due
 * and at least every 5 minutes, every 15 minutes with nothing on the clock,
 * every 30 s on a list; nothing while the phone is locked or the tab hidden,
 * one check straight away when it comes back, and always with the version of
 * the view on screen so the server can answer "unchanged".
 */

const view = (version: string, over: Partial<CrewView> = {}): CrewView => ({
  store: { name: "Van Nuys" },
  day: "2026-11-20",
  rows: [],
  active: null,
  next: null,
  closedToday: false,
  practice: false,
  practiceSince: null,
  serverNow: Date.now(),
  version,
  ...over,
})

let hidden = false
const fetchMock = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  hidden = false
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden })
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ unchanged: true }), { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const stateCalls = () => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/state"))
const setHidden = async (h: boolean) => {
  hidden = h
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"))
  })
}

describe("crew page refresh", () => {
  it("with nothing on the clock today, asks every 15 minutes, sending the view's version", async () => {
    render(<CrewCheckClient code="van-nuys-abc123" initial={view("v1")} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14 * 60_000)
    })
    expect(stateCalls()).toHaveLength(0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(stateCalls()).toEqual(["/api/checks/van-nuys-abc123/state?v=v1"])
  })

  it("asks right when the next window opens", async () => {
    const opensAt = Date.now() + 90_000
    render(
      <CrewCheckClient
        code="van-nuys-abc123"
        initial={view("v1", { next: { label: { en: "Morning", es: "Mañana" }, opensLabel: "9:00 am", opensAt } })}
      />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(91_000)
    })
    expect(stateCalls()).toHaveLength(0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
    })
    expect(stateCalls()).toHaveLength(1)
  })

  it("takes the new version from a changed answer", async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ view: view("v2") }), { status: 200 }))
    render(<CrewCheckClient code="van-nuys-abc123" initial={view("v1")} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000)
    })
    expect(stateCalls()).toEqual(["/api/checks/van-nuys-abc123/state?v=v1", "/api/checks/van-nuys-abc123/state?v=v2"])
  })

  it("stops while hidden and checks once straight away on coming back", async () => {
    render(<CrewCheckClient code="van-nuys-abc123" initial={view("v1")} />)
    await setHidden(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60_000)
    })
    expect(stateCalls()).toHaveLength(0)
    await setHidden(false)
    expect(stateCalls()).toHaveLength(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000)
    })
    expect(stateCalls()).toHaveLength(2)
  })
})

describe("nextPollDelay", () => {
  const now = 1_000_000_000
  const active = (o: { submitFrom: number; dueAt: number; closesAt: number }) =>
    ({ kind: "MORNING", day: "2026-11-20", label: { en: "", es: "" }, canSubmit: false, submitFromLabel: "", dueLabel: "", sections: [], marks: [], people: [], practice: false, ...o }) as unknown as CrewView["active"]

  it("is 30 s on a list", () => {
    expect(nextPollDelay(view("v"), true, now)).toBe(30_000)
  })
  it("waits for the next event, capped at 5 minutes", () => {
    const a = active({ submitFrom: now + 60_000, dueAt: now + 3_600_000, closesAt: now + 4_000_000 })
    expect(nextPollDelay(view("v", { active: a }), false, now)).toBe(62_000)
    const later = active({ submitFrom: now - 600_000, dueAt: now + 3_600_000, closesAt: now + 4_000_000 })
    expect(nextPollDelay(view("v", { active: later }), false, now)).toBe(300_000)
  })
  it("retries shortly just after an event", () => {
    const a = active({ submitFrom: now - 5_000, dueAt: now + 3_600_000, closesAt: now + 4_000_000 })
    expect(nextPollDelay(view("v", { active: a }), false, now)).toBe(10_000)
  })
  it("is 15 minutes with nothing on the clock", () => {
    expect(nextPollDelay(view("v"), false, now)).toBe(900_000)
  })
})
