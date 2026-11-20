// The Otter HTTP client's reliability edges (2026-11-20 audit):
//  - the email/password sign-in had no timeout, so a hung sign-in held every
//    sync that needed a fresh token until the function was killed;
//  - the per-order GraphQL details request did not retry 429/5xx, so a rate
//    limit sent a batch of orders back to "details pending".

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/fetch-with-timeout", () => ({ fetchWithTimeout: vi.fn() }))

import { fetchWithTimeout } from "@/lib/fetch-with-timeout"

function jwtWithExp(exp: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")
  return `${b64({ alg: "none" })}.${b64({ exp })}.sig`
}

const orderDetails = {
  data: {
    orderDetails: {
      metadata: { internalId: "i", externalId: null, displayId: null, ofo: null, store: { id: "s", facilityV2: null, restrictedBrand: null }, isTest: false },
      details: {
        referenceTime: "", referenceTimeLocalWithoutTz: "", orderState: null,
        subtotal: null, tax: null, tip: null, commission: null, discount: null,
        ofoFundedDiscount: null, total: { units: 12, nanos: 500_000_000 },
        fulfillmentInfo: null, customerName: "Ana",
      },
      items: [],
    },
  },
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

afterEach(() => {
  process.env = { ...originalEnv }
  vi.unstubAllGlobals()
})

describe("retryDelayMs", () => {
  it("honours Retry-After seconds and HTTP dates, capped at 30s, else linear backoff", async () => {
    const { retryDelayMs } = await import("@/lib/otter")
    expect(retryDelayMs(null, 1)).toBe(2000)
    expect(retryDelayMs(null, 2)).toBe(4000)
    expect(retryDelayMs("3", 1)).toBe(3000)
    expect(retryDelayMs("600", 1)).toBe(30_000)
    const now = Date.parse("2026-11-20T10:00:00Z")
    expect(retryDelayMs("Fri, 20 Nov 2026 10:00:05 GMT", 1, now)).toBe(5000)
    expect(retryDelayMs("garbage", 2)).toBe(4000)
  })
})

describe("queryOtterGraphQL (fetchOrderDetails)", () => {
  it("retries a 429, waiting what Retry-After asks, then succeeds", async () => {
    process.env.OTTER_JWT = jwtWithExp(Math.floor(Date.now() / 1000) + 3600)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({}, 429, { "retry-after": "0" }))
      .mockResolvedValueOnce(json({}, 503, { "retry-after": "0" }))
      .mockResolvedValueOnce(json(orderDetails))
    vi.stubGlobal("fetch", fetchMock)

    const { fetchOrderDetails } = await import("@/lib/otter")
    const d = await fetchOrderDetails("order-1")
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(d?.details.total).toBe(12.5)
  })

  it("gives up after its bounded attempts", async () => {
    process.env.OTTER_JWT = jwtWithExp(Math.floor(Date.now() / 1000) + 3600)
    const fetchMock = vi.fn(async () => json({}, 429, { "retry-after": "0" }))
    vi.stubGlobal("fetch", fetchMock)
    const { fetchOrderDetails } = await import("@/lib/otter")
    await expect(fetchOrderDetails("order-1")).rejects.toThrow(/error 429/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe("Otter sign-in", () => {
  it("goes through fetchWithTimeout", async () => {
    delete process.env.OTTER_JWT
    process.env.OTTER_EMAIL = "ops@example.test"
    process.env.OTTER_PASSWORD = "pw"
    vi.mocked(fetchWithTimeout).mockResolvedValue(
      json({ accessToken: jwtWithExp(Math.floor(Date.now() / 1000) + 3600) }),
    )
    vi.stubGlobal("fetch", vi.fn(async () => json({ rows: [] })))

    const { queryMetrics } = await import("@/lib/otter")
    await queryMetrics({})
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1)
    const [url, , timeoutMs] = vi.mocked(fetchWithTimeout).mock.calls[0]
    expect(url).toMatch(/sign_in$/)
    expect(timeoutMs).toBe(15_000)
  })
})
