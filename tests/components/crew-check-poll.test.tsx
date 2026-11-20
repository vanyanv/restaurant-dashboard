// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, render } from "@testing-library/react"
import { CrewCheckClient } from "@/app/checks/[code]/crew-check-client"
import type { CrewView } from "@/lib/checks/crew"

/**
 * The crew page's refresh (2026-11-20): 20 s on the store and PIN screens
 * (6 s only while working a list), nothing while the phone is locked or the
 * tab hidden, one check straight away when it comes back, and always with
 * the version of the view on screen so the server can answer "unchanged".
 */

const view = (version: string): CrewView => ({
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
  it("polls every 20 s on the store screen, sending the view's version", async () => {
    render(<CrewCheckClient code="van-nuys-abc123" initial={view("v1")} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })
    expect(stateCalls()).toHaveLength(0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_000)
    })
    expect(stateCalls()).toEqual(["/api/checks/van-nuys-abc123/state?v=v1"])
  })

  it("takes the new version from a changed answer", async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ view: view("v2") }), { status: 200 }))
    render(<CrewCheckClient code="van-nuys-abc123" initial={view("v1")} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(stateCalls()).toEqual(["/api/checks/van-nuys-abc123/state?v=v1", "/api/checks/van-nuys-abc123/state?v=v2"])
  })

  it("stops while hidden and checks once straight away on coming back", async () => {
    render(<CrewCheckClient code="van-nuys-abc123" initial={view("v1")} />)
    await setHidden(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(stateCalls()).toHaveLength(0)
    await setHidden(false)
    expect(stateCalls()).toHaveLength(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(stateCalls()).toHaveLength(2)
  })
})
