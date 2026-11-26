import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: { screen: { findMany: vi.fn(async () => [{ tokenHash: "h1" }, { tokenHash: "h2" }]) } } }))

import { pingAccountTvs, pushConfig, signedEventsUrl, tvChannel, tvPush } from "@/lib/screens/push"
import { prisma } from "@/lib/prisma"
import { ONLINE_WINDOW_MS, TV_PUSHED_POLL_MS } from "@/lib/screens/limits"

const ENV = { PUSHER_APP_ID: "3", PUSHER_KEY: "278d425bdf160c739803", PUSHER_SECRET: "7ad3773142a6692b25b8", PUSHER_CLUSTER: "us3" }

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("TV push", () => {
  it("is off, and sends nothing, without all four keys", async () => {
    vi.stubEnv("PUSHER_APP_ID", "3")
    vi.stubEnv("PUSHER_KEY", undefined)
    vi.stubEnv("PUSHER_SECRET", undefined)
    vi.stubEnv("PUSHER_CLUSTER", undefined)
    expect(pushConfig()).toBeNull()
    expect(tvPush("h1")).toBeNull()
    const f = vi.fn()
    vi.stubGlobal("fetch", f)
    await pingAccountTvs("acc1")
    expect(f).not.toHaveBeenCalled()
    expect(prisma.screen.findMany).not.toHaveBeenCalled()
  })

  it("signs the request the way Pusher's REST docs do", () => {
    const body = '{"name":"foo","channels":["project-3"],"data":"{\\"some\\":\\"data\\"}"}'
    const url = new URL(signedEventsUrl({ appId: "3", key: ENV.PUSHER_KEY, secret: ENV.PUSHER_SECRET, cluster: "us3" }, body, 1353088179 * 1000))
    expect(url.origin + url.pathname).toBe("https://api-us3.pusher.com/apps/3/events")
    expect(url.searchParams.get("body_md5")).toBe("ec365a775a4cd0599faeb73354201b6f")
    expect(url.searchParams.get("auth_signature")).toBe("da454824c97ba181a32ccc17a72625ba02771f50b50e1e7430e47a1f3f457e6c")
  })

  it("gives each TV its own channel, which the token hash alone does not spell", () => {
    expect(tvChannel("h1")).toMatch(/^tv-[0-9a-f]{40}$/)
    expect(tvChannel("h1")).not.toBe(tvChannel("h2"))
    expect(tvChannel("h1")).not.toContain("h1")
  })

  it("pings every TV in the account, in one call, and never throws", async () => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v)
    expect(tvPush("h1")).toEqual({ key: ENV.PUSHER_KEY, cluster: "us3", channel: tvChannel("h1") })
    const f = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", f)
    await pingAccountTvs("acc1")
    expect(prisma.screen.findMany).toHaveBeenCalledWith({ where: { accountId: "acc1" }, select: { tokenHash: true } })
    expect(f).toHaveBeenCalledTimes(1)
    const sent = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(sent).toEqual({ name: "change", channels: [tvChannel("h1"), tvChannel("h2")], data: "{}" })
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down") }))
    await expect(pingAccountTvs("acc1")).resolves.toBeUndefined()
  })

  it("still checks in often enough, with the socket up, for the dashboard to show the TV as on", () => {
    // Two checks must fit in the window, so one lost call doesn't flip a live TV to "Off".
    expect(TV_PUSHED_POLL_MS * 2).toBeLessThanOrEqual(ONLINE_WINDOW_MS)
  })
})
