import { afterEach, describe, expect, it, vi } from "vitest"
import { serviceOfHost } from "@/lib/usage/hosts"

describe("serviceOfHost", () => {
  afterEach(() => vi.unstubAllEnvs())

  it.each([
    ["api.openai.com", "openai"],
    ["generativelanguage.googleapis.com", "gemini"],
    ["api.resend.com", "resend"],
    ["api-us3.pusher.com", "pusher"],
    ["abc123.r2.cloudflarestorage.com", "r2"],
    ["graph.microsoft.com", "microsoft"],
    ["login.microsoftonline.com", "microsoft"],
    ["api.tryotter.com", "otter"],
    ["manager.tryotter.com", "otter"],
    ["gateway.harri.com", "harri"],
    ["harri.com", "harri"],
    ["api.predicthq.com", "predicthq"],
    ["archive-api.open-meteo.com", "open-meteo"],
    ["api.github.com", "github"],
    ["api.vercel.com", "vercel"],
    ["API.OpenAI.com", "openai"],
    ["example.org", "other"],
    ["notopenai.com", "other"],
  ])("%s is %s", (host, service) => {
    expect(serviceOfHost(host)).toBe(service)
  })

  it("leaves out Upstash, which is counted as Redis commands", () => {
    expect(serviceOfHost("grand-thing-1.upstash.io")).toBeNull()
  })

  it("leaves out the app's own host and localhost", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://dash.example.com")
    expect(serviceOfHost("dash.example.com")).toBeNull()
    expect(serviceOfHost("localhost")).toBeNull()
  })

  it("names the shop site from its env", () => {
    vi.stubEnv("SHOP_API_URL", "https://store.example.net/api")
    expect(serviceOfHost("store.example.net")).toBe("shop")
  })
})
