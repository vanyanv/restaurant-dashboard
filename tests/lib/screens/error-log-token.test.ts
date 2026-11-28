import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { onRequestError } from "@/instrumentation"
import { installServerErrorRecorder, type ServerErrorReport } from "@/lib/monitoring/server-error-hook"

/** A TV's token is in the path of its two new endpoints and is its only credential: it must not reach the error log. */

const TOKEN = "Tk9-_" + "a".repeat(40)
const reports: ServerErrorReport[] = []
const KEY = "__counterServerErrorRecorder__"
let before: unknown

beforeEach(() => {
  reports.length = 0
  before = (globalThis as Record<string, unknown>)[KEY]
  installServerErrorRecorder((r) => void reports.push(r))
  vi.stubEnv("NEXT_RUNTIME", "nodejs")
})
afterEach(() => {
  ;(globalThis as Record<string, unknown>)[KEY] = before
  vi.unstubAllEnvs()
})

async function routeFor(path: string, routePath = "/api/x"): Promise<string | null | undefined> {
  await onRequestError(
    new Error("boom"),
    { path, method: "GET", headers: {} },
    { routerKind: "App Router", routePath, routeType: "route", revalidateReason: undefined, renderSource: undefined } as Parameters<typeof onRequestError>[2],
  )
  expect(reports).toHaveLength(1)
  const r = reports.pop()!
  expect(JSON.stringify(r)).not.toContain(TOKEN)
  return r.route
}

describe("the error log's route", () => {
  it.each([
    [`/api/tv/c/${TOKEN}`, "/api/tv/c/:token"],
    [`/api/tv/c/${TOKEN}?x=1`, "/api/tv/c/:token"],
    [`/api/tv/beat/${TOKEN}`, "/api/tv/beat/:token"],
    [`/api/tv/beat/${TOKEN}?k=${"f".repeat(64)}&d=Samsung`, "/api/tv/beat/:token"],
    [`/api/tv/c/${TOKEN}/more`, "/api/tv/c/:token/more"],
    ["/api/tv/c/not-even-a-token", "/api/tv/c/:token"],
  ])("%s is logged as %s", async (path, want) => {
    expect(await routeFor(path)).toBe(want)
  })

  it("drops the beat's ticket along with the rest of the query", async () => {
    const ticket = "c0ffee".repeat(10)
    await onRequestError(
      new Error("boom"),
      { path: `/api/tv/beat/${TOKEN}?k=${ticket}`, method: "GET", headers: {} },
      { routerKind: "App Router", routePath: "/api/tv/beat/[token]", routeType: "route" } as Parameters<typeof onRequestError>[2],
    )
    expect(JSON.stringify(reports)).not.toContain(ticket)
    expect(reports[0]).toMatchObject({ source: "api", method: "GET", message: "boom", metadata: { routePath: "/api/tv/beat/[token]" } })
  })

  it.each([
    ["/api/tv/content", "/api/tv/content"],
    ["/api/tv/media/acc1/abc.jpg", "/api/tv/media/acc1/abc.jpg"],
    ["/api/tv/c", "/api/tv/c"],
    ["/api/tv/c/", "/api/tv/c/"],
    ["/api/tv/beats/abc", "/api/tv/beats/abc"],
    ["/x/api/tv/c/abc", "/x/api/tv/c/abc"],
    ["/dashboard/screens?store=s1", "/dashboard/screens"],
    ["/api/chat/conversations/abc123/fork", "/api/chat/conversations/abc123/fork"],
    ["/", "/"],
  ])("leaves %s alone", async (path, want) => {
    await onRequestError(
      new Error("boom"),
      { path, method: "GET", headers: {} },
      { routerKind: "App Router", routePath: "/x", routeType: "route" } as Parameters<typeof onRequestError>[2],
    )
    expect(reports.pop()!.route).toBe(want)
  })

  it("records nothing outside the Node runtime, as before", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge")
    await onRequestError(
      new Error("boom"),
      { path: `/api/tv/c/${TOKEN}`, method: "GET", headers: {} },
      { routerKind: "App Router", routePath: "/x", routeType: "route" } as Parameters<typeof onRequestError>[2],
    )
    expect(reports).toHaveLength(0)
  })
})
